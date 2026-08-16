#!/usr/bin/env python3
"""Seal a validated hosted v1 snapshot and evaluation scenes into hosted v2.

The migration is intentionally one-way. Unchanged v1 artifacts are hard-linked,
legacy LIBERO-Plus video intervals are normalized to the per-episode public MP4
timebase, gzip series headers are stripped of exporter process identifiers,
evaluation scene assets are added under ``evaluation-scenes``, and both the
integrity index and top-level manifest are regenerated. The final manifest is
written last.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from validate_hosted_data import load_json, reject_symlinks, validate_evaluation_scenes

SCHEMA_VERSION = "libero-eda-hosted/v2"
OWNER = {"schema_version": SCHEMA_VERSION, "owner": "libero-eda-v2-upgrader"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-v1", type=Path, required=True)
    parser.add_argument("--evaluation-scenes", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def write_json(path: Path, value: Any) -> None:
    payload = (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode()
    if path.exists():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != payload:
            raise RuntimeError(f"existing output JSON differs: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temporary.exists():
        raise RuntimeError(f"unowned temporary file exists: {temporary}")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            stream.write(payload.decode())
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def write_bytes(path: Path, payload: bytes) -> None:
    if path.exists():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != payload:
            raise RuntimeError(f"existing output artifact differs: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temporary.exists():
        raise RuntimeError(f"unowned temporary file exists: {temporary}")
    try:
        with temporary.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def owned_output(path: Path) -> Path:
    output = path.resolve()
    marker = output / ".libero-eda-export.json"
    if output.exists():
        if marker.is_symlink() or not marker.is_file() or load_json(marker) != OWNER:
            raise RuntimeError(f"output is not owned by the v2 upgrader: {output}")
    else:
        output.mkdir(parents=True)
        write_json(marker, OWNER)
    if (output / "manifest.json").exists():
        raise RuntimeError(f"completed hosted v2 output already exists: {output}")
    return output


def hardlink(source: Path, target: Path, expected: dict[str, Any]) -> None:
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"source artifact is missing or is a symlink: {source}")
    if (
        source.stat().st_size != expected["bytes"]
        or digest(source) != expected["sha256"]
    ):
        raise RuntimeError(
            f"source artifact differs from its validated index: {source}"
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if (
            target.is_symlink()
            or target.stat().st_size != expected["bytes"]
            or digest(target) != expected["sha256"]
        ):
            raise RuntimeError(f"existing output artifact differs: {target}")
        return
    os.link(source, target, follow_symlinks=False)


def validate_source_artifact(source: Path, expected: dict[str, Any]) -> None:
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"source artifact is missing or is a symlink: {source}")
    if (
        source.stat().st_size != expected["bytes"]
        or digest(source) != expected["sha256"]
    ):
        raise RuntimeError(
            f"source artifact differs from its validated index: {source}"
        )


def normalized_gzip_series(source: Path) -> bytes:
    """Remove the non-semantic source filename from one validated gzip member."""

    payload = source.read_bytes()
    if len(payload) < 19 or payload[:3] != b"\x1f\x8b\x08":
        raise RuntimeError(f"series artifact is not a valid gzip stream: {source}")
    flags = payload[3]
    if flags != 0x08:
        raise RuntimeError(
            f"series gzip header has unsupported flags 0x{flags:02x}: {source}"
        )
    filename_end = payload.find(b"\x00", 10)
    if filename_end < 10:
        raise RuntimeError(f"series gzip filename is not terminated: {source}")
    normalized = payload[:3] + b"\x00" + payload[4:10] + payload[filename_end + 1 :]
    if gzip.decompress(normalized) != gzip.decompress(payload):
        raise RuntimeError(f"series gzip normalization changed its payload: {source}")
    return normalized


def normalized_task_shard(value: dict[str, Any]) -> dict[str, Any]:
    normalized = json.loads(json.dumps(value))
    datasets = normalized.get("datasets")
    if not isinstance(datasets, dict):
        raise RuntimeError("task shard datasets are invalid")
    plus_rows = datasets.get("lerobot_libero_plus")
    if not isinstance(plus_rows, list):
        raise RuntimeError("task shard LIBERO-Plus rows are missing")
    for row in plus_rows:
        if not isinstance(row, dict):
            raise RuntimeError("task shard LIBERO-Plus row is invalid")
        manifest = row.get("manifest")
        if not isinstance(manifest, dict):
            raise RuntimeError("task shard LIBERO-Plus manifest is missing")
        state_count = manifest.get("state_count")
        fps = manifest.get("fps")
        videos = manifest.get("videos")
        if (
            not isinstance(state_count, int)
            or state_count < 1
            or not isinstance(fps, (int, float))
            or not math.isfinite(fps)
            or fps <= 0
            or not isinstance(videos, list)
        ):
            raise RuntimeError("task shard LIBERO-Plus timebase is invalid")
        expected_duration = state_count / fps
        for video in videos:
            if not isinstance(video, dict):
                raise RuntimeError("task shard LIBERO-Plus video is invalid")
            start = video.get("start_time_sec")
            end = video.get("end_time_sec")
            offset = video.get("frame_offset")
            if (
                not isinstance(start, (int, float))
                or not isinstance(end, (int, float))
                or offset != 0
                or not math.isfinite(start)
                or not math.isfinite(end)
                or start < 0
                or not math.isclose(
                    end - start,
                    expected_duration,
                    rel_tol=0,
                    abs_tol=1e-9,
                )
            ):
                raise RuntimeError(
                    "legacy LIBERO-Plus video interval cannot be normalized: "
                    f"{manifest.get('replay_id')}/{video.get('camera')}"
                )
            video["start_time_sec"] = 0.0
            video["end_time_sec"] = expected_duration
            video["frame_offset"] = 0
    return normalized


def updated_sources(source: dict[str, Any]) -> dict[str, Any]:
    value = json.loads(json.dumps(source))
    groups = value.get("groups")
    if not isinstance(groups, list):
        raise RuntimeError("source registry groups are invalid")
    matches = [
        group for group in groups if group.get("group_id") == "libero_plus_evaluation"
    ]
    if len(matches) != 1:
        raise RuntimeError("LIBERO-Plus evaluation source group is missing")
    group = matches[0]
    group["purpose"] = (
        "Official changed simulator conditions and interactive initial-state reconstructions"
    )
    sources = group.get("sources")
    if not isinstance(sources, list):
        raise RuntimeError("LIBERO-Plus evaluation source list is invalid")
    definitions = [
        item
        for item in sources
        if item.get("source_id") == "libero_plus_evaluation_definitions"
    ]
    assets = [item for item in sources if item.get("source_id") == "libero_plus_assets"]
    if len(definitions) != 1 or len(assets) != 1:
        raise RuntimeError("LIBERO-Plus evaluation source records are missing")
    definitions[0]["structure"].extend(
        [
            "official initial-state index 0",
            "five zero-action settling steps from benchmark_scripts/render_single_task.py",
            "deterministic environment construction and reset seed 10000",
        ]
    )
    assets[0]["structure"].extend(
        [
            "official 6,395,849,578-byte assets.zip verified by SHA-256",
            "448,799 extracted files verified by path, byte size, and content tree SHA-256",
            "content-addressed browser geometry packs",
            "content-addressed source textures and per-condition material, light, camera, and pose state",
        ]
    )
    assets[0]["counts"]["extracted_files"] = 448_799
    return value


def main() -> None:
    args = parse_args()
    source = args.source_v1.resolve(strict=True)
    scenes = args.evaluation_scenes.resolve(strict=True)
    output = owned_output(args.output)
    if (
        output == source
        or output == scenes
        or output.is_relative_to(source)
        or output.is_relative_to(scenes)
    ):
        raise RuntimeError("v2 output must be independent from both inputs")

    subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("validate_hosted_data.py")),
            str(source),
            "--allow-v1",
        ],
        check=True,
    )
    source_manifest = load_json(source / "manifest.json")
    if source_manifest.get("schema_version") != "libero-eda-hosted/v1":
        raise RuntimeError("migration source is not hosted v1")
    source_integrity = load_json(source / source_manifest["integrity"]["index"])
    source_artifacts = source_integrity.get("artifacts")
    if not isinstance(source_artifacts, dict) or not source_artifacts:
        raise RuntimeError("v1 integrity index has no artifacts")
    source_catalog = load_json(source / source_manifest["catalog"]["tasks"])
    task_shards = source_catalog.get("task_shards")
    if not isinstance(task_shards, dict) or len(task_shards) != 130:
        raise RuntimeError("v1 task shard registry is invalid")
    task_shard_relatives = set(task_shards.values())
    if len(task_shard_relatives) != 130 or not all(
        isinstance(relative, str) for relative in task_shard_relatives
    ):
        raise RuntimeError("v1 task shard paths are invalid")
    if not task_shard_relatives.issubset(source_artifacts):
        raise RuntimeError("v1 task shard is missing from the integrity index")
    validate_evaluation_scenes(
        scenes,
        {"evaluation": {"scene_manifest": "manifest.json"}},
        source_catalog,
    )

    new_artifacts: dict[str, dict[str, Any]] = {}
    source_registry_relative = source_manifest["catalog"]["sources"]
    release_root = Path(__file__).resolve().parent.parent / "data-repository"
    reject_symlinks(release_root, "versioned data repository files")
    release_files = {
        path.relative_to(release_root).as_posix(): path
        for path in release_root.rglob("*")
        if path.is_file() and not path.is_symlink()
    }
    if not release_files:
        raise RuntimeError("versioned data-repository files are missing")
    for relative, record in sorted(source_artifacts.items()):
        if (
            relative == source_registry_relative
            or relative in release_files
            or relative in task_shard_relatives
        ):
            continue
        if not isinstance(record, dict) or set(record) != {"bytes", "sha256"}:
            raise RuntimeError(f"v1 integrity record is invalid: {relative}")
        source_path = source / relative
        if relative.startswith("assets/series/") and relative.endswith(".arrow.gz"):
            validate_source_artifact(source_path, record)
            target = output / relative
            write_bytes(target, normalized_gzip_series(source_path))
            new_artifacts[relative] = {
                "bytes": target.stat().st_size,
                "sha256": digest(target),
            }
        else:
            hardlink(source_path, output / relative, record)
            new_artifacts[relative] = record

    registry = updated_sources(load_json(source / source_registry_relative))
    write_json(output / source_registry_relative, registry)
    registry_record = {
        "bytes": (output / source_registry_relative).stat().st_size,
        "sha256": digest(output / source_registry_relative),
    }
    new_artifacts[source_registry_relative] = registry_record

    for relative in sorted(task_shard_relatives):
        source_record = source_artifacts[relative]
        if not isinstance(source_record, dict) or set(source_record) != {
            "bytes",
            "sha256",
        }:
            raise RuntimeError(f"v1 task shard integrity record is invalid: {relative}")
        source_path = source / relative
        validate_source_artifact(source_path, source_record)
        target = output / relative
        write_json(target, normalized_task_shard(load_json(source_path)))
        new_artifacts[relative] = {
            "bytes": target.stat().st_size,
            "sha256": digest(target),
        }

    for relative, path in sorted(release_files.items()):
        target = output / relative
        write_bytes(target, path.read_bytes())
        new_artifacts[relative] = {
            "bytes": target.stat().st_size,
            "sha256": digest(target),
        }

    scene_files = sorted(
        path
        for path in scenes.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and path.name != ".libero-evaluation-scenes.json"
        and "receipts" not in path.relative_to(scenes).parts
    )
    if not scene_files or scenes / "manifest.json" not in scene_files:
        raise RuntimeError("evaluation scene release artifacts are missing")
    for path in scene_files:
        relative = Path("evaluation-scenes") / path.relative_to(scenes)
        record = {"bytes": path.stat().st_size, "sha256": digest(path)}
        hardlink(path, output / relative, record)
        new_artifacts[relative.as_posix()] = record

    expected_paths = set(new_artifacts)
    excluded_output_paths = {
        ".libero-eda-export.json",
        "manifest.json",
        "integrity/artifacts.json",
    }
    reject_symlinks(output, "v2 staging output")
    actual_paths = {
        relative
        for path in output.rglob("*")
        if path.is_file()
        and (relative := path.relative_to(output).as_posix())
        not in excluded_output_paths
    }
    if actual_paths != expected_paths:
        raise RuntimeError(
            f"v2 staging path mismatch: missing={sorted(expected_paths - actual_paths)[:5]}, "
            f"extra={sorted(actual_paths - expected_paths)[:5]}"
        )

    integrity_path = output / "integrity/artifacts.json"
    write_json(
        integrity_path,
        {
            "schema_version": "libero-eda-integrity/v1",
            "artifact_count": len(new_artifacts),
            "artifact_bytes": sum(item["bytes"] for item in new_artifacts.values()),
            "artifacts": new_artifacts,
        },
    )
    manifest = {
        **source_manifest,
        "schema_version": SCHEMA_VERSION,
        "revision": hashlib.sha256(
            json.dumps(new_artifacts, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "generated_at": datetime.now(UTC).isoformat(),
        "evaluation": {
            **source_manifest["evaluation"],
            "scene_manifest": "evaluation-scenes/manifest.json",
        },
        "integrity": {
            "index": "integrity/artifacts.json",
            "bytes": integrity_path.stat().st_size,
            "sha256": digest(integrity_path),
            "artifact_count": len(new_artifacts),
            "artifact_bytes": sum(item["bytes"] for item in new_artifacts.values()),
        },
    }
    write_json(output / "manifest.json", manifest)
    print(
        json.dumps(
            {
                "output": str(output),
                "revision": manifest["revision"],
                "artifacts": len(new_artifacts),
                "artifact_bytes": manifest["integrity"]["artifact_bytes"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
