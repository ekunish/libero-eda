#!/usr/bin/env python3
"""Add fail-closed LIBERO-Plus training-scene proxies to hosted v2.

The browser continues to use the published LIBERO-Plus video and EEF series as
ground truth.  This migration only attaches an explicitly approximate canonical
Original LIBERO scene and a separately addressable body-motion series.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from export_hosted_data import derivatives, write_series
from validate_hosted_data import load_json, reject_symlinks

SCHEMA_VERSION = "libero-eda-hosted/v3"
RECONSTRUCTION_SCHEMA = "libero-plus-training-reconstructions/v1"
PROXY_SCHEMA = "libero-plus-training-scene-proxy/v1"
OWNER = {"schema_version": SCHEMA_VERSION, "owner": "libero-eda-v3-upgrader"}
EXPECTED_EPISODES = 14_347
EXPECTED_EXACT = 12_609
EXPECTED_UNMATCHED = 1_738
EXPECTED_UNIQUE = 207
SHA256 = set("0123456789abcdef")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-v2", type=Path, required=True)
    parser.add_argument("--reconstructions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--sparse-source",
        action="store_true",
        help=(
            "Treat source-v2 as a metadata-only checkout. Unchanged artifacts are "
            "inherited from the pinned v2 revision and only the release patch is staged."
        ),
    )
    return parser.parse_args()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= SHA256


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
        with temporary.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
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
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def owned_output(path: Path) -> Path:
    output = path.resolve()
    marker = output / ".libero-eda-export.json"
    if output.exists():
        if marker.is_symlink() or not marker.is_file() or load_json(marker) != OWNER:
            raise RuntimeError(f"output is not owned by the v3 upgrader: {output}")
    else:
        output.mkdir(parents=True)
        write_json(marker, OWNER)
    if (output / "manifest.json").exists():
        raise RuntimeError(f"completed hosted v3 output already exists: {output}")
    return output


def safe_artifact(root: Path, relative: Any, record: dict[str, Any]) -> Path:
    if (
        not isinstance(relative, str)
        or not relative
        or Path(relative).is_absolute()
        or ".." in Path(relative).parts
    ):
        raise RuntimeError(f"invalid artifact path: {relative!r}")
    path = root / relative
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"artifact is missing or is a symlink: {relative}")
    if (
        set(record) != {"bytes", "sha256"}
        or path.stat().st_size != record["bytes"]
        or digest(path) != record["sha256"]
    ):
        raise RuntimeError(f"artifact integrity mismatch: {relative}")
    return path


def link(source: Path, target: Path, record: dict[str, Any]) -> None:
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"source artifact is unsafe: {source}")
    if source.stat().st_size != record["bytes"] or digest(source) != record["sha256"]:
        raise RuntimeError(f"source artifact integrity mismatch: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if (
            target.is_symlink()
            or target.stat().st_size != record["bytes"]
            or digest(target) != record["sha256"]
        ):
            raise RuntimeError(f"existing linked artifact differs: {target}")
        return
    os.link(source, target, follow_symlinks=False)


def load_reconstructions(
    root: Path,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    manifest = load_json(root / "manifest.json")
    counts = manifest.get("counts", {})
    if (
        manifest.get("schema_version") != RECONSTRUCTION_SCHEMA
        or manifest.get("status") != "complete"
        or counts.get("plus_episodes") != EXPECTED_EPISODES
        or counts.get("unique_reconstructions") != EXPECTED_UNIQUE
    ):
        raise RuntimeError("training reconstruction manifest contract mismatch")
    mappings_record = manifest.get("mappings")
    reconstructions_record = manifest.get("reconstructions")
    if not isinstance(mappings_record, dict) or not isinstance(
        reconstructions_record, dict
    ):
        raise RuntimeError("training reconstruction indexes are missing")
    mappings_path = safe_artifact(
        root,
        mappings_record.get("path"),
        {
            "bytes": mappings_record.get("bytes"),
            "sha256": mappings_record.get("sha256"),
        },
    )
    reconstructions_path = safe_artifact(
        root,
        reconstructions_record.get("path"),
        {
            "bytes": reconstructions_record.get("bytes"),
            "sha256": reconstructions_record.get("sha256"),
        },
    )
    mappings = load_json(mappings_path)
    reconstructions = load_json(reconstructions_path)
    if not isinstance(mappings, list) or len(mappings) != EXPECTED_EPISODES:
        raise RuntimeError("training reconstruction mapping count mismatch")
    if not isinstance(reconstructions, list) or len(reconstructions) != EXPECTED_UNIQUE:
        raise RuntimeError("unique training reconstruction count mismatch")
    mapping_by_replay = {item.get("replay_id"): item for item in mappings}
    reconstruction_by_id = {
        item.get("reconstruction_id"): item for item in reconstructions
    }
    if len(mapping_by_replay) != len(mappings) or len(reconstruction_by_id) != len(
        reconstructions
    ):
        raise RuntimeError("duplicate training reconstruction identity")
    exact = sum(
        item.get("method") == "original_action_match_proxy" for item in mappings
    )
    if exact != EXPECTED_EXACT or len(mappings) - exact != EXPECTED_UNMATCHED:
        raise RuntimeError("training reconstruction coverage mismatch")
    return manifest, mapping_by_replay, reconstruction_by_id


def quaternion_to_axis_angle(quaternions: np.ndarray) -> np.ndarray:
    values = np.asarray(quaternions, dtype=np.float64)
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if np.any(norms <= 1e-12):
        raise RuntimeError("reconstruction contains a zero quaternion")
    values = values / norms
    values = np.where(values[:, 3:4] < 0, -values, values)
    vector = values[:, :3]
    magnitude = np.linalg.norm(vector, axis=1)
    angle = 2.0 * np.arctan2(magnitude, np.clip(values[:, 3], -1.0, 1.0))
    scale = np.divide(
        angle, magnitude, out=np.full_like(angle, 2.0), where=magnitude > 1e-12
    )
    return vector * scale[:, None]


def convert_series(
    source: Path, target: Path, state_count: int, fps: float
) -> dict[str, Any]:
    with np.load(source, allow_pickle=False) as data:
        required = {
            "ee_positions",
            "ee_orientations",
            "gripper_qpos",
            "actions",
            "joint_positions",
            "body_positions",
            "body_quaternions",
            "qpos",
            "qvel",
        }
        if not required.issubset(data.files):
            raise RuntimeError(f"reconstruction series fields are missing: {source}")
        ee = np.asarray(data["ee_positions"], dtype=np.float64)
        quaternions = np.asarray(data["ee_orientations"], dtype=np.float64)
        if ee.shape != (state_count, 3) or quaternions.shape != (state_count, 4):
            raise RuntimeError(f"reconstruction series state count mismatch: {source}")
        speed, acceleration, jerk = derivatives(ee, fps)
        arrays = {
            "time": np.arange(state_count, dtype=np.float64) / fps,
            "frame_index": np.arange(state_count, dtype=np.int32),
            "ee_positions": ee,
            "ee_axis_angle": quaternion_to_axis_angle(quaternions),
            "ee_orientations": quaternions,
            "gripper_qpos": np.asarray(data["gripper_qpos"], dtype=np.float64),
            "actions": np.asarray(data["actions"], dtype=np.float64),
            "rewards": np.empty((0,), dtype=np.float64),
            "joints": np.asarray(data["joint_positions"], dtype=np.float64),
            "body_positions": np.asarray(data["body_positions"], dtype=np.float64),
            "body_quaternions": np.asarray(data["body_quaternions"], dtype=np.float64),
            "qpos": np.asarray(data["qpos"], dtype=np.float64),
            "qvel": np.asarray(data["qvel"], dtype=np.float64),
            "chunk_boundaries": np.empty((0,), dtype=np.int32),
            "speed": speed,
            "acceleration": acceleration,
            "jerk": jerk,
        }
    if any(not np.all(np.isfinite(value)) for value in arrays.values()):
        raise RuntimeError(f"reconstruction series contains non-finite data: {source}")
    write_series(target, arrays, {})
    return {"bytes": target.stat().st_size, "sha256": digest(target)}


def metric_contract(value: Any) -> dict[str, float]:
    keys = ("position_rmse_m", "position_max_m", "orientation_rmse_rad", "gripper_mae")
    if not isinstance(value, dict):
        raise RuntimeError("reconstruction metrics are missing")
    result = {key: value.get(key) for key in keys}
    if any(
        not isinstance(item, (int, float)) or not math.isfinite(item) or item < 0
        for item in result.values()
    ):
        raise RuntimeError("reconstruction metrics are invalid")
    return result


def proxy_reason(method: str) -> str:
    return {
        "original_action_match_proxy": (
            "Task, action sequence, and length exactly match this successful Original LIBERO demo; "
            "the Original body motion is shown as a proxy."
        ),
        "mujoco_action_replay": (
            "The published action sequence was replayed in the canonical Original LIBERO scene and "
            "passed the EEF and goal validators."
        ),
        "mujoco_osc_retarget": (
            "The recorded EEF pose was retargeted through the official OSC controller in the canonical "
            "Original LIBERO scene and passed the tracking and goal validators."
        ),
        "mujoco_osc_robot_only": (
            "EEF retargeting passed, but the canonical task goal did not; only reconstructed robot motion "
            "is shown and objects remain at their canonical initial state."
        ),
        "unavailable": (
            "No reconstruction passed the published tracking limits; only the recorded video and EEF "
            "trajectory are shown."
        ),
    }[method]


def updated_sources(value: dict[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(value))
    groups = result.get("groups")
    if not isinstance(groups, list):
        raise RuntimeError("source registry groups are invalid")
    original_groups = [
        item for item in groups if item.get("group_id") == "original_libero"
    ]
    training_groups = [
        item for item in groups if item.get("group_id") == "libero_plus_training"
    ]
    if len(original_groups) != 1 or len(training_groups) != 1:
        raise RuntimeError("training reconstruction source groups are missing")
    original_sources = original_groups[0].get("sources")
    training_sources = training_groups[0].get("sources")
    if not isinstance(original_sources, list) or not isinstance(training_sources, list):
        raise RuntimeError("training reconstruction source lists are invalid")
    original_demo = [
        item
        for item in original_sources
        if item.get("source_id") == "original_libero_demonstrations"
    ]
    plus_recording = [
        item
        for item in training_sources
        if item.get("source_id") == "libero_plus_lerobot"
    ]
    if len(original_demo) != 1 or len(plus_recording) != 1:
        raise RuntimeError("training reconstruction primary sources are missing")
    original_demo[0]["structure"].append(
        "canonical scene and body-motion source for exact-action LIBERO-Plus replay proxies"
    )
    plus_recording[0]["structure"].extend(
        [
            "published video and EEF series remain the replay ground truth",
            "canonical 3D uses separately labelled Original-action matches or offline MuJoCo reconstruction",
            "Plus-specific textures, lighting, camera parameters, and hidden simulator state are not reconstructed",
        ]
    )
    training_groups[0]["purpose"] = (
        "Successful trajectories with video, state, action, official RLDS path tags, and explicitly approximate canonical 3D context"
    )
    return result


def validate_sparse_source(
    source: Path,
    manifest: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Validate the complete v2 artifact index without fetching unchanged payloads."""
    if manifest.get("schema_version") != "libero-eda-hosted/v2":
        raise RuntimeError("migration source is not hosted v2")
    integrity = manifest.get("integrity")
    if (
        not isinstance(integrity, dict)
        or integrity.get("index") != "integrity/artifacts.json"
    ):
        raise RuntimeError("hosted v2 integrity contract is missing")
    integrity_path = safe_artifact(
        source,
        integrity["index"],
        {"bytes": integrity.get("bytes"), "sha256": integrity.get("sha256")},
    )
    index = load_json(integrity_path)
    artifacts = index.get("artifacts")
    if (
        index.get("schema_version") != "libero-eda-integrity/v1"
        or not isinstance(artifacts, dict)
        or not artifacts
    ):
        raise RuntimeError("hosted v2 integrity index is invalid")
    total_bytes = 0
    for relative, record in artifacts.items():
        if (
            not isinstance(relative, str)
            or not relative
            or Path(relative).is_absolute()
            or ".." in Path(relative).parts
            or not isinstance(record, dict)
            or set(record) != {"bytes", "sha256"}
            or not isinstance(record["bytes"], int)
            or record["bytes"] < 0
            or not valid_sha256(record["sha256"])
        ):
            raise RuntimeError(f"hosted v2 artifact record is invalid: {relative!r}")
        total_bytes += record["bytes"]
    if (
        index.get("artifact_count") != len(artifacts)
        or integrity.get("artifact_count") != len(artifacts)
        or index.get("artifact_bytes") != total_bytes
        or integrity.get("artifact_bytes") != total_bytes
    ):
        raise RuntimeError("hosted v2 integrity aggregates are invalid")
    return artifacts


def main() -> None:
    args = parse_args()
    source = args.source_v2.resolve(strict=True)
    reconstructions_root = args.reconstructions.resolve(strict=True)
    output = owned_output(args.output)
    if (
        output in {source, reconstructions_root}
        or output.is_relative_to(source)
        or output.is_relative_to(reconstructions_root)
    ):
        raise RuntimeError("v3 output must be independent from both inputs")
    source_manifest = load_json(source / "manifest.json")
    if args.sparse_source:
        source_artifacts = validate_sparse_source(source, source_manifest)
    else:
        subprocess.run(
            [
                sys.executable,
                str(Path(__file__).with_name("validate_hosted_data.py")),
                str(source),
                "--allow-v2",
            ],
            check=True,
        )
        source_integrity = load_json(source / source_manifest["integrity"]["index"])
        source_artifacts = source_integrity.get("artifacts")
        if not isinstance(source_artifacts, dict) or not source_artifacts:
            raise RuntimeError("hosted v2 integrity index is missing")
    reconstruction_manifest, mappings, reconstruction_by_id = load_reconstructions(
        reconstructions_root
    )
    catalog_relative = source_manifest["catalog"]["tasks"]
    catalog = load_json(source / catalog_relative)
    task_shards = catalog.get("task_shards")
    if not isinstance(task_shards, dict) or len(task_shards) != 130:
        raise RuntimeError("hosted task-shard registry is invalid")
    task_shard_paths = set(task_shards.values())
    source_registry_relative = source_manifest["catalog"]["sources"]
    release_root = Path(__file__).resolve().parent.parent / "data-repository"
    reject_symlinks(release_root, "versioned data-repository files")
    release_files = {
        path.relative_to(release_root).as_posix(): path
        for path in release_root.rglob("*")
        if path.is_file() and not path.is_symlink()
    }
    if not release_files:
        raise RuntimeError("versioned data-repository files are missing")

    new_artifacts: dict[str, dict[str, Any]] = (
        json.loads(json.dumps(source_artifacts)) if args.sparse_source else {}
    )
    staged_paths: set[str] = set()
    for relative, record in sorted(source_artifacts.items()):
        if (
            relative in task_shard_paths
            or relative == source_registry_relative
            or relative in release_files
        ):
            continue
        if args.sparse_source:
            continue
        path = safe_artifact(source, relative, record)
        link(path, output / relative, record)
        new_artifacts[relative] = record

    if args.sparse_source:
        for relative in sorted(
            {
                source_manifest["catalog"]["episodes"],
                source_manifest["catalog"]["tasks"],
            }
        ):
            record = source_artifacts.get(relative)
            if not isinstance(record, dict):
                raise RuntimeError(f"required catalog index is not indexed: {relative}")
            path = safe_artifact(source, relative, record)
            link(path, output / relative, record)
            staged_paths.add(relative)

    original_by_id: dict[str, dict[str, Any]] = {}
    shards: dict[str, dict[str, Any]] = {}
    plus_ids: set[str] = set()
    for task_key, relative in sorted(task_shards.items()):
        record = source_artifacts.get(relative)
        if not isinstance(record, dict):
            raise RuntimeError(
                f"task shard is absent from source integrity index: {relative}"
            )
        shard = load_json(safe_artifact(source, relative, record))
        shards[task_key] = shard
        for entry in shard["datasets"]["original_libero"]:
            replay = entry["manifest"]
            original_by_id[replay["replay_id"]] = replay
        plus_ids.update(
            entry["manifest"]["replay_id"]
            for entry in shard["datasets"]["lerobot_libero_plus"]
        )
    if len(original_by_id) != 6_500 or plus_ids != set(mappings):
        raise RuntimeError(
            "reconstruction mapping does not cover the hosted replay set"
        )

    converted_series: dict[str, tuple[str, dict[str, Any]]] = {}
    methods: Counter[str] = Counter()
    for task_key, relative in sorted(task_shards.items()):
        shard = json.loads(json.dumps(shards[task_key]))
        for entry in shard["datasets"]["original_libero"]:
            replay = entry["manifest"]
            replay["scene_series_asset_id"] = None
            replay["scene_reconstruction"] = None
        for entry in shard["datasets"]["lerobot_libero_plus"]:
            replay = entry["manifest"]
            replay_id = replay["replay_id"]
            mapping = mappings[replay_id]
            method = mapping.get("method")
            methods[method] += 1
            source_replay_id = mapping.get("source_replay_id")
            source_replay = original_by_id.get(source_replay_id)
            if (
                not isinstance(source_replay, dict)
                or source_replay.get("task_key") != task_key
            ):
                raise RuntimeError(
                    f"reconstruction source replay mismatch: {replay_id}"
                )
            reconstruction_id = mapping.get("reconstruction_id")
            if not isinstance(reconstruction_id, str) or not valid_sha256(
                mapping.get("source_action_sha256")
            ):
                raise RuntimeError(f"reconstruction identity is invalid: {replay_id}")
            scene_asset_id: str | None = None
            scene_series_asset_id: str | None = None
            body_names: list[str] = []
            scene_hash: str | None = None
            scene_schema = "legacy-analysis"
            goal_success: bool | None = mapping.get("goal_success")
            metrics = metric_contract(mapping.get("metrics"))
            if method == "original_action_match_proxy":
                if not source_replay.get("scene_asset_id") or not source_replay.get(
                    "body_names"
                ):
                    raise RuntimeError(
                        f"Original proxy has no scene motion: {source_replay_id}"
                    )
                scene_asset_id = source_replay["scene_asset_id"]
                scene_series_asset_id = source_replay["series_asset_id"]
                body_names = source_replay["body_names"]
                scene_hash = source_replay["scene_hash"]
                scene_schema = source_replay["scene_schema"]
                goal_success = None
                object_motion = "original_successful_demo_proxy"
                appearance = "original_libero_canonical"
            else:
                receipt = reconstruction_by_id.get(reconstruction_id)
                if not isinstance(receipt, dict) or receipt.get("method") != method:
                    raise RuntimeError(f"reconstruction receipt mismatch: {replay_id}")
                if receipt.get("task_key") != task_key or replay_id not in receipt.get(
                    "member_replay_ids", []
                ):
                    raise RuntimeError(
                        f"reconstruction receipt membership mismatch: {replay_id}"
                    )
                object_motion = receipt.get("object_motion")
                appearance = receipt.get("appearance")
                if method != "unavailable":
                    scene_source = safe_artifact(
                        reconstructions_root,
                        receipt.get("scene"),
                        {
                            "bytes": receipt.get("scene_bytes"),
                            "sha256": receipt.get("scene_sha256"),
                        },
                    )
                    scene_hash = receipt.get("scene_hash")
                    if (
                        not valid_sha256(scene_hash)
                        or receipt.get("scene_schema") != "parc-mujoco-scene/v3"
                    ):
                        raise RuntimeError(
                            f"reconstructed scene contract mismatch: {replay_id}"
                        )
                    scene_relative = f"assets/reconstruction-scenes/{scene_hash}.glb"
                    scene_record = {
                        "bytes": receipt["scene_bytes"],
                        "sha256": receipt["scene_sha256"],
                    }
                    link(scene_source, output / scene_relative, scene_record)
                    new_artifacts.setdefault(scene_relative, scene_record)
                    scene_asset_id = scene_relative
                    scene_schema = "parc-mujoco-scene/v3"
                    body_names = receipt.get("body_names")
                    if not isinstance(body_names, list) or not body_names:
                        raise RuntimeError(
                            f"reconstructed body names are missing: {replay_id}"
                        )
                    if reconstruction_id not in converted_series:
                        source_series = safe_artifact(
                            reconstructions_root,
                            receipt.get("series"),
                            {
                                "bytes": receipt.get("series_bytes"),
                                "sha256": receipt.get("series_sha256"),
                            },
                        )
                        series_relative = (
                            f"assets/reconstruction-series/{reconstruction_id}.arrow.gz"
                        )
                        series_record = convert_series(
                            source_series,
                            output / series_relative,
                            replay["state_count"],
                            replay["fps"],
                        )
                        new_artifacts[series_relative] = series_record
                        converted_series[reconstruction_id] = (
                            series_relative,
                            series_record,
                        )
                    scene_series_asset_id = converted_series[reconstruction_id][0]
            replay.update(
                {
                    "scene_asset_id": scene_asset_id,
                    "scene_series_asset_id": scene_series_asset_id,
                    "scene_hash": scene_hash,
                    "scene_schema": scene_schema,
                    "scene_fidelity": "analysis_approximate"
                    if scene_asset_id
                    else "none",
                    "scene_fidelity_reason": proxy_reason(method),
                    "body_names": body_names,
                    "scene_cameras": [],
                    "scene_reconstruction": {
                        "schema_version": PROXY_SCHEMA,
                        "reconstruction_id": reconstruction_id,
                        "method": method,
                        "source_replay_id": source_replay_id,
                        "source_action_sha256": mapping["source_action_sha256"],
                        "appearance": appearance,
                        "object_motion": object_motion,
                        "goal_success": goal_success,
                        "metrics": metrics,
                        "reason": proxy_reason(method),
                    },
                }
            )
        target = output / relative
        write_json(target, shard)
        staged_paths.add(relative)
        new_artifacts[relative] = {
            "bytes": target.stat().st_size,
            "sha256": digest(target),
        }

    source_registry = updated_sources(load_json(source / source_registry_relative))
    source_registry_target = output / source_registry_relative
    write_json(source_registry_target, source_registry)
    staged_paths.add(source_registry_relative)
    new_artifacts[source_registry_relative] = {
        "bytes": source_registry_target.stat().st_size,
        "sha256": digest(source_registry_target),
    }

    for relative, path in sorted(release_files.items()):
        target = output / relative
        write_bytes(target, path.read_bytes())
        staged_paths.add(relative)
        new_artifacts[relative] = {
            "bytes": target.stat().st_size,
            "sha256": digest(target),
        }

    reconstruction_manifest_relative = "training-reconstructions/manifest.json"
    for name in ("manifest.json", "mappings.json", "reconstructions.json"):
        source_path = reconstructions_root / name
        if source_path.is_symlink() or not source_path.is_file():
            raise RuntimeError(f"reconstruction provenance artifact is missing: {name}")
        relative = f"training-reconstructions/{name}"
        record = {"bytes": source_path.stat().st_size, "sha256": digest(source_path)}
        link(source_path, output / relative, record)
        staged_paths.add(relative)
        new_artifacts[relative] = record
    staged_paths.update(
        relative
        for relative in new_artifacts
        if relative.startswith("assets/reconstruction-scenes/")
        or relative.startswith("assets/reconstruction-series/")
    )
    expected_paths = staged_paths if args.sparse_source else set(new_artifacts)
    excluded = {".libero-eda-export.json", "manifest.json", "integrity/artifacts.json"}
    reject_symlinks(output, "v3 staging output")
    actual_paths = {
        relative
        for path in output.rglob("*")
        if path.is_file()
        and (relative := path.relative_to(output).as_posix()) not in excluded
    }
    if actual_paths != expected_paths:
        raise RuntimeError(
            f"v3 staging path mismatch: missing={sorted(expected_paths - actual_paths)[:5]}, "
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
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "training_reconstructions": {
            "schema_version": PROXY_SCHEMA,
            "source_manifest": reconstruction_manifest_relative,
            "plus_episodes": EXPECTED_EPISODES,
            "exact_action_matches": EXPECTED_EXACT,
            "simulated_or_unavailable_episodes": EXPECTED_UNMATCHED,
            "unique_reconstructions": EXPECTED_UNIQUE,
            "methods": dict(sorted(methods.items())),
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
                "methods": manifest["training_reconstructions"]["methods"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
