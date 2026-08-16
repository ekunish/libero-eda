#!/usr/bin/env python3
"""Fail-closed validation for a complete LIBERO EDA hosted export."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import re
import struct
from collections import Counter
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
EXPECTED_EVALUATION_CATEGORIES = {
    "Background Textures": 1_076,
    "Camera Viewpoints": 1_599,
    "Language Instructions": 1_537,
    "Light Conditions": 1_142,
    "Objects Layout": 1_525,
    "Robot Initial States": 1_550,
    "Sensor Noise": 1_601,
}
LIBERO_PLUS_REVISION = "4976dc30028e805ff8094b55501d532c48fec182"
ALLOWED_SCENE_RUNTIME_SOURCE_FILES = {
    "libero/libero/benchmark/__init__.py": {
        "upstream": "70ed74d8a05cdc0808d0347536781e4a0e3d8fec45437f06e7b570f84b94e4e9",
        "pytorch_weights_only_compatibility": "ecabf4b7baf39d0c973d494bbd15e20cc981aa851981e66855117701b734fb41",
    },
    "libero/libero/envs/env_wrapper.py": {
        "upstream": "e91d7b7b35cc3ad2b073606c99860def6b3ac43b66eba00ef0ddb6bfd8f39c3c",
        "numpy_float64_compatibility": "3084614bc4b1a5a6bf83773ceaae0a6d87b8e89fed304334b483ca1313efed57",
    },
}
LIBERO_PLUS_ASSETS = {
    "repository": "Sylvest/LIBERO-plus",
    "revision": "dd2bd61b7d9a6fef1abc52d606e983b41886a149",
    "archive_sha256": "96764a4bfbdaea98d4411598caeab235458318fe0f549611b93d1a323027b3cf",
    "archive_bytes": 6_395_849_578,
    "extracted_file_count": 448_799,
    "tree_hash_schema": "libero-plus-asset-tree-sha256/v1",
    "tree_sha256": "6c4c2e638f6401304f01b2573c80af41b35b6d94838df71f6ab91f59468b7ecb",
}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def reject_symlinks(root: Path, label: str) -> None:
    for path in root.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(f"{label} contains a symlink: {path}")


def safe_artifact(root: Path, relative: Any) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise RuntimeError(f"invalid relative artifact path: {relative!r}")
    lexical = Path(relative)
    if ".." in lexical.parts:
        raise RuntimeError(f"artifact path escapes its root: {relative}")
    path = root.joinpath(lexical)
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"artifact is missing or is a symlink: {relative}")
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root.resolve(strict=True)):
        raise RuntimeError(f"artifact resolves outside its root: {relative}")
    return path


def glb_geometry_keys(path: Path) -> set[str]:
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise RuntimeError(f"truncated geometry GLB: {path}")
        magic, version, total = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or total != path.stat().st_size:
            raise RuntimeError(f"invalid geometry GLB header: {path}")
        chunk_header = stream.read(8)
        if len(chunk_header) != 8:
            raise RuntimeError(f"geometry GLB has no JSON chunk: {path}")
        length, kind = struct.unpack("<I4s", chunk_header)
        if kind != b"JSON" or length <= 0:
            raise RuntimeError(f"geometry GLB JSON chunk is invalid: {path}")
        document = json.loads(stream.read(length).decode().rstrip(" \x00"))
    extras = document.get("asset", {}).get("extras", {})
    if (
        extras.get("sceneSchema") != "libero-evaluation-geometry-pack/v1"
        or extras.get("sceneExporterRevision") != "mujoco-classic-uv3"
    ):
        raise RuntimeError(f"geometry GLB contract mismatch: {path}")
    names = [node.get("name") for node in document.get("nodes", [])]
    if not names or any(
        not isinstance(name, str) or not SHA256_PATTERN.fullmatch(name)
        for name in names
    ):
        raise RuntimeError(f"geometry GLB keys are invalid: {path}")
    if len(names) != len(set(names)):
        raise RuntimeError(f"geometry GLB keys are duplicated: {path}")
    return set(names)


def finite_vector(value: Any, size: int) -> bool:
    return (
        isinstance(value, list)
        and len(value) == size
        and all(
            isinstance(item, (int, float)) and math.isfinite(item) for item in value
        )
    )


def validate_evaluation_scenes(
    root: Path,
    manifest: dict[str, Any],
    catalog: dict[str, Any],
) -> dict[str, int]:
    evaluation = manifest.get("evaluation")
    if not isinstance(evaluation, dict):
        raise RuntimeError("evaluation manifest contract is missing")
    scene_manifest_path = safe_artifact(root, evaluation.get("scene_manifest"))
    scene_root = scene_manifest_path.parent
    reject_symlinks(scene_root, "evaluation scene release")
    scenes = load_json(scene_manifest_path)
    scene_source = scenes.get("source")
    if (
        scenes.get("schema_version") != "libero-evaluation-scenes/v1"
        or scenes.get("status") != "complete"
        or not isinstance(scene_source, dict)
        or set(scene_source)
        != {"repository", "revision", "runtime_source_files", "simulator_assets"}
        or scene_source.get("repository") != "sylvestf/LIBERO-plus"
        or scene_source.get("revision") != LIBERO_PLUS_REVISION
        or scenes.get("initialization")
        != {
            "action_dimension": 7,
            "constructor_attempt_limit": 100,
            "constructor_randomization_policy": "retry_without_reseeding",
            "environment_seed": 10_000,
            "settle_zero_actions": 5,
            "source_procedure": "LIBERO-plus/benchmark_scripts/render_single_task.py",
            "state_index": 0,
        }
    ):
        raise RuntimeError("evaluation initial-scene manifest contract mismatch")
    if scene_source.get("simulator_assets") != LIBERO_PLUS_ASSETS:
        raise RuntimeError("evaluation simulator asset snapshot mismatch")
    runtime_source_files = scene_source.get("runtime_source_files")
    if not isinstance(runtime_source_files, dict) or set(runtime_source_files) != set(
        ALLOWED_SCENE_RUNTIME_SOURCE_FILES
    ):
        raise RuntimeError("evaluation runtime source-file contract mismatch")
    for path, allowed in ALLOWED_SCENE_RUNTIME_SOURCE_FILES.items():
        item = runtime_source_files[path]
        if (
            not isinstance(item, dict)
            or set(item) != {"variant", "sha256"}
            or item.get("variant") not in allowed
            or item.get("sha256") != allowed.get(item.get("variant"))
        ):
            raise RuntimeError(f"unsupported evaluation runtime source file: {path}")
    tasks = scenes.get("tasks")
    if not isinstance(tasks, dict) or len(tasks) != 40:
        raise RuntimeError("evaluation initial-scene task index mismatch")
    source_families = {
        item["task_key"]: item
        for item in catalog.get("families", [])
        if item.get("is_plus_source") is True
    }
    if set(tasks) != set(source_families) or len(source_families) != 40:
        raise RuntimeError("evaluation initial scenes do not cover the 40 source tasks")

    condition_ids: set[str] = set()
    category_counts: Counter[str] = Counter()
    texture_keys: set[str] = set()
    expected_scene_files = {scene_manifest_path.relative_to(scene_root).as_posix()}
    geometry_count = 0
    for task_key, receipt in sorted(tasks.items()):
        if not isinstance(receipt, dict) or receipt.get("task_key") != task_key:
            raise RuntimeError(f"evaluation task receipt identity mismatch: {task_key}")
        family = source_families[task_key]
        if receipt.get("suite") != family.get("suite") or receipt.get(
            "name"
        ) != family.get("name"):
            raise RuntimeError(f"evaluation task receipt source mismatch: {task_key}")
        shard_path = safe_artifact(scene_root, receipt.get("condition_shard"))
        geometry_path = safe_artifact(scene_root, receipt.get("geometry_pack"))
        expected_scene_files.update(
            {
                shard_path.relative_to(scene_root).as_posix(),
                geometry_path.relative_to(scene_root).as_posix(),
            }
        )
        if (
            shard_path.stat().st_size != receipt.get("condition_shard_bytes")
            or digest(shard_path) != receipt.get("shard_sha256")
            or geometry_path.stat().st_size != receipt.get("geometry_bytes")
            or digest(geometry_path) != receipt.get("geometry_sha256")
        ):
            raise RuntimeError(
                f"evaluation task receipt size or SHA-256 mismatch: {task_key}"
            )
        geometry_keys = glb_geometry_keys(geometry_path)
        if len(geometry_keys) != receipt.get("geometry_count"):
            raise RuntimeError(f"evaluation geometry count mismatch: {task_key}")
        geometry_count += len(geometry_keys)
        with gzip.open(shard_path, "rt", encoding="utf-8") as stream:
            shard = json.load(stream)
        records = shard.get("records")
        if (
            shard.get("schema_version") != "libero-evaluation-scene-shard/v1"
            or shard.get("task_key") != task_key
            or shard.get("geometry_pack") != receipt.get("geometry_pack")
            or not isinstance(records, dict)
            or len(records) != receipt.get("condition_count")
        ):
            raise RuntimeError(f"evaluation scene shard contract mismatch: {task_key}")
        for condition_key, record in records.items():
            if condition_key in condition_ids:
                raise RuntimeError(
                    f"duplicate evaluation scene condition: {condition_key}"
                )
            condition_ids.add(condition_key)
            if not isinstance(record, dict):
                raise RuntimeError(
                    f"evaluation scene record is invalid: {condition_key}"
                )
            condition = record.get("condition")
            if (
                not isinstance(condition, dict)
                or condition.get("task_key") != condition_key
                or condition.get("base_task_key") != task_key
                or condition.get("suite") != family.get("suite")
                or not isinstance(condition.get("suite_id"), int)
                or not isinstance(condition.get("name"), str)
                or condition.get("difficulty") not in {None, 1, 2, 3, 4, 5}
                or condition.get("category") not in EXPECTED_EVALUATION_CATEGORIES
            ):
                raise RuntimeError(
                    f"evaluation scene condition identity mismatch: {condition_key}"
                )
            category_counts[condition["category"]] += 1
            if record.get("settings", {}).get("category") != condition["category"]:
                raise RuntimeError(
                    f"evaluation scene settings mismatch: {condition_key}"
                )
            initialization = record.get("initialization")
            if (
                not isinstance(initialization, dict)
                or initialization.get("state_index") != 0
                or initialization.get("settle_zero_actions") != 5
                or initialization.get("environment_seed") != 10_000
                or initialization.get("control_action") != [0.0] * 7
                or not all(
                    isinstance(initialization.get(key), str) and initialization[key]
                    for key in (
                        "runtime_bddl",
                        "resolved_bddl",
                        "init_state",
                        "physical_state_key",
                    )
                )
                or not all(
                    isinstance(initialization.get(key), str)
                    and SHA256_PATTERN.fullmatch(initialization[key])
                    for key in (
                        "resolved_bddl_sha256",
                        "init_state_sha256",
                        "physical_state_key",
                    )
                )
            ):
                raise RuntimeError(
                    f"evaluation initialization contract mismatch: {condition_key}"
                )
            for key in ("runtime_bddl", "resolved_bddl", "init_state"):
                source_path = Path(initialization[key])
                if source_path.is_absolute() or ".." in source_path.parts:
                    raise RuntimeError(
                        f"evaluation source path is not confined: {condition_key}: {key}"
                    )
            snapshot = record.get("snapshot")
            if (
                not isinstance(snapshot, dict)
                or snapshot.get("schema_version")
                != "libero-evaluation-scene-snapshot/v1"
                or snapshot.get("scene_exporter_revision") != "mujoco-classic-uv3"
            ):
                raise RuntimeError(
                    f"evaluation snapshot contract mismatch: {condition_key}"
                )
            bodies = snapshot.get("bodies")
            geoms = snapshot.get("geoms")
            materials = snapshot.get("materials")
            if (
                not isinstance(bodies, list)
                or not bodies
                or not isinstance(geoms, list)
                or not geoms
                or not isinstance(materials, dict)
                or not materials
            ):
                raise RuntimeError(
                    f"evaluation snapshot is incomplete: {condition_key}"
                )
            body_names = [body.get("name") for body in bodies if isinstance(body, dict)]
            if len(body_names) != len(bodies) or len(set(body_names)) != len(
                body_names
            ):
                raise RuntimeError(
                    f"evaluation snapshot body identity mismatch: {condition_key}"
                )
            for body in bodies:
                if not finite_vector(body.get("translation"), 3) or not finite_vector(
                    body.get("rotation"), 4
                ):
                    raise RuntimeError(
                        f"evaluation snapshot body pose is invalid: {condition_key}"
                    )
            for material_key, material in materials.items():
                if not SHA256_PATTERN.fullmatch(material_key) or not isinstance(
                    material, dict
                ):
                    raise RuntimeError(
                        f"evaluation material identity is invalid: {condition_key}"
                    )
                expected_material_key = hashlib.sha256(
                    json.dumps(material, sort_keys=True, separators=(",", ":")).encode()
                ).hexdigest()
                if material_key != expected_material_key:
                    raise RuntimeError(
                        f"evaluation material hash mismatch: {condition_key}"
                    )
                texture_key = material.get("texture_key")
                if texture_key is not None:
                    if not isinstance(texture_key, str) or not SHA256_PATTERN.fullmatch(
                        texture_key
                    ):
                        raise RuntimeError(
                            f"evaluation texture key is invalid: {condition_key}"
                        )
                    texture_keys.add(texture_key)
            for geom in geoms:
                if (
                    not isinstance(geom, dict)
                    or geom.get("body") not in set(body_names)
                    or geom.get("geometry_key") not in geometry_keys
                    or geom.get("material_key") not in materials
                    or not finite_vector(geom.get("translation"), 3)
                    or not finite_vector(geom.get("rotation"), 4)
                    or not finite_vector(geom.get("geom_size"), 3)
                ):
                    raise RuntimeError(
                        f"evaluation geom reference is invalid: {condition_key}"
                    )
            render = snapshot.get("render")
            if (
                not isinstance(render, dict)
                or render.get("renderer") != "mujoco_classic"
            ):
                raise RuntimeError(
                    f"evaluation render contract is invalid: {condition_key}"
                )
            skybox = render.get("skybox")
            if skybox is not None:
                texture_key = (
                    skybox.get("texture_key") if isinstance(skybox, dict) else None
                )
                if not isinstance(texture_key, str) or not SHA256_PATTERN.fullmatch(
                    texture_key
                ):
                    raise RuntimeError(
                        f"evaluation skybox reference is invalid: {condition_key}"
                    )
                texture_keys.add(texture_key)

    if len(condition_ids) != EXPECTED["evaluation_conditions"]:
        raise RuntimeError(
            f"evaluation scene condition count mismatch: {len(condition_ids)}"
        )
    if dict(category_counts) != EXPECTED_EVALUATION_CATEGORIES:
        raise RuntimeError(
            f"evaluation scene category counts mismatch: {dict(category_counts)}"
        )
    for key in texture_keys:
        relative = f"textures/{key[:2]}/{key}.png"
        texture = safe_artifact(scene_root, relative)
        expected_scene_files.add(relative)
        if digest(texture) != key:
            raise RuntimeError(f"evaluation texture SHA-256 mismatch: {relative}")
    actual_scene_files = {
        path.relative_to(scene_root).as_posix()
        for path in scene_root.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and path.name != ".libero-evaluation-scenes.json"
        and "receipts" not in path.relative_to(scene_root).parts
    }
    if actual_scene_files != expected_scene_files:
        raise RuntimeError(
            "evaluation scene artifact path mismatch: "
            f"missing={sorted(expected_scene_files - actual_scene_files)[:5]}, "
            f"extra={sorted(actual_scene_files - expected_scene_files)[:5]}"
        )
    counts = scenes.get("counts")
    expected_counts = {
        "source_tasks": 40,
        "conditions": 10_030,
        "geometry_assets": geometry_count,
        "texture_assets": len(texture_keys),
    }
    if counts != expected_counts:
        raise RuntimeError(
            f"evaluation scene aggregate mismatch: {counts} != {expected_counts}"
        )
    return expected_counts


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
    *,
    hosted_schema: str,
    allow_legacy_plus_timebase: bool,
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
    if hosted_schema == "libero-eda-hosted/v3":
        if (
            "scene_series_asset_id" not in replay
            or "scene_reconstruction" not in replay
        ):
            raise RuntimeError(
                f"v3 replay reconstruction fields are missing: {replay_id}"
            )
        if dataset_id == "original_libero":
            if (
                replay["scene_series_asset_id"] is not None
                or replay["scene_reconstruction"] is not None
            ):
                raise RuntimeError(
                    f"Original replay must not claim reconstruction metadata: {replay_id}"
                )
        else:
            reconstruction = replay["scene_reconstruction"]
            if not isinstance(reconstruction, dict):
                raise RuntimeError(
                    f"Plus reconstruction metadata is missing: {replay_id}"
                )
            required = {
                "schema_version",
                "reconstruction_id",
                "method",
                "source_replay_id",
                "source_action_sha256",
                "appearance",
                "object_motion",
                "goal_success",
                "metrics",
                "reason",
            }
            methods = {
                "original_action_match_proxy",
                "mujoco_action_replay",
                "mujoco_osc_retarget",
                "mujoco_osc_robot_only",
                "unavailable",
            }
            if (
                set(reconstruction) != required
                or reconstruction.get("schema_version")
                != "libero-plus-training-scene-proxy/v1"
                or reconstruction.get("method") not in methods
                or not isinstance(reconstruction.get("reconstruction_id"), str)
                or not isinstance(reconstruction.get("source_replay_id"), str)
                or not SHA256_PATTERN.fullmatch(
                    str(reconstruction.get("source_action_sha256"))
                )
                or not isinstance(reconstruction.get("reason"), str)
                or not reconstruction["reason"]
            ):
                raise RuntimeError(
                    f"Plus reconstruction metadata is invalid: {replay_id}"
                )
            metrics = reconstruction.get("metrics")
            if (
                not isinstance(metrics, dict)
                or set(metrics)
                != {
                    "position_rmse_m",
                    "position_max_m",
                    "orientation_rmse_rad",
                    "gripper_mae",
                }
                or any(
                    not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or value < 0
                    for value in metrics.values()
                )
            ):
                raise RuntimeError(
                    f"Plus reconstruction metrics are invalid: {replay_id}"
                )
            available = reconstruction["method"] != "unavailable"
            if available != bool(replay.get("scene_asset_id")) or available != bool(
                replay.get("scene_series_asset_id")
            ):
                raise RuntimeError(
                    f"Plus reconstruction asset state is inconsistent: {replay_id}"
                )
            if replay.get("scene_cameras") != []:
                raise RuntimeError(
                    f"Plus proxy must not claim camera calibration: {replay_id}"
                )
    fps = replay.get("fps")
    if not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise RuntimeError(f"invalid replay fps: {replay_id}")
    videos = replay.get("videos")
    if (
        not isinstance(videos, list)
        or {video.get("camera") for video in videos} != EXPECTED_CAMERAS
    ):
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
            raise RuntimeError(
                f"video cannot contain all replay states: {replay_id}/{camera}"
            )

        if dataset_id == "lerobot_libero_plus":
            episode = record.get("episode_index")
            if not isinstance(episode, int) or replay_id != f"demo-{episode}":
                raise RuntimeError(
                    f"LIBERO-Plus episode identity mismatch: {replay_id}"
                )
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
                raise RuntimeError(
                    f"LIBERO-Plus public MP4 URL mismatch: {replay_id}/{camera}"
                )
            expected_duration = replay["state_count"] / fps
            canonical_timebase = (
                start == 0.0
                and offset == 0
                and math.isclose(end, expected_duration, rel_tol=0, abs_tol=1e-9)
            )
            legacy_global_timebase = (
                allow_legacy_plus_timebase
                and offset == 0
                and math.isclose(
                    end - start,
                    expected_duration,
                    rel_tol=0,
                    abs_tol=1e-9,
                )
            )
            if not canonical_timebase and not legacy_global_timebase:
                raise RuntimeError(
                    f"LIBERO-Plus episode timebase mismatch: {replay_id}/{camera}"
                )
            if (
                video.get("default_display_transform") != "rotate_180"
                or video.get("display_transform_provenance")
                != "source:lerobot-image-convention/rotate-180"
            ):
                raise RuntimeError(
                    f"LIBERO-Plus orientation contract mismatch: {replay_id}/{camera}"
                )
        elif dataset_id == "original_libero":
            if (
                video.get("default_display_transform") != "identity"
                or video.get("display_transform_provenance")
                != "app:libero-eda/original-libero-derived-v1"
            ):
                raise RuntimeError(
                    f"Original LIBERO orientation contract mismatch: {replay_id}/{camera}"
                )
        else:
            raise RuntimeError(f"unknown dataset in replay shard: {dataset_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument(
        "--allow-v1",
        action="store_true",
        help="Allow a legacy v1 input only for the one-way v2 migration tool.",
    )
    parser.add_argument(
        "--allow-v2",
        action="store_true",
        help="Allow hosted v2 only as input to the one-way v3 migration tool.",
    )
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    reject_symlinks(root, "hosted export")
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError("hosted manifest is missing")
    manifest = load_json(manifest_path)
    schema_version = manifest.get("schema_version")
    if schema_version not in {
        "libero-eda-hosted/v1",
        "libero-eda-hosted/v2",
        "libero-eda-hosted/v3",
    }:
        raise RuntimeError("manifest schema mismatch")
    if schema_version == "libero-eda-hosted/v1" and not args.allow_v1:
        raise RuntimeError(
            "legacy v1 exports are migration inputs, not publishable releases"
        )
    if schema_version == "libero-eda-hosted/v2" and not args.allow_v2:
        raise RuntimeError(
            "hosted v2 exports are migration inputs, not publishable releases"
        )
    if manifest.get("counts") != EXPECTED:
        raise RuntimeError(f"manifest counts mismatch: {manifest.get('counts')}")
    integrity = manifest.get("integrity")
    if (
        not isinstance(integrity, dict)
        or integrity.get("index") != "integrity/artifacts.json"
    ):
        raise RuntimeError("manifest integrity index contract is missing")
    integrity_path = safe_artifact(root, integrity["index"])
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
        relative
        for path in root.rglob("*")
        if path.is_file()
        and ".cache" not in path.relative_to(root).parts
        and (relative := path.relative_to(root).as_posix())
        not in {integrity["index"], "manifest.json", ".libero-eda-export.json"}
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
    plus_revision = (
        plus_source.get("revision") if isinstance(plus_source, dict) else None
    )
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
    replay_manifest_by_id: dict[str, dict[str, Any]] = {}
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
                raise RuntimeError(
                    f"task shard entries are invalid: {relative}/{dataset_id}"
                )
            for entry in entries:
                if not isinstance(entry, dict) or set(entry) != {"record", "manifest"}:
                    raise RuntimeError(
                        f"task shard entry contract mismatch: {relative}"
                    )
                record = entry["record"]
                replay = entry["manifest"]
                replay_id = record.get("replay_id")
                if replay_id in shard_replay_ids:
                    raise RuntimeError(f"duplicate replay in task shards: {replay_id}")
                if episode_by_id.get(replay_id) != record:
                    raise RuntimeError(
                        f"task shard record differs from search index: {replay_id}"
                    )
                if catalog["replay_tasks"].get(replay_id) != task_key:
                    raise RuntimeError(f"replay lookup task mismatch: {replay_id}")
                validate_replay_manifest(
                    record,
                    replay,
                    task_key,
                    plus_revision,
                    hosted_schema=schema_version,
                    allow_legacy_plus_timebase=(
                        schema_version == "libero-eda-hosted/v1"
                    ),
                )
                shard_replay_ids.add(replay_id)
                replay_manifest_by_id[replay_id] = replay
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

    reconstruction_counts = None
    if schema_version == "libero-eda-hosted/v3":
        top = manifest.get("training_reconstructions")
        if (
            not isinstance(top, dict)
            or top.get("schema_version") != "libero-plus-training-scene-proxy/v1"
            or top.get("plus_episodes") != EXPECTED["plus_training_episodes"]
            or top.get("exact_action_matches") != 12_609
            or top.get("simulated_or_unavailable_episodes") != 1_738
            or top.get("unique_reconstructions") != 207
        ):
            raise RuntimeError("training reconstruction release contract mismatch")
        provenance_relative = top.get("source_manifest")
        provenance_path = safe_artifact(root, provenance_relative)
        provenance = load_json(provenance_path)
        if (
            provenance.get("schema_version")
            != "libero-plus-training-reconstructions/v1"
            or provenance.get("status") != "complete"
            or provenance.get("counts", {}).get("plus_episodes")
            != EXPECTED["plus_training_episodes"]
            or provenance.get("counts", {}).get("unique_reconstructions") != 207
        ):
            raise RuntimeError("training reconstruction provenance mismatch")
        provenance_root = provenance_path.parent
        mapping_record = provenance.get("mappings")
        reconstruction_record = provenance.get("reconstructions")
        if not isinstance(mapping_record, dict) or not isinstance(
            reconstruction_record, dict
        ):
            raise RuntimeError("training reconstruction indexes are missing")
        mapping_path = safe_artifact(
            root,
            (provenance_root / mapping_record.get("path", ""))
            .relative_to(root)
            .as_posix(),
        )
        reconstruction_path = safe_artifact(
            root,
            (provenance_root / reconstruction_record.get("path", ""))
            .relative_to(root)
            .as_posix(),
        )
        if (
            mapping_path.stat().st_size != mapping_record.get("bytes")
            or digest(mapping_path) != mapping_record.get("sha256")
            or reconstruction_path.stat().st_size != reconstruction_record.get("bytes")
            or digest(reconstruction_path) != reconstruction_record.get("sha256")
        ):
            raise RuntimeError("training reconstruction index integrity mismatch")
        mappings = load_json(mapping_path)
        reconstructions = load_json(reconstruction_path)
        if (
            not isinstance(mappings, list)
            or len(mappings) != EXPECTED["plus_training_episodes"]
            or not isinstance(reconstructions, list)
            or len(reconstructions) != 207
        ):
            raise RuntimeError("training reconstruction index count mismatch")
        mapping_by_id = {item.get("replay_id"): item for item in mappings}
        if len(mapping_by_id) != len(mappings):
            raise RuntimeError("duplicate training reconstruction mapping")
        plus_manifests = {
            replay_id: replay
            for replay_id, replay in replay_manifest_by_id.items()
            if replay.get("dataset_id") == "lerobot_libero_plus"
        }
        original_manifests = {
            replay_id: replay
            for replay_id, replay in replay_manifest_by_id.items()
            if replay.get("dataset_id") == "original_libero"
        }
        if set(mapping_by_id) != set(plus_manifests):
            raise RuntimeError("training reconstruction replay coverage mismatch")
        methods: Counter[str] = Counter()
        for replay_id, replay in plus_manifests.items():
            reconstruction = replay["scene_reconstruction"]
            mapping = mapping_by_id[replay_id]
            method = reconstruction["method"]
            methods[method] += 1
            for key in (
                "reconstruction_id",
                "method",
                "source_replay_id",
                "source_action_sha256",
                "appearance",
                "object_motion",
            ):
                if reconstruction[key] != mapping.get(key):
                    raise RuntimeError(
                        f"published reconstruction differs from provenance: {replay_id}/{key}"
                    )
            mapping_metrics = mapping.get("metrics")
            if not isinstance(mapping_metrics, dict) or reconstruction["metrics"] != {
                key: mapping_metrics.get(key)
                for key in (
                    "position_rmse_m",
                    "position_max_m",
                    "orientation_rmse_rad",
                    "gripper_mae",
                )
            }:
                raise RuntimeError(
                    f"published reconstruction differs from provenance: {replay_id}/metrics"
                )
            source_replay = original_manifests.get(reconstruction["source_replay_id"])
            if not source_replay or source_replay.get("task_key") != replay.get(
                "task_key"
            ):
                raise RuntimeError(f"reconstruction source task mismatch: {replay_id}")
            if method == "original_action_match_proxy" and (
                replay.get("scene_asset_id") != source_replay.get("scene_asset_id")
                or replay.get("scene_series_asset_id")
                != source_replay.get("series_asset_id")
                or replay.get("body_names") != source_replay.get("body_names")
            ):
                raise RuntimeError(
                    f"exact Original proxy contract mismatch: {replay_id}"
                )
            for relative in (
                replay.get("scene_asset_id"),
                replay.get("scene_series_asset_id"),
            ):
                if relative is not None:
                    if relative not in artifacts:
                        raise RuntimeError(
                            f"reconstruction asset is not indexed: {replay_id}/{relative}"
                        )
                    safe_artifact(root, relative)
        reconstruction_counts = dict(sorted(methods.items()))
        if reconstruction_counts != top.get(
            "methods"
        ) or reconstruction_counts != provenance.get("counts", {}).get(
            "episode_methods"
        ):
            raise RuntimeError("training reconstruction method counts mismatch")

    evaluation_scene_counts = None
    if schema_version in {"libero-eda-hosted/v2", "libero-eda-hosted/v3"}:
        evaluation_scene_counts = validate_evaluation_scenes(root, manifest, catalog)

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
        "evaluation_scenes": evaluation_scene_counts,
        "training_reconstructions": reconstruction_counts,
    }
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
