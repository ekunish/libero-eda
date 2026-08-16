#!/usr/bin/env python3
"""Validate a sparse hosted v4 patch against its immutable hosted v3 base."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from upgrade_hosted_data_v4 import SCHEMA_VERSION, artifact_index, digest, valid_sha256
from validate_hosted_data import load_json, reject_symlinks


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("patch", type=Path)
    parser.add_argument("--base-v3", type=Path, required=True)
    return parser.parse_args()


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
    base = args.base_v3.resolve(strict=True)
    if patch == base or patch.is_relative_to(base) or base.is_relative_to(patch):
        raise RuntimeError("patch and base must be independent directories")
    reject_symlinks(patch, "hosted v4 patch")
    base_manifest = load_json(base / "manifest.json")
    if base_manifest.get("schema_version") != "libero-eda-hosted/v3":
        raise RuntimeError("patch base is not hosted v3")
    base_artifacts = artifact_index(base, base_manifest)

    manifest = load_json(patch / "manifest.json")
    if manifest.get("schema_version") != SCHEMA_VERSION or manifest.get(
        "counts"
    ) != base_manifest.get("counts"):
        raise RuntimeError("hosted v4 patch manifest contract mismatch")
    artifacts = artifact_index(patch, manifest)
    if not set(base_artifacts).issubset(artifacts):
        raise RuntimeError("hosted v4 patch removes a base artifact")
    expected_revision = hashlib.sha256(
        json.dumps(artifacts, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    if manifest.get("revision") != expected_revision:
        raise RuntimeError("hosted v4 content revision mismatch")

    excluded = {".libero-eda-export.json", "manifest.json", "integrity/artifacts.json"}
    local = {
        path.relative_to(patch).as_posix()
        for path in patch.rglob("*")
        if path.is_file() and path.relative_to(patch).as_posix() not in excluded
    }
    changed = {
        relative
        for relative, record in artifacts.items()
        if base_artifacts.get(relative) != record
    }
    support = local - changed
    allowed_support = {
        manifest["catalog"]["tasks"],
        manifest["catalog"]["episodes"],
        "README.md",
        "DATA_LICENSES.md",
        "LICENSES/LIBERO-EDA-APACHE-2.0.txt",
        "LICENSES/LIBERO-MIT.txt",
    }
    if changed - local or not support.issubset(allowed_support):
        raise RuntimeError(
            f"v4 patch path mismatch: missing={sorted(changed - local)[:5]}, support={sorted(support)}"
        )
    for relative in sorted(local):
        record = validate_record(relative, artifacts[relative])
        path = patch / relative
        if path.stat().st_size != record["bytes"] or digest(path) != record["sha256"]:
            raise RuntimeError(f"v4 patch artifact integrity mismatch: {relative}")

    top = manifest.get("training_appearances")
    if (
        not isinstance(top, dict)
        or top.get("schema_version") != "libero-plus-training-appearance-match/v1"
        or top.get("source_tasks") != 40
        or top.get("candidates") != 4_000
        or top.get("episodes") != 14_347
        or sum(top.get("statuses", {}).values()) != 14_347
        or top.get("motion_compatibility")
        != {
            "candidate_only_fixed_bodies": ["living_room_table_col"],
            "static_initial_scene_episodes": 1,
        }
    ):
        raise RuntimeError("hosted v4 appearance summary mismatch")
    candidate_manifest = load_json(patch / top["candidate_manifest"])
    if (
        candidate_manifest.get("schema_version")
        != "libero-plus-training-appearance-candidates/v1"
        or candidate_manifest.get("status") != "complete"
        or len(candidate_manifest.get("tasks", {})) != 40
        or any(
            "reference_bank" in task
            for task in candidate_manifest.get("tasks", {}).values()
        )
    ):
        raise RuntimeError("public appearance candidate manifest mismatch")
    if any("references" in Path(relative).parts for relative in artifacts):
        raise RuntimeError("offline candidate references are indexed for publication")
    match_manifest = load_json(patch / top["match_manifest"])
    match_path = (patch / top["match_manifest"]).parent / match_manifest["matches"][
        "path"
    ]
    matches = load_json(match_path)
    if (
        match_manifest.get("schema_version")
        != "libero-plus-training-appearance-matches/v1"
        or match_manifest.get("status") != "complete"
        or match_manifest.get("comparison", {}).get("fallback") != "forbidden"
        or len(matches) != 14_347
    ):
        raise RuntimeError("appearance match provenance mismatch")
    expected_statuses = Counter(item.get("status") for item in matches)
    normalized_statuses = {
        key: expected_statuses[key]
        for key in ("matched", "unmatched", "not_applicable")
    }
    if normalized_statuses != top["statuses"]:
        raise RuntimeError("appearance match status summary mismatch")

    catalog = load_json(patch / manifest["catalog"]["tasks"])
    task_shards = catalog.get("task_shards")
    if not isinstance(task_shards, dict) or len(task_shards) != 130:
        raise RuntimeError("hosted v4 task-shard registry mismatch")
    embedded: Counter[str] = Counter()
    plus_count = 0
    static_initial_scenes = 0
    for task_key, relative in task_shards.items():
        if relative not in local:
            continue
        shard = load_json(patch / relative)
        if shard.get("task_key") != task_key:
            raise RuntimeError(f"hosted v4 task shard identity mismatch: {task_key}")
        for entry in shard["datasets"]["lerobot_libero_plus"]:
            reconstruction = entry["manifest"].get("scene_reconstruction")
            match = (
                reconstruction.get("appearance_match")
                if isinstance(reconstruction, dict)
                else None
            )
            if (
                not isinstance(reconstruction, dict)
                or reconstruction.get("schema_version")
                != "libero-plus-training-scene-proxy/v2"
                or not isinstance(match, dict)
                or match.get("schema_version")
                != "libero-plus-training-appearance-match/v1"
            ):
                raise RuntimeError(
                    f"hosted v4 replay appearance contract mismatch: {task_key}"
                )
            embedded[match.get("status")] += 1
            replay = entry["manifest"]
            if (
                match.get("status") == "matched"
                and not replay.get("body_names")
                and replay.get("scene_asset_id") is None
                and replay.get("scene_series_asset_id") is None
                and reconstruction.get("object_motion") == "not_published"
            ):
                static_initial_scenes += 1
            plus_count += 1
    embedded_statuses = {
        key: embedded[key] for key in ("matched", "unmatched", "not_applicable")
    }
    if (
        plus_count != 14_347
        or embedded_statuses != top["statuses"]
        or static_initial_scenes != 1
    ):
        raise RuntimeError("hosted v4 embedded appearance coverage mismatch")
    print(
        json.dumps(
            {
                "patch": str(patch),
                "revision": manifest["revision"],
                "changed_artifacts": len(changed),
                "staged_bytes": sum(
                    (patch / relative).stat().st_size for relative in local
                ),
                "appearance_statuses": top["statuses"],
                "status": "valid",
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
