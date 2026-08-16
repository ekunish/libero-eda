#!/usr/bin/env python3
"""Validate a hosted v3 patch against its immutable hosted v2 base index."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from upgrade_hosted_data_v3 import PROXY_SCHEMA, SCHEMA_VERSION, validate_sparse_source
from validate_hosted_data import load_json, reject_symlinks

SHA256 = set("0123456789abcdef")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("patch", type=Path)
    parser.add_argument("--base-v2", type=Path, required=True)
    return parser.parse_args()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= SHA256


def validate_record(relative: str, record: Any) -> dict[str, Any]:
    if (
        not relative
        or Path(relative).is_absolute()
        or ".." in Path(relative).parts
        or not isinstance(record, dict)
        or set(record) != {"bytes", "sha256"}
        or not isinstance(record["bytes"], int)
        or record["bytes"] < 0
        or not valid_sha256(record["sha256"])
    ):
        raise RuntimeError(f"invalid artifact record: {relative!r}")
    return record


def main() -> None:
    args = parse_args()
    patch = args.patch.resolve(strict=True)
    base = args.base_v2.resolve(strict=True)
    if patch == base or patch.is_relative_to(base) or base.is_relative_to(patch):
        raise RuntimeError("patch and base must be independent directories")
    reject_symlinks(patch, "hosted v3 patch")
    base_manifest = load_json(base / "manifest.json")
    base_artifacts = validate_sparse_source(base, base_manifest)

    manifest = load_json(patch / "manifest.json")
    if manifest.get("schema_version") != SCHEMA_VERSION or manifest.get(
        "counts"
    ) != base_manifest.get("counts"):
        raise RuntimeError("hosted v3 patch manifest contract mismatch")
    integrity = manifest.get("integrity")
    if (
        not isinstance(integrity, dict)
        or integrity.get("index") != "integrity/artifacts.json"
    ):
        raise RuntimeError("hosted v3 patch integrity contract is missing")
    integrity_path = patch / integrity["index"]
    if (
        integrity_path.is_symlink()
        or not integrity_path.is_file()
        or integrity_path.stat().st_size != integrity.get("bytes")
        or digest(integrity_path) != integrity.get("sha256")
    ):
        raise RuntimeError("hosted v3 patch integrity index mismatch")
    index = load_json(integrity_path)
    artifacts = index.get("artifacts")
    if (
        index.get("schema_version") != "libero-eda-integrity/v1"
        or not isinstance(artifacts, dict)
        or not artifacts
    ):
        raise RuntimeError("hosted v3 artifact index is invalid")
    total_bytes = sum(
        validate_record(relative, record)["bytes"]
        for relative, record in artifacts.items()
    )
    if (
        index.get("artifact_count") != len(artifacts)
        or integrity.get("artifact_count") != len(artifacts)
        or index.get("artifact_bytes") != total_bytes
        or integrity.get("artifact_bytes") != total_bytes
    ):
        raise RuntimeError("hosted v3 artifact aggregates are invalid")
    expected_revision = hashlib.sha256(
        json.dumps(artifacts, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    if manifest.get("revision") != expected_revision:
        raise RuntimeError("hosted v3 content revision mismatch")
    if not set(base_artifacts).issubset(artifacts):
        raise RuntimeError("hosted v3 patch removes base artifacts")

    excluded = {".libero-eda-export.json", "manifest.json", integrity["index"]}
    local_paths = {
        path.relative_to(patch).as_posix()
        for path in patch.rglob("*")
        if path.is_file() and path.relative_to(patch).as_posix() not in excluded
    }
    changed = {
        relative
        for relative, record in artifacts.items()
        if base_artifacts.get(relative) != record
    }
    support = local_paths - changed
    allowed_support = {
        manifest["catalog"]["episodes"],
        manifest["catalog"]["tasks"],
        "README.md",
        "DATA_LICENSES.md",
        "LICENSES/LIBERO-EDA-APACHE-2.0.txt",
        "LICENSES/LIBERO-MIT.txt",
    }
    if changed - local_paths or not support.issubset(allowed_support):
        raise RuntimeError(
            f"patch path contract mismatch: missing={sorted(changed - local_paths)[:5]}, "
            f"support={sorted(support)}"
        )
    for relative in sorted(local_paths):
        path = patch / relative
        record = artifacts[relative]
        if path.stat().st_size != record["bytes"] or digest(path) != record["sha256"]:
            raise RuntimeError(f"patch artifact integrity mismatch: {relative}")

    catalog = load_json(patch / manifest["catalog"]["tasks"])
    task_shards = catalog.get("task_shards")
    if not isinstance(task_shards, dict) or len(task_shards) != 130:
        raise RuntimeError("hosted v3 task-shard registry is invalid")
    top = manifest.get("training_reconstructions")
    if (
        not isinstance(top, dict)
        or top.get("schema_version") != PROXY_SCHEMA
        or top.get("plus_episodes") != 14_347
        or top.get("exact_action_matches") != 12_609
        or top.get("simulated_or_unavailable_episodes") != 1_738
        or top.get("unique_reconstructions") != 207
    ):
        raise RuntimeError("hosted v3 reconstruction summary is invalid")
    provenance_path = patch / top["source_manifest"]
    provenance = load_json(provenance_path)
    mapping_record = provenance.get("mappings")
    if not isinstance(mapping_record, dict):
        raise RuntimeError("reconstruction mapping record is missing")
    mapping_path = provenance_path.parent / mapping_record.get("path", "")
    if mapping_path.stat().st_size != mapping_record.get("bytes") or digest(
        mapping_path
    ) != mapping_record.get("sha256"):
        raise RuntimeError("reconstruction mapping integrity mismatch")
    mappings = load_json(mapping_path)
    mapping_by_id = {item.get("replay_id"): item for item in mappings}
    if len(mappings) != 14_347 or len(mapping_by_id) != 14_347:
        raise RuntimeError("reconstruction mapping coverage is invalid")

    originals: dict[str, dict[str, Any]] = {}
    plus: dict[str, dict[str, Any]] = {}
    methods: Counter[str] = Counter()
    for task_key, relative in task_shards.items():
        shard = load_json(patch / relative)
        if shard.get("task_key") != task_key:
            raise RuntimeError(f"task shard identity mismatch: {relative}")
        for entry in shard["datasets"]["original_libero"]:
            replay = entry["manifest"]
            if (
                replay.get("scene_series_asset_id") is not None
                or replay.get("scene_reconstruction") is not None
            ):
                raise RuntimeError(
                    f"Original replay claims reconstruction: {replay['replay_id']}"
                )
            originals[replay["replay_id"]] = replay
        for entry in shard["datasets"]["lerobot_libero_plus"]:
            replay = entry["manifest"]
            replay_id = replay["replay_id"]
            reconstruction = replay.get("scene_reconstruction")
            mapping = mapping_by_id.get(replay_id)
            if not isinstance(reconstruction, dict) or not isinstance(mapping, dict):
                raise RuntimeError(f"Plus reconstruction is missing: {replay_id}")
            if reconstruction.get("schema_version") != PROXY_SCHEMA:
                raise RuntimeError(f"Plus reconstruction schema mismatch: {replay_id}")
            for key in (
                "reconstruction_id",
                "method",
                "source_replay_id",
                "source_action_sha256",
                "appearance",
                "object_motion",
            ):
                if reconstruction.get(key) != mapping.get(key):
                    raise RuntimeError(
                        f"reconstruction mapping mismatch: {replay_id}/{key}"
                    )
            mapping_metrics = mapping.get("metrics")
            if not isinstance(mapping_metrics, dict) or reconstruction.get(
                "metrics"
            ) != {
                key: mapping_metrics.get(key)
                for key in (
                    "position_rmse_m",
                    "position_max_m",
                    "orientation_rmse_rad",
                    "gripper_mae",
                )
            }:
                raise RuntimeError(
                    f"reconstruction mapping mismatch: {replay_id}/metrics"
                )
            method = reconstruction["method"]
            methods[method] += 1
            has_scene = replay.get("scene_asset_id") is not None
            has_motion = replay.get("scene_series_asset_id") is not None
            if (method == "unavailable") != (not has_scene or not has_motion):
                raise RuntimeError(f"reconstruction availability mismatch: {replay_id}")
            for artifact in (
                replay.get("scene_asset_id"),
                replay.get("scene_series_asset_id"),
            ):
                if artifact is not None and artifact not in artifacts:
                    raise RuntimeError(
                        f"reconstruction asset is not indexed: {replay_id}"
                    )
            plus[replay_id] = replay
    if (
        len(originals) != 6_500
        or len(plus) != 14_347
        or set(plus) != set(mapping_by_id)
    ):
        raise RuntimeError("hosted v3 replay coverage mismatch")
    for replay_id, replay in plus.items():
        reconstruction = replay["scene_reconstruction"]
        source = originals.get(reconstruction["source_replay_id"])
        if not source or source.get("task_key") != replay.get("task_key"):
            raise RuntimeError(f"reconstruction source mismatch: {replay_id}")
        if reconstruction["method"] == "original_action_match_proxy" and (
            replay.get("scene_asset_id") != source.get("scene_asset_id")
            or replay.get("scene_series_asset_id") != source.get("series_asset_id")
            or replay.get("body_names") != source.get("body_names")
        ):
            raise RuntimeError(f"Original proxy mismatch: {replay_id}")
    method_counts = dict(sorted(methods.items()))
    if method_counts != top.get("methods") or method_counts != provenance.get(
        "counts", {}
    ).get("episode_methods"):
        raise RuntimeError("hosted v3 method counts mismatch")

    print(
        json.dumps(
            {
                "revision": manifest["revision"],
                "artifacts": len(artifacts),
                "patch_files": len(local_paths),
                "artifact_bytes": total_bytes,
                "methods": method_counts,
                "status": "valid",
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
