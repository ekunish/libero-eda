#!/usr/bin/env python3
"""Fail-closed validation for a complete libero-eda-hosted/v1 export."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import pyarrow.ipc as ipc

EXPECTED = {
    "task_families": 130,
    "original_episodes": 6_500,
    "plus_training_episodes": 14_347,
    "evaluation_conditions": 10_030,
}

EXPECTED_CAMERAS = {"agentview", "robot0_eye_in_hand"}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def webp_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:32]
    if len(data) < 25 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise RuntimeError(f"invalid WebP header: {path}")
    chunk = data[12:16]
    payload = data[20:]
    if chunk == b"VP8X" and len(payload) >= 10:
        return int.from_bytes(payload[4:7], "little") + 1, int.from_bytes(
            payload[7:10], "little"
        ) + 1
    if chunk == b"VP8 " and len(payload) >= 10 and payload[3:6] == b"\x9d\x01\x2a":
        return int.from_bytes(payload[6:8], "little") & 0x3FFF, int.from_bytes(
            payload[8:10], "little"
        ) & 0x3FFF
    if chunk == b"VP8L" and len(payload) >= 5 and payload[0] == 0x2F:
        bits = int.from_bytes(payload[1:5], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    raise RuntimeError(f"unsupported WebP header: {path}")


def replay_asset(root: Path, kind: str, replay_id: str, suffix: str) -> Path:
    if replay_id.startswith("demo-"):
        episode = int(replay_id.removeprefix("demo-"))
        return (
            root
            / f"assets/{kind}/lerobot_libero_plus/chunk-{episode // 1000:03d}/{replay_id}{suffix}"
        )
    parts = replay_id.split("-")
    if len(parts) < 5 or parts[:2] != ["original", "libero"]:
        raise RuntimeError(f"unknown dataset replay id: {replay_id}")
    return (
        root
        / f"assets/{kind}/original_libero/{'-'.join(parts[2:-2])}/{parts[-2]}/{replay_id}{suffix}"
    )


def validate_replay_manifest(
    record: dict[str, Any],
    replay: dict[str, Any],
    task_key: str,
    plus_revision: str,
) -> None:
    replay_id = record.get("replay_id")
    dataset_id = record.get("dataset_id")
    if replay.get("replay_id") != replay_id:
        raise RuntimeError(f"replay manifest identity mismatch: {replay_id}")
    if replay.get("dataset_id") != dataset_id:
        raise RuntimeError(f"replay dataset mismatch: {replay_id}")
    if replay.get("task_key") != task_key or record.get("base_task_key") != task_key:
        raise RuntimeError(f"replay task identity mismatch: {replay_id}")
    if replay.get("state_count") != record.get("length"):
        raise RuntimeError(f"replay state count mismatch: {replay_id}")
    fps = replay.get("fps")
    if not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise RuntimeError(f"invalid replay fps: {replay_id}")
    videos = replay.get("videos")
    if not isinstance(videos, list) or {video.get("camera") for video in videos} != EXPECTED_CAMERAS:
        raise RuntimeError(f"replay camera set mismatch: {replay_id}")
    if len(videos) != len(EXPECTED_CAMERAS):
        raise RuntimeError(f"duplicate replay camera: {replay_id}")

    for video in videos:
        camera = video["camera"]
        start = video.get("start_time_sec")
        end = video.get("end_time_sec")
        offset = video.get("frame_offset")
        if (
            not isinstance(start, (int, float))
            or not math.isfinite(start)
            or start < 0
            or not isinstance(end, (int, float))
            or not math.isfinite(end)
            or end <= start
            or not isinstance(offset, int)
            or offset < 0
            or not isinstance(video.get("width"), int)
            or video["width"] <= 0
            or not isinstance(video.get("height"), int)
            or video["height"] <= 0
        ):
            raise RuntimeError(f"invalid replay video timebase: {replay_id}/{camera}")
        final_series_time = start + max(0, replay["state_count"] - 1 - offset) / fps
        if final_series_time > end + 1e-6:
            raise RuntimeError(f"video cannot contain all replay states: {replay_id}/{camera}")

        if dataset_id == "lerobot_libero_plus":
            episode = record.get("episode_index")
            if not isinstance(episode, int) or replay_id != f"demo-{episode}":
                raise RuntimeError(f"LIBERO-Plus episode identity mismatch: {replay_id}")
            source_camera = (
                "observation.images.front"
                if camera == "agentview"
                else "observation.images.wrist"
            )
            expected_url = (
                "https://huggingface.co/datasets/Sylvest/libero_plus_lerobot/resolve/"
                f"{plus_revision}/videos/chunk-{episode // 1000:03d}/{source_camera}/"
                f"episode_{episode:06d}.mp4"
            )
            if video.get("asset_id") != expected_url:
                raise RuntimeError(f"LIBERO-Plus public MP4 URL mismatch: {replay_id}/{camera}")
            expected_end = replay["state_count"] / fps
            if (
                start != 0.0
                or offset != 0
                or not math.isclose(end, expected_end, rel_tol=0, abs_tol=1e-9)
            ):
                raise RuntimeError(f"LIBERO-Plus episode timebase mismatch: {replay_id}/{camera}")
            if (
                video.get("default_display_transform") != "rotate_180"
                or video.get("display_transform_provenance")
                != "source:lerobot-image-convention/rotate-180"
            ):
                raise RuntimeError(f"LIBERO-Plus orientation contract mismatch: {replay_id}/{camera}")
        elif dataset_id == "original_libero":
            if (
                video.get("default_display_transform") != "identity"
                or video.get("display_transform_provenance")
                != "app:libero-eda/original-libero-derived-v1"
            ):
                raise RuntimeError(f"Original LIBERO orientation contract mismatch: {replay_id}/{camera}")
        else:
            raise RuntimeError(f"unknown dataset in replay shard: {dataset_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    manifest_path = root / "manifest.json"
    manifest = load_json(manifest_path)
    if manifest.get("schema_version") != "libero-eda-hosted/v1":
        raise RuntimeError("manifest schema mismatch")
    if manifest.get("counts") != EXPECTED:
        raise RuntimeError(f"manifest counts mismatch: {manifest.get('counts')}")
    integrity = manifest.get("integrity")
    if (
        not isinstance(integrity, dict)
        or integrity.get("index") != "integrity/artifacts.json"
    ):
        raise RuntimeError("manifest integrity index contract is missing")
    integrity_path = root / integrity["index"]
    if integrity_path.stat().st_size != integrity.get("bytes") or digest(
        integrity_path
    ) != integrity.get("sha256"):
        raise RuntimeError("integrity index size or SHA-256 mismatch")
    integrity_index = load_json(integrity_path)
    if integrity_index.get("schema_version") != "libero-eda-integrity/v1":
        raise RuntimeError("integrity index schema mismatch")
    artifacts = integrity_index.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise RuntimeError("artifact index is missing")
    if (
        integrity_index.get("artifact_count") != len(artifacts)
        or integrity.get("artifact_count") != len(artifacts)
        or integrity_index.get("artifact_bytes")
        != sum(record["bytes"] for record in artifacts.values())
        or integrity.get("artifact_bytes") != integrity_index.get("artifact_bytes")
    ):
        raise RuntimeError("integrity index aggregate mismatch")

    actual_paths = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file()
        and ".cache" not in path.relative_to(root).parts
        and path.relative_to(root).as_posix() != integrity["index"]
        and path.name not in {"manifest.json", ".libero-eda-export.json"}
    }
    expected_paths = set(artifacts)
    if actual_paths != expected_paths:
        raise RuntimeError(
            f"artifact path set mismatch: missing={sorted(expected_paths - actual_paths)[:5]}, "
            f"extra={sorted(actual_paths - expected_paths)[:5]}"
        )
    for index, relative in enumerate(sorted(expected_paths), start=1):
        record = artifacts[relative]
        path = root / relative
        if path.stat().st_size != record.get("bytes"):
            raise RuntimeError(f"artifact size mismatch: {relative}")
        if digest(path) != record.get("sha256"):
            raise RuntimeError(f"artifact SHA-256 mismatch: {relative}")
        if index % 5000 == 0:
            print(f"hashed {index}/{len(expected_paths)} artifacts", flush=True)

    catalog = load_json(root / manifest["catalog"]["tasks"])
    episodes = load_json(root / manifest["catalog"]["episodes"])
    sources = load_json(root / manifest["catalog"]["sources"])
    source_by_id = {
        source["source_id"]: source
        for group in sources.get("groups", [])
        for source in group.get("sources", [])
    }
    plus_source = source_by_id.get("libero_plus_lerobot")
    plus_revision = plus_source.get("revision") if isinstance(plus_source, dict) else None
    if not isinstance(plus_revision, str) or len(plus_revision) != 40:
        raise RuntimeError("pinned LIBERO-Plus public source revision is missing")
    if len(catalog.get("families", [])) != EXPECTED["task_families"]:
        raise RuntimeError("task family count mismatch")
    if len(catalog.get("details", {})) != EXPECTED["task_families"]:
        raise RuntimeError("task detail count mismatch")
    if len(catalog.get("task_shards", {})) != EXPECTED["task_families"]:
        raise RuntimeError("task shard count mismatch")
    if len(catalog.get("replay_tasks", {})) != len(episodes):
        raise RuntimeError("replay lookup count mismatch")
    dataset_counts: dict[str, int] = {}
    episode_by_id: dict[str, dict[str, Any]] = {}
    for episode in episodes:
        dataset = episode["dataset_id"]
        dataset_counts[dataset] = dataset_counts.get(dataset, 0) + 1
        replay_id = episode["replay_id"]
        if replay_id in episode_by_id:
            raise RuntimeError(f"duplicate episode search record: {replay_id}")
        episode_by_id[replay_id] = episode
        for required in (
            replay_asset(root, "series", replay_id, ".arrow.gz"),
            replay_asset(root, "thumbnails", replay_id, ".webp"),
        ):
            if not required.is_file():
                raise RuntimeError(f"required replay artifact missing: {required}")
        thumbnail = replay_asset(root, "thumbnails", replay_id, ".webp")
        if webp_size(thumbnail) != (128, 128):
            raise RuntimeError(f"thumbnail is not 128 x 128: {thumbnail}")
    if dataset_counts != {
        "original_libero": EXPECTED["original_episodes"],
        "lerobot_libero_plus": EXPECTED["plus_training_episodes"],
    }:
        raise RuntimeError(f"episode dataset counts mismatch: {dataset_counts}")

    shard_replay_ids: set[str] = set()
    for task_key, relative in catalog["task_shards"].items():
        shard = load_json(root / relative)
        if shard.get("task_key") != task_key:
            raise RuntimeError(f"task shard identity mismatch: {relative}")
        datasets = shard.get("datasets")
        if not isinstance(datasets, dict) or set(datasets) != {
            "original_libero",
            "lerobot_libero_plus",
        }:
            raise RuntimeError(f"task shard dataset contract mismatch: {relative}")
        for dataset_id, entries in datasets.items():
            if not isinstance(entries, list):
                raise RuntimeError(f"task shard entries are invalid: {relative}/{dataset_id}")
            for entry in entries:
                if not isinstance(entry, dict) or set(entry) != {"record", "manifest"}:
                    raise RuntimeError(f"task shard entry contract mismatch: {relative}")
                record = entry["record"]
                replay = entry["manifest"]
                replay_id = record.get("replay_id")
                if replay_id in shard_replay_ids:
                    raise RuntimeError(f"duplicate replay in task shards: {replay_id}")
                if episode_by_id.get(replay_id) != record:
                    raise RuntimeError(f"task shard record differs from search index: {replay_id}")
                if catalog["replay_tasks"].get(replay_id) != task_key:
                    raise RuntimeError(f"replay lookup task mismatch: {replay_id}")
                validate_replay_manifest(record, replay, task_key, plus_revision)
                shard_replay_ids.add(replay_id)
    if shard_replay_ids != set(episode_by_id):
        raise RuntimeError(
            "task shard replay set mismatch: "
            f"missing={sorted(set(episode_by_id) - shard_replay_ids)[:5]}, "
            f"extra={sorted(shard_replay_ids - set(episode_by_id))[:5]}"
        )
    if any(
        source.get("role") == "competition_selection"
        for group in sources["groups"]
        for source in group["sources"]
    ):
        raise RuntimeError("competition-specific source leaked into public export")

    samples = [episodes[0]["replay_id"], episodes[-1]["replay_id"]]
    for replay_id in samples:
        with gzip.open(
            replay_asset(root, "series", replay_id, ".arrow.gz"), "rb"
        ) as stream:
            table = ipc.open_file(stream).read_all()
        if table.num_rows != 1 or table.column("shapes")[0].as_py() is None:
            raise RuntimeError(f"Arrow series contract mismatch: {replay_id}")

    summary = {
        "revision": manifest["revision"],
        "artifacts": len(artifacts),
        "bytes": sum(record["bytes"] for record in artifacts.values()),
        "episodes": dataset_counts,
        "sources": sum(len(group["sources"]) for group in sources["groups"]),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
