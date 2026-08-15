#!/usr/bin/env python3
"""Fail-closed validation for a complete libero-eda-hosted/v1 export."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any

import pyarrow.ipc as ipc

EXPECTED = {
    "task_families": 130,
    "original_episodes": 6_500,
    "plus_training_episodes": 14_347,
    "evaluation_conditions": 10_030,
}


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
    if len(catalog.get("families", [])) != EXPECTED["task_families"]:
        raise RuntimeError("task family count mismatch")
    if len(catalog.get("details", {})) != EXPECTED["task_families"]:
        raise RuntimeError("task detail count mismatch")
    if len(catalog.get("task_shards", {})) != EXPECTED["task_families"]:
        raise RuntimeError("task shard count mismatch")
    if len(catalog.get("replay_tasks", {})) != len(episodes):
        raise RuntimeError("replay lookup count mismatch")
    dataset_counts: dict[str, int] = {}
    for episode in episodes:
        dataset = episode["dataset_id"]
        dataset_counts[dataset] = dataset_counts.get(dataset, 0) + 1
        replay_id = episode["replay_id"]
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
