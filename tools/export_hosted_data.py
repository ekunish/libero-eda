#!/usr/bin/env python3
"""Export a validated local LIBERO catalog into the read-only hosted format.

This is a one-way migration tool. It requires the source checkout's validated
DuckDB catalog and its pinned local datasets. It never weakens a missing source,
count mismatch, or artifact mismatch into a partial export.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.ipc as ipc
import pyarrow.parquet as pq

SCHEMA_VERSION = "libero-eda-hosted/v1"
CATALOG_SCHEMA_VERSION = "7"
PLUS_DATASET_REVISION = "f3f49f426d75030177b18778374005bc12ccd588"
ORIGINAL_DATASET_REVISION = "f13aa24a3da8c43c7225569f28c562979fa0e35a"
LIBERO_REVISION = "8f1084e3132a39270c3a13ebe37270a43ece2a01"
LIBERO_PLUS_REVISION = "4976dc30028e805ff8094b55501d532c48fec182"
PUBLIC_PLUS_REVISION = "22c57433fef692b5b9ecc0795344daac7fa867a5"
PLUS_ASSETS_REVISION = "dd2bd61b7d9a6fef1abc52d606e983b41886a149"
RLDS_REVISION = "fb0c7029b076030d5d57227229e4f7460def1f7c"
FOUR_SUITE_REVISION = "1a0f5c97a96e4187fbe52331b9a484f21d244bb2"
SEGMENTATION_REVISION = "254ad63ac8a130049362a79b7c26ef9ff93766ad"
CAMERA_PARAMETERS_REVISION = "dc60c70eb7bd63cb694a89d7c5ea53f2032d8807"
EXPECTED_COUNTS = {
    "task_families": 130,
    "original_episodes": 6_500,
    "plus_training_episodes": 14_347,
    "evaluation_conditions": 10_030,
}
OWNER = {"schema_version": SCHEMA_VERSION, "owner": "libero-eda-exporter"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--workers", type=int, default=max(2, min(16, os.cpu_count() or 2))
    )
    parser.add_argument("--skip-thumbnails", action="store_true")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(
            value, stream, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def ensure_output_root(path: Path) -> Path:
    resolved = path.resolve()
    if resolved.exists():
        marker = resolved / ".libero-eda-export.json"
        if not marker.is_file() or json.loads(marker.read_text()) != OWNER:
            raise RuntimeError(f"output root is not owned by this exporter: {resolved}")
    else:
        resolved.mkdir(parents=True)
        write_json(resolved / ".libero-eda-export.json", OWNER)
    return resolved


def json_rows(cursor: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    names = [item[0] for item in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def validate_catalog(con: duckdb.DuckDBPyConnection) -> dict[str, str]:
    metadata = dict(con.execute("SELECT key, value FROM metadata").fetchall())
    required = {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "dataset_revision": PLUS_DATASET_REVISION,
        "original_dataset_revision": ORIGINAL_DATASET_REVISION,
        "plus_training_metadata_revision": RLDS_REVISION,
    }
    for key, expected in required.items():
        if metadata.get(key) != expected:
            raise RuntimeError(
                f"catalog metadata mismatch: {key}: {metadata.get(key)!r} != {expected!r}"
            )
    counts = dict(
        con.execute(
            "SELECT dataset_id, count(*) FROM episodes GROUP BY dataset_id"
        ).fetchall()
    )
    if counts != {
        "original_libero": EXPECTED_COUNTS["original_episodes"],
        "lerobot_libero_plus": EXPECTED_COUNTS["plus_training_episodes"],
    }:
        raise RuntimeError(f"episode counts mismatch: {counts}")
    task_count = con.execute(
        "SELECT count(*) FROM tasks WHERE source='libero'"
    ).fetchone()[0]
    condition_count = con.execute(
        "SELECT count(*) FROM tasks WHERE source='libero_plus' AND category!='Unmodified'"
    ).fetchone()[0]
    if task_count != 130 or condition_count != 10_030:
        raise RuntimeError(
            f"task counts mismatch: original={task_count}, evaluation={condition_count}"
        )
    return {key: metadata[key] for key in (*required, "built_at") if key in metadata}


def load_source_api(source_repo: Path) -> tuple[Any, Any, Any]:
    api_root = source_repo / "eda" / "api"
    if not (api_root / "parc_eda" / "database.py").is_file():
        raise RuntimeError(f"validated source API is missing: {api_root}")
    sys.path.insert(0, str(api_root))
    os.environ["PARC_ROOT"] = str(source_repo)
    from parc_eda.config import Settings  # noqa: PLC0415
    from parc_eda.database import CatalogDatabase  # noqa: PLC0415

    settings = Settings.from_env()
    return settings, CatalogDatabase(settings), settings.database_path


def validate_source_repositories(source_repo: Path) -> None:
    checks = [
        (
            source_repo / "LIBERO",
            LIBERO_REVISION,
            ["libero/libero/bddl_files", "libero/libero/benchmark"],
        ),
        (
            source_repo / "LIBERO-plus",
            LIBERO_PLUS_REVISION,
            [
                "libero/libero/bddl_files",
                "libero/libero/benchmark/task_classification.json",
            ],
        ),
    ]
    for repository, expected, guarded in checks:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repository,
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()
        if head != expected:
            raise RuntimeError(
                f"source revision mismatch: {repository}: {head} != {expected}"
            )
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no", "--", *guarded],
            cwd=repository,
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()
        if dirty:
            raise RuntimeError(
                f"guarded source paths are modified: {repository}: {dirty}"
            )


def clean_task_record(record: dict[str, Any]) -> dict[str, Any]:
    value = dict(record)
    value["is_t1"] = False
    value["t1_ordinal"] = None
    value["t1_instruction"] = None
    return value


def build_catalog(
    database: Any, con: duckdb.DuckDBPyConnection
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    families, total = database.task_families(
        query=None,
        suite=None,
        category=None,
        difficulty=None,
        difficulty_unassigned=False,
        t1_only=False,
        plus_source=None,
        limit=500,
        offset=0,
    )
    if total != 130 or len(families) != 130:
        raise RuntimeError(f"task family export mismatch: {len(families)}/{total}")
    details: dict[str, dict[str, Any]] = {}
    for family in families:
        family["t1_variant_count"] = 0
        family["t1_ordinals"] = []
        detail = database.task_detail(family["task_key"])
        if detail is None:
            raise RuntimeError(f"task detail is missing: {family['task_key']}")
        detail = clean_task_record(detail)
        detail["related"] = [
            clean_task_record(item)
            for item in detail.get("related", [])
            if item["source"] == "libero"
        ]
        detail["related_total"] = len(detail["related"])
        details[family["task_key"]] = detail

    rows = json_rows(
        con.execute(
            """SELECT e.*, b.suite, b.instruction AS original_task_instruction,
               d.display_name AS dataset_name
               FROM episodes e JOIN tasks b ON b.task_key=e.base_task_key
               JOIN recording_datasets d ON d.dataset_id=e.dataset_id
               ORDER BY e.dataset_id, e.base_task_key, e.source_episode_index"""
        )
    )
    return {
        "families": families,
        "details": details,
        "task_shards": {},
        "replay_tasks": {},
    }, rows


def source_registry() -> dict[str, Any]:
    return {
        "groups": [
            {
                "group_id": "original_libero",
                "title": "Original LIBERO",
                "purpose": "Source task definitions and official demonstrations",
                "sources": [
                    {
                        "source_id": "libero_task_definitions",
                        "role": "task_definitions",
                        "label": "Lifelong-Robot-Learning/LIBERO",
                        "repository": "Lifelong-Robot-Learning/LIBERO",
                        "revision": LIBERO_REVISION,
                        "url": f"https://github.com/Lifelong-Robot-Learning/LIBERO/tree/{LIBERO_REVISION}",
                        "structure": ["suite task map", "BDDL task definitions"],
                        "counts": {"tasks": 130},
                    },
                    {
                        "source_id": "original_libero_demonstrations",
                        "role": "recorded_trajectories",
                        "label": "yifengzhu-hf/LIBERO-datasets",
                        "repository": "yifengzhu-hf/LIBERO-datasets",
                        "revision": ORIGINAL_DATASET_REVISION,
                        "url": f"https://huggingface.co/datasets/yifengzhu-hf/LIBERO-datasets/tree/{ORIGINAL_DATASET_REVISION}",
                        "structure": [
                            "130 HDF5 task files",
                            "50 demonstrations per task",
                            "agentview and wrist RGB",
                            "actions and simulator state",
                        ],
                        "counts": {
                            "tasks": 130,
                            "episodes": 6500,
                            "frames": 1007618,
                            "source_bytes": 100442942572,
                            "local_derived_bytes": 4013228172,
                        },
                    },
                ],
            },
            {
                "group_id": "libero_plus_training",
                "title": "LIBERO-Plus Training",
                "purpose": "Successful trajectories with video, state, action, and official RLDS path tags",
                "sources": [
                    {
                        "source_id": "libero_plus_lerobot",
                        "role": "recorded_trajectories",
                        "label": "Sylvest/libero_plus_lerobot",
                        "repository": "Sylvest/libero_plus_lerobot",
                        "revision": PUBLIC_PLUS_REVISION,
                        "url": f"https://huggingface.co/datasets/Sylvest/libero_plus_lerobot/tree/{PUBLIC_PLUS_REVISION}",
                        "structure": [
                            "LeRobot v2.1",
                            "14,347 episode Parquet files",
                            "front and wrist MP4",
                            "40 canonical task instructions",
                        ],
                        "counts": {
                            "tasks": 40,
                            "episodes": 14347,
                            "frames": 2238036,
                            "stored_bytes": 7850246890,
                        },
                    },
                    {
                        "source_id": "libero_plus_lerobot_validation",
                        "role": "training_provenance",
                        "label": "lerobot/libero_plus validation snapshot",
                        "repository": "lerobot/libero_plus",
                        "revision": PLUS_DATASET_REVISION,
                        "url": f"https://huggingface.co/datasets/lerobot/libero_plus/tree/{PLUS_DATASET_REVISION}",
                        "structure": [
                            "frame Parquet",
                            "chunked front and wrist MP4",
                            "episode metadata",
                            "40 tasks",
                        ],
                        "counts": {
                            "tasks": 40,
                            "episodes": 14347,
                            "frames": 2238036,
                            "stored_bytes": 15832114435,
                        },
                    },
                    {
                        "source_id": "libero_plus_rlds_provenance",
                        "role": "training_provenance",
                        "label": "Sylvest/libero_plus_rlds",
                        "repository": "Sylvest/libero_plus_rlds",
                        "revision": RLDS_REVISION,
                        "url": f"https://huggingface.co/datasets/Sylvest/libero_plus_rlds/tree/{RLDS_REVISION}",
                        "structure": [
                            "1,024 TFRecord shards",
                            "episode_metadata.file_path",
                            "steps/language_instruction and action",
                            "five published path tags",
                        ],
                        "counts": {"episodes": 14347, "shards": 1024},
                    },
                ],
            },
            {
                "group_id": "libero_plus_evaluation",
                "title": "LIBERO-Plus Evaluation",
                "purpose": "Changed simulator conditions loaded directly from the pinned official repository",
                "sources": [
                    {
                        "source_id": "libero_plus_evaluation_definitions",
                        "role": "evaluation_definitions",
                        "label": "sylvestf/LIBERO-plus",
                        "repository": "sylvestf/LIBERO-plus",
                        "revision": LIBERO_PLUS_REVISION,
                        "url": f"https://github.com/sylvestf/LIBERO-plus/tree/{LIBERO_PLUS_REVISION}",
                        "structure": [
                            "task_classification.json",
                            "10,030 changed BDDL conditions",
                            "seven categories",
                            "difficulty labels",
                        ],
                        "counts": {
                            "source_tasks": 40,
                            "conditions": 10030,
                            "categories": 7,
                        },
                    },
                    {
                        "source_id": "libero_plus_assets",
                        "role": "simulator_assets",
                        "label": "Sylvest/LIBERO-plus assets",
                        "repository": "Sylvest/LIBERO-plus",
                        "revision": PLUS_ASSETS_REVISION,
                        "url": f"https://huggingface.co/datasets/Sylvest/LIBERO-plus/tree/{PLUS_ASSETS_REVISION}",
                        "structure": [
                            "MuJoCo objects",
                            "textures",
                            "scene assets",
                            "assets.zip",
                        ],
                        "counts": {"archive_bytes": 6395849578},
                    },
                ],
            },
            {
                "group_id": "related_packages",
                "title": "Related packages",
                "purpose": "Published companion datasets that this release does not load",
                "sources": [
                    {
                        "source_id": "libero_plus_data_4suite_not_loaded",
                        "role": "related_package",
                        "label": "Sylvest/libero_plus_data_4suite",
                        "repository": "Sylvest/libero_plus_data_4suite",
                        "revision": FOUR_SUITE_REVISION,
                        "url": f"https://huggingface.co/datasets/Sylvest/libero_plus_data_4suite/tree/{FOUR_SUITE_REVISION}",
                        "structure": [
                            "four suite-specific LeRobot ZIP archives",
                            "four suite-specific RLDS ZIP archives",
                            "a separately packaged 15,874-episode collection",
                        ],
                        "counts": {
                            "tasks": 40,
                            "episodes": 15874,
                            "frames": 2448544,
                            "archive_bytes": 99904438506,
                        },
                    },
                    {
                        "source_id": "libero_plus_seg_not_loaded",
                        "role": "related_package",
                        "label": "Sylvest/libero_plus_seg",
                        "repository": "Sylvest/libero_plus_seg",
                        "revision": SEGMENTATION_REVISION,
                        "url": f"https://huggingface.co/datasets/Sylvest/libero_plus_seg/tree/{SEGMENTATION_REVISION}",
                        "structure": [
                            "RLDS trajectories",
                            "front and wrist instance-segmentation masks",
                            "object-name to segmentation-ID metadata",
                        ],
                        "counts": {
                            "episodes": 13488,
                            "shards": 1024,
                            "archive_bytes": 78222784012,
                        },
                    },
                    {
                        "source_id": "libero_plus_camparam_not_loaded",
                        "role": "related_package",
                        "label": "Sylvest/libero_plus_camparam_rlds",
                        "repository": "Sylvest/libero_plus_camparam_rlds",
                        "revision": CAMERA_PARAMETERS_REVISION,
                        "url": f"https://huggingface.co/datasets/Sylvest/libero_plus_camparam_rlds/tree/{CAMERA_PARAMETERS_REVISION}",
                        "structure": [
                            "camera-view RLDS trajectories across four suites",
                            "4 x 4 agentview camera extrinsics per episode",
                            "standard action, image, state, and instruction features",
                        ],
                        "counts": {
                            "episodes": 2876,
                            "shards": 256,
                            "archive_bytes": 16607835331,
                        },
                    },
                ],
            },
        ]
    }


def episode_record(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "episode_index": row["source_episode_index"],
        "source_episode_id": row["source_episode_id"],
        "dataset_id": row["dataset_id"],
        "dataset_name": row["dataset_name"],
        "task_index": row["task_index"],
        "task_instruction": row["task_instruction"],
        "original_task_instruction": row["original_task_instruction"],
        "base_task_key": row["base_task_key"],
        "suite": row["suite"],
        "length": row["length"],
        "duration_sec": row["duration_sec"],
        "replay_id": row["replay_id"],
        "training_environment_category": row["training_environment_category"],
        "training_environment_strength": row["training_environment_strength"],
        "training_environment_strength_status": row[
            "training_environment_strength_status"
        ],
        "training_instruction": row["training_instruction"],
        "training_instruction_source": row["training_instruction_source"],
        "training_instruction_availability": row["training_instruction_availability"],
        "training_instruction_relation": row["training_instruction_relation"],
    }


def public_plus_video(episode: int, camera: str) -> str:
    source_camera = (
        "observation.images.front"
        if camera == "agentview"
        else "observation.images.wrist"
    )
    return (
        "https://huggingface.co/datasets/Sylvest/libero_plus_lerobot/resolve/"
        f"{PUBLIC_PLUS_REVISION}/videos/chunk-{episode // 1000:03d}/{source_camera}/episode_{episode:06d}.mp4"
    )


def replay_asset_relative(kind: str, replay_id: str, suffix: str) -> str:
    if replay_id.startswith("demo-"):
        episode = int(replay_id.removeprefix("demo-"))
        return f"assets/{kind}/lerobot_libero_plus/chunk-{episode // 1000:03d}/{replay_id}{suffix}"
    parts = replay_id.split("-")
    if len(parts) < 5 or parts[:2] != ["original", "libero"]:
        raise RuntimeError(f"unknown dataset replay id: {replay_id}")
    suite = "-".join(parts[2:-2])
    task = parts[-2]
    return f"assets/{kind}/original_libero/{suite}/{task}/{replay_id}{suffix}"


def build_manifest(
    row: dict[str, Any], videos: list[dict[str, Any]], assets: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    dataset_id = row["dataset_id"]
    provenance = json.loads(row["provenance_json"])
    body_names = json.loads(row["body_names_json"])
    outcome = json.loads(row["outcome_json"])
    exported_videos = []
    for video in videos:
        asset = assets.get(video["asset_id"])
        if asset is None:
            raise RuntimeError(f"video asset missing: {video['asset_id']}")
        if dataset_id == "original_libero":
            asset_id = f"assets/videos/original_libero/{row['replay_id']}/{video['camera']}.mp4"
            transform = "identity"
            transform_source = "app:libero-eda/original-libero-derived-v1"
        else:
            asset_id = public_plus_video(row["source_episode_index"], video["camera"])
            transform = "rotate_180"
            transform_source = "source:lerobot-image-convention/rotate-180"
        exported_videos.append(
            {
                "camera": video["camera"],
                "asset_id": asset_id,
                "start_time_sec": video["start_time_sec"],
                "end_time_sec": video["end_time_sec"],
                "frame_offset": video["frame_offset"],
                "width": video["width"],
                "height": video["height"],
                "default_display_transform": transform,
                "display_transform_provenance": transform_source,
            }
        )
    scene_id = None
    if row["scene_asset_id"]:
        if row["scene_asset_id"] not in assets:
            raise RuntimeError(f"scene asset missing: {row['scene_asset_id']}")
        scene_id = f"assets/scenes/{row['scene_hash']}.glb"
    return {
        "schema_version": "parc-replay/v2",
        "replay_id": row["replay_id"],
        "source": "dataset",
        "dataset_id": dataset_id,
        "source_episode_id": row["source_episode_id"],
        "task_key": row["base_task_key"],
        "task_name": row["task_instruction"],
        "episode_id": row["source_episode_index"],
        "init_index": None,
        "fps": row["fps"],
        "state_count": row["length"],
        "action_count": row["length"],
        "action_horizon": None,
        "series_asset_id": replay_asset_relative(
            "series", row["replay_id"], ".arrow.gz"
        ),
        "videos": exported_videos,
        "scene_asset_id": scene_id,
        "scene_hash": row["scene_hash"],
        "scene_schema": row["scene_schema"] if scene_id else "legacy-analysis",
        "scene_fidelity": row["scene_fidelity"] if scene_id else "none",
        "scene_fidelity_reason": row["scene_fidelity_reason"]
        if scene_id
        else "This record does not include full MuJoCo body state.",
        "body_names": body_names,
        "scene_cameras": provenance.get("scene_cameras", []),
        "outcome": outcome,
        "provenance": provenance,
    }


def derivatives(
    positions: np.ndarray, fps: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if not len(positions):
        empty = np.zeros((0,), dtype=np.float64)
        return empty, empty, empty
    dt = 1.0 / fps
    velocity = (
        np.gradient(positions, dt, axis=0)
        if len(positions) >= 2
        else np.zeros_like(positions)
    )
    acceleration = (
        np.gradient(velocity, dt, axis=0)
        if len(positions) >= 3
        else np.zeros_like(positions)
    )
    jerk = (
        np.gradient(acceleration, dt, axis=0)
        if len(positions) >= 4
        else np.zeros_like(positions)
    )
    return tuple(
        np.linalg.norm(value, axis=1) for value in (velocity, acceleration, jerk)
    )


def write_series(
    path: Path,
    arrays: dict[str, np.ndarray],
    object_displacements: dict[str, list[float]],
) -> None:
    shapes: dict[str, list[int]] = {}
    columns: dict[str, pa.Array] = {}
    integer_names = {"frame_index", "chunk_boundaries"}
    for name, raw in arrays.items():
        dtype = np.int32 if name in integer_names else np.float64
        value = np.ascontiguousarray(raw, dtype=dtype)
        shapes[name] = list(value.shape)
        columns[name] = pa.array([value.tobytes(order="C")], type=pa.binary())
    columns["shapes"] = pa.array([json.dumps(shapes, separators=(",", ":"))])
    columns["json"] = pa.array(
        [
            json.dumps(
                {"object_displacements": object_displacements}, separators=(",", ":")
            )
        ]
    )
    table = pa.table(columns)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("wb") as raw:
        with gzip.GzipFile(
            fileobj=raw, mode="wb", compresslevel=6, mtime=0
        ) as compressed:
            with ipc.new_file(compressed, table.schema) as writer:
                writer.write_table(table)
    temporary.replace(path)


def original_arrays(
    path: Path, fps: float
) -> tuple[dict[str, np.ndarray], dict[str, list[float]]]:
    with np.load(path, allow_pickle=False) as data:
        ee = np.asarray(data["ee_positions"], dtype=np.float64)
        speed, acceleration, jerk = derivatives(ee, fps)
        arrays = {
            "time": np.arange(len(ee), dtype=np.float64) / fps,
            "frame_index": np.arange(len(ee), dtype=np.int32),
            "ee_positions": ee,
            "ee_axis_angle": np.asarray(data["ee_axis_angle"], dtype=np.float64)
            if "ee_axis_angle" in data
            else np.empty((0, 3)),
            "ee_orientations": np.asarray(data["ee_orientations"], dtype=np.float64)
            if "ee_orientations" in data
            else np.empty((0, 4)),
            "gripper_qpos": np.asarray(data["gripper_qpos"], dtype=np.float64)
            if "gripper_qpos" in data
            else np.empty((0, 2)),
            "actions": np.asarray(data["actions"], dtype=np.float64),
            "rewards": np.asarray(data["rewards"], dtype=np.float64)
            if "rewards" in data
            else np.empty((0,)),
            "joints": np.asarray(data["joint_positions"], dtype=np.float64)
            if "joint_positions" in data
            else np.empty((0, 7)),
            "body_positions": np.asarray(data["body_positions"], dtype=np.float64)
            if "body_positions" in data
            else np.empty((0, 0, 3)),
            "body_quaternions": np.asarray(data["body_quaternions"], dtype=np.float64)
            if "body_quaternions" in data
            else np.empty((0, 0, 4)),
            "qpos": np.asarray(data["qpos"], dtype=np.float64)
            if "qpos" in data
            else np.empty((0, 0)),
            "qvel": np.asarray(data["qvel"], dtype=np.float64)
            if "qvel" in data
            else np.empty((0, 0)),
            "chunk_boundaries": np.empty((0,), dtype=np.int32),
            "speed": speed,
            "acceleration": acceleration,
            "jerk": jerk,
        }
        displacements = {
            key.removeprefix("object_disp__"): np.asarray(
                data[key], dtype=np.float64
            ).tolist()
            for key in data.files
            if key.startswith("object_disp__")
        }
    return arrays, displacements


def plus_arrays(
    table: pa.Table, start: int, end: int, fps: float
) -> tuple[dict[str, np.ndarray], dict[str, list[float]]]:
    length = end - start
    sliced = table.slice(start, length)
    states = np.asarray(
        sliced.column("observation.state").combine_chunks().values
    ).reshape(length, 8)
    actions = np.asarray(sliced.column("action").combine_chunks().values).reshape(
        length, 7
    )
    ee = states[:, :3]
    speed, acceleration, jerk = derivatives(ee, fps)
    return {
        "time": np.asarray(sliced.column("timestamp").combine_chunks()),
        "frame_index": np.asarray(
            sliced.column("frame_index").combine_chunks(), dtype=np.int32
        ),
        "ee_positions": ee,
        "ee_axis_angle": states[:, 3:6],
        "ee_orientations": np.empty((0, 4)),
        "gripper_qpos": states[:, 6:8],
        "actions": actions,
        "rewards": np.empty((0,)),
        "joints": np.empty((0, 7)),
        "body_positions": np.empty((0, 0, 3)),
        "body_quaternions": np.empty((0, 0, 4)),
        "qpos": np.empty((0, 0)),
        "qvel": np.empty((0, 0)),
        "chunk_boundaries": np.empty((0,), dtype=np.int32),
        "speed": speed,
        "acceleration": acceleration,
        "jerk": jerk,
    }, {}


def ffmpeg_thumbnail(job: tuple[Path, float, bool, Path]) -> None:
    source, start, rotate, target = job
    if target.is_file() and target.stat().st_size > 0:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    vf = "hflip,vflip," if rotate else ""
    vf += "scale=128:128:force_original_aspect_ratio=decrease,pad=128:128:(ow-iw)/2:(oh-ih)/2:black"
    temporary = target.with_name(f".{target.stem}.{os.getpid()}.webp")
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.6f}",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        vf,
        "-c:v",
        "libwebp",
        "-q:v",
        "72",
        "-y",
        str(temporary),
    ]
    subprocess.run(command, check=True)
    if not temporary.is_file() or temporary.stat().st_size == 0:
        raise RuntimeError(f"thumbnail was not created: {source}")
    temporary.replace(target)


def main() -> None:
    args = parse_args()
    source_repo = args.source_repo.resolve(strict=True)
    output = ensure_output_root(args.output)
    validate_source_repositories(source_repo)
    settings, database, db_path = load_source_api(source_repo)
    con = duckdb.connect(str(db_path))
    try:
        metadata = validate_catalog(con)
        catalog, episode_rows = build_catalog(database, con)
        videos_by_replay: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in json_rows(
            con.execute("SELECT * FROM episode_videos ORDER BY replay_id, ordinal")
        ):
            videos_by_replay[row["replay_id"]].append(row)
        assets = {
            row["asset_id"]: row
            for row in json_rows(con.execute("SELECT * FROM assets"))
        }
    finally:
        con.close()

    task_entries: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    episode_search: list[dict[str, Any]] = []
    original_series: list[dict[str, Any]] = []
    plus_by_parquet: dict[str, list[dict[str, Any]]] = defaultdict(list)
    thumbnail_jobs: list[tuple[Path, float, bool, Path]] = []
    copied_scenes: set[str] = set()

    for index, row in enumerate(episode_rows, start=1):
        replay_id = row["replay_id"]
        record = episode_record(row)
        manifest = build_manifest(row, videos_by_replay[replay_id], assets)
        task_entries[row["base_task_key"]][row["dataset_id"]].append(
            {"record": record, "manifest": manifest}
        )
        episode_search.append(record)
        catalog["replay_tasks"][replay_id] = row["base_task_key"]

        if row["dataset_id"] == "original_libero":
            original_series.append(row)
            for video in videos_by_replay[replay_id]:
                source_asset = assets[video["asset_id"]]
                source = Path(source_asset["path"]).resolve(strict=True)
                if source.stat().st_size != source_asset["size_bytes"]:
                    raise RuntimeError(f"source video size changed: {source}")
                target = (
                    output
                    / f"assets/videos/original_libero/{replay_id}/{video['camera']}.mp4"
                )
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    os.link(source, target)
            if row["scene_asset_id"] and row["scene_hash"] not in copied_scenes:
                scene_asset = assets[row["scene_asset_id"]]
                source = Path(scene_asset["path"]).resolve(strict=True)
                target = output / f"assets/scenes/{row['scene_hash']}.glb"
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    os.link(source, target)
                copied_scenes.add(row["scene_hash"])
        else:
            plus_by_parquet[row["series_path"]].append(row)

        front = next(
            (
                item
                for item in videos_by_replay[replay_id]
                if item["camera"] == "agentview"
            ),
            None,
        )
        if front is None:
            raise RuntimeError(f"front video missing: {replay_id}")
        source = Path(assets[front["asset_id"]]["path"]).resolve(strict=True)
        thumbnail_jobs.append(
            (
                source,
                float(front["start_time_sec"]),
                row["dataset_id"] == "lerobot_libero_plus",
                output / replay_asset_relative("thumbnails", replay_id, ".webp"),
            )
        )
        if index % 1000 == 0:
            print(f"indexed {index}/{len(episode_rows)} episodes", flush=True)

    for family in catalog["families"]:
        key = family["task_key"]
        shard_name = hashlib.sha256(key.encode()).hexdigest()[:20]
        relative = f"catalog/tasks/{shard_name}.json"
        catalog["task_shards"][key] = relative
        datasets = {
            "original_libero": task_entries[key].get("original_libero", []),
            "lerobot_libero_plus": task_entries[key].get("lerobot_libero_plus", []),
        }
        write_json(output / relative, {"task_key": key, "datasets": datasets})

    print("writing Original LIBERO Arrow series", flush=True)
    for index, row in enumerate(original_series, start=1):
        target = output / replay_asset_relative("series", row["replay_id"], ".arrow.gz")
        if not target.is_file():
            arrays, displacements = original_arrays(
                Path(row["series_path"]), float(row["fps"])
            )
            if len(arrays["actions"]) != row["length"]:
                raise RuntimeError(
                    f"Original series length mismatch: {row['replay_id']}"
                )
            write_series(target, arrays, displacements)
        if index % 500 == 0:
            print(f"Original series {index}/{len(original_series)}", flush=True)

    print("writing LIBERO-Plus Arrow series", flush=True)
    plus_written = 0
    for parquet_path, rows in plus_by_parquet.items():
        table = pq.read_table(
            parquet_path,
            columns=[
                "timestamp",
                "frame_index",
                "episode_index",
                "observation.state",
                "action",
            ],
        )
        episode_indices = np.asarray(table.column("episode_index").combine_chunks())
        for row in rows:
            target = output / replay_asset_relative(
                "series", row["replay_id"], ".arrow.gz"
            )
            if not target.is_file():
                start = int(row["dataset_from_index"])
                end = int(row["dataset_to_index"])
                # The second source Parquet starts at its own global index. Locate the
                # episode by the verified episode_index column when global offsets differ.
                if end > len(table):
                    positions = np.flatnonzero(
                        episode_indices == row["source_episode_index"]
                    )
                    if len(positions) != row["length"] or np.any(
                        np.diff(positions) != 1
                    ):
                        raise RuntimeError(
                            f"Plus series rows are not contiguous: {row['replay_id']}"
                        )
                    start, end = int(positions[0]), int(positions[-1] + 1)
                arrays, displacements = plus_arrays(
                    table, start, end, float(row["fps"])
                )
                if len(arrays["actions"]) != row["length"]:
                    raise RuntimeError(
                        f"Plus series length mismatch: {row['replay_id']}"
                    )
                write_series(target, arrays, displacements)
            plus_written += 1
            if plus_written % 1000 == 0:
                print(
                    f"Plus series {plus_written}/{EXPECTED_COUNTS['plus_training_episodes']}",
                    flush=True,
                )

    if not args.skip_thumbnails:
        print(
            f"rendering {len(thumbnail_jobs)} thumbnails with {args.workers} workers",
            flush=True,
        )
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for index, _ in enumerate(
                pool.map(ffmpeg_thumbnail, thumbnail_jobs), start=1
            ):
                if index % 1000 == 0:
                    print(f"thumbnails {index}/{len(thumbnail_jobs)}", flush=True)

    write_json(output / "catalog/tasks.json", catalog)
    write_json(output / "catalog/episodes.json", episode_search)
    write_json(output / "catalog/sources.json", source_registry())

    if args.skip_thumbnails:
        print(
            json.dumps(
                {
                    "output": str(output),
                    "status": "prepared_without_thumbnails",
                    "manifest_written": False,
                },
                indent=2,
            )
        )
        return

    artifact_files = sorted(
        path
        for path in output.rglob("*")
        if path.is_file()
        and ".cache" not in path.relative_to(output).parts
        and path.relative_to(output).as_posix() != "integrity/artifacts.json"
        and path.name not in {"manifest.json", ".libero-eda-export.json"}
    )
    artifacts = {
        path.relative_to(output).as_posix(): {
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        for path in artifact_files
    }
    integrity_path = output / "integrity/artifacts.json"
    write_json(
        integrity_path,
        {
            "schema_version": "libero-eda-integrity/v1",
            "artifact_count": len(artifacts),
            "artifact_bytes": sum(record["bytes"] for record in artifacts.values()),
            "artifacts": artifacts,
        },
    )
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "revision": hashlib.sha256(
            json.dumps(artifacts, sort_keys=True).encode()
        ).hexdigest(),
        "generated_at": datetime.now(UTC).isoformat(),
        "catalog": {
            "tasks": "catalog/tasks.json",
            "episodes": "catalog/episodes.json",
            "sources": "catalog/sources.json",
        },
        "evaluation": {
            "repository": "sylvestf/LIBERO-plus",
            "revision": LIBERO_PLUS_REVISION,
            "classification_url": f"https://raw.githubusercontent.com/sylvestf/LIBERO-plus/{LIBERO_PLUS_REVISION}/libero/libero/benchmark/task_classification.json",
            "bddl_base_url": f"https://raw.githubusercontent.com/sylvestf/LIBERO-plus/{LIBERO_PLUS_REVISION}/libero/libero/bddl_files",
        },
        "counts": EXPECTED_COUNTS,
        "source_catalog": metadata,
        "integrity": {
            "index": "integrity/artifacts.json",
            "bytes": integrity_path.stat().st_size,
            "sha256": sha256(integrity_path),
            "artifact_count": len(artifacts),
            "artifact_bytes": sum(record["bytes"] for record in artifacts.values()),
        },
    }
    write_json(output / "manifest.json", manifest)
    print(
        json.dumps(
            {
                "output": str(output),
                "revision": manifest["revision"],
                "files": len(artifacts),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
