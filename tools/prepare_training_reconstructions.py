#!/usr/bin/env python3
"""Prepare fail-closed LIBERO-Plus training-scene reconstruction inputs.

This stage runs in the catalog / Arrow environment.  It does not import
MuJoCo.  Exact action matches reference the already validated Original LIBERO
replays.  The remaining unique action sequences are written as compact jobs
for ``simulate_training_reconstructions.py``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = "libero-plus-training-reconstruction-input/v1"
OWNER = {"schema_version": SCHEMA, "owner": "libero-eda-reconstruction-preparer"}
CATALOG_SCHEMA = "7"
PLUS_REVISION = "f3f49f426d75030177b18778374005bc12ccd588"
ORIGINAL_REVISION = "f13aa24a3da8c43c7225569f28c562979fa0e35a"
LIBERO_REVISION = "8f1084e3132a39270c3a13ebe37270a43ece2a01"
EXPECTED = {
    "plus_episodes": 14_347,
    "exact_matches": 12_609,
    "unmatched_episodes": 1_738,
    "unique_jobs": 207,
}
RESAMPLE_COUNT = 128
POSITION_SCALE_M = 0.02
ORIENTATION_SCALE_RAD = 0.25
GRIPPER_SCALE = 0.01


@dataclass(frozen=True)
class OriginalEpisode:
    replay_id: str
    task_key: str
    series_path: Path
    action_sha256: str
    length: int
    states: np.ndarray
    sim_state0: np.ndarray


@dataclass(frozen=True)
class PlusEpisode:
    replay_id: str
    source_episode_index: int
    task_key: str
    action_sha256: str
    tag: str
    states: np.ndarray
    actions: np.ndarray


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def action_sha256(actions: np.ndarray) -> str:
    value = np.ascontiguousarray(actions, dtype="<f4")
    if value.ndim != 2 or value.shape[1] != 7 or len(value) < 1:
        raise RuntimeError(f"invalid action array: {value.shape}")
    return hashlib.sha256(value.tobytes(order="C")).hexdigest()


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


def write_npz(path: Path, **arrays: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("wb") as stream:
        np.savez_compressed(stream, **arrays)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def ensure_output(path: Path) -> Path:
    output = path.resolve()
    if output.exists():
        marker = output / ".libero-eda-reconstruction-input.json"
        if not marker.is_file() or json.loads(marker.read_text()) != OWNER:
            raise RuntimeError(f"output is not owned by this tool: {output}")
        if (output / "manifest.json").exists():
            raise RuntimeError(f"completed output is immutable: {output}")
    else:
        output.mkdir(parents=True)
        write_json(output / ".libero-eda-reconstruction-input.json", OWNER)
    return output


def git_head(repository: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def validate_sources(source: Path) -> tuple[Path, Path, Path]:
    libero = source / "LIBERO"
    if git_head(libero) != LIBERO_REVISION:
        raise RuntimeError("Original LIBERO revision mismatch")
    dirty = subprocess.run(
        [
            "git",
            "status",
            "--porcelain",
            "--untracked-files=no",
            "--",
            "libero/libero/bddl_files",
            "libero/libero/envs",
        ],
        cwd=libero,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    if dirty:
        raise RuntimeError(f"guarded Original LIBERO files are modified: {dirty}")
    state_root = source / ".parc" / "eda"
    database = state_root / "index.duckdb"
    original_root = (
        source
        / ".cache"
        / "original-libero-eda"
        / "parc-mujoco-scene-v3"
        / "mujoco-classic-uv3"
        / ORIGINAL_REVISION
    )
    plus_root = (
        source
        / ".cache"
        / "lerobot"
        / "hub"
        / "datasets--lerobot--libero_plus"
        / "snapshots"
        / PLUS_REVISION
    )
    for item in (
        database,
        original_root / "dataset.json",
        plus_root / "meta" / "info.json",
    ):
        if not item.is_file():
            raise RuntimeError(f"required source is missing: {item}")
    return database, original_root, plus_root


def array_from_fixed_list(column: pa.ChunkedArray, width: int) -> np.ndarray:
    combined = column.combine_chunks()
    values = np.asarray(combined.values, dtype=np.float32)
    if values.size % width:
        raise RuntimeError(f"fixed-list column width mismatch: {values.size}/{width}")
    return values.reshape(-1, width)


def parquet_episode_slices(table: pa.Table) -> dict[int, tuple[int, int]]:
    indices = np.asarray(table.column("episode_index").combine_chunks(), dtype=np.int64)
    if not len(indices):
        return {}
    starts = np.r_[0, np.flatnonzero(indices[1:] != indices[:-1]) + 1]
    ends = np.r_[starts[1:], len(indices)]
    result: dict[int, tuple[int, int]] = {}
    for start, end in zip(starts.tolist(), ends.tolist(), strict=True):
        episode = int(indices[start])
        if episode in result or np.any(indices[start:end] != episode):
            raise RuntimeError(f"non-contiguous or duplicate episode: {episode}")
        result[episode] = (start, end)
    return result


def load_plus_episodes(rows: list[dict[str, Any]]) -> list[PlusEpisode]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["series_path"]].append(row)
    result: list[PlusEpisode] = []
    for parquet_path, records in sorted(grouped.items()):
        table = pq.read_table(
            parquet_path,
            columns=["episode_index", "frame_index", "observation.state", "action"],
        )
        slices = parquet_episode_slices(table)
        states = array_from_fixed_list(table.column("observation.state"), 8)
        actions = array_from_fixed_list(table.column("action"), 7)
        frames = np.asarray(
            table.column("frame_index").combine_chunks(), dtype=np.int64
        )
        for row in records:
            episode = int(row["source_episode_index"])
            bounds = slices.get(episode)
            if bounds is None:
                raise RuntimeError(f"Plus episode is missing from Parquet: {episode}")
            start, end = bounds
            length = int(row["length"])
            if end - start != length or not np.array_equal(
                frames[start:end], np.arange(length)
            ):
                raise RuntimeError(f"Plus episode frame contract mismatch: {episode}")
            episode_actions = np.asarray(actions[start:end], dtype=np.float32)
            actual_hash = action_sha256(episode_actions)
            if actual_hash != row["source_action_sha256"]:
                raise RuntimeError(f"Plus action hash mismatch: {episode}")
            result.append(
                PlusEpisode(
                    replay_id=row["replay_id"],
                    source_episode_index=episode,
                    task_key=row["base_task_key"],
                    action_sha256=actual_hash,
                    tag=row["training_environment_category"],
                    states=np.asarray(states[start:end], dtype=np.float64),
                    actions=np.asarray(episode_actions, dtype=np.float64),
                )
            )
    return sorted(result, key=lambda item: item.source_episode_index)


def load_original_episodes(
    original_root: Path,
) -> tuple[dict[str, list[OriginalEpisode]], dict[str, str]]:
    dataset = json.loads((original_root / "dataset.json").read_text())
    if (
        dataset.get("schema_version") != "parc-original-libero-derived/v1"
        or dataset.get("revision") != ORIGINAL_REVISION
        or dataset.get("task_count") != 130
        or dataset.get("episode_count") != 6_500
    ):
        raise RuntimeError("Original LIBERO derived dataset contract mismatch")
    by_task: dict[str, list[OriginalEpisode]] = defaultdict(list)
    bddl_by_task: dict[str, str] = {}
    for task_entry in dataset["tasks"]:
        task_manifest_path = original_root / task_entry["manifest"]
        if sha256(task_manifest_path) != task_entry["manifest_sha256"]:
            raise RuntimeError(
                f"Original task manifest hash mismatch: {task_manifest_path}"
            )
        task = json.loads(task_manifest_path.read_text())
        key = task["task_key"]
        if key in bddl_by_task:
            raise RuntimeError(f"duplicate Original task: {key}")
        bddl_by_task[key] = str(
            (task_manifest_path.parent / task["bddl"]).resolve(strict=True)
        )
        root = task_manifest_path.parent
        for record in task["episodes"]:
            path = root / record["series"]
            if sha256(path) != record["series_sha256"]:
                raise RuntimeError(f"Original series hash mismatch: {path}")
            with np.load(path, allow_pickle=False) as data:
                actions = np.asarray(data["actions"], dtype=np.float64)
                states = np.concatenate(
                    [data["ee_positions"], data["ee_axis_angle"], data["gripper_qpos"]],
                    axis=1,
                ).astype(np.float64)
                sim_state0 = np.asarray(data["sim_states"][0], dtype=np.float64)
            if len(actions) != record["state_count"] or states.shape != (
                len(actions),
                8,
            ):
                raise RuntimeError(f"Original series shape mismatch: {path}")
            by_task[key].append(
                OriginalEpisode(
                    replay_id=record["replay_id"],
                    task_key=key,
                    series_path=path,
                    action_sha256=action_sha256(actions),
                    length=len(actions),
                    states=states,
                    sim_state0=sim_state0,
                )
            )
        if len(by_task[key]) != 50:
            raise RuntimeError(f"Original task does not have 50 demos: {key}")
    return dict(by_task), bddl_by_task


def rotation_vectors_to_quaternions(vectors: np.ndarray) -> np.ndarray:
    angles = np.linalg.norm(vectors, axis=-1, keepdims=True)
    half = angles * 0.5
    scale = np.divide(
        np.sin(half), angles, out=np.full_like(angles, 0.5), where=angles > 1e-12
    )
    return np.concatenate([vectors * scale, np.cos(half)], axis=-1)


def orientation_errors(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    ql = rotation_vectors_to_quaternions(left)
    qr = rotation_vectors_to_quaternions(right)
    dots = np.abs(np.sum(ql * qr, axis=-1))
    return 2.0 * np.arccos(np.clip(dots, 0.0, 1.0))


def trajectory_metrics(left: np.ndarray, right: np.ndarray) -> dict[str, float]:
    if left.shape != right.shape or left.ndim != 2 or left.shape[1] != 8:
        raise RuntimeError(f"trajectory shape mismatch: {left.shape}/{right.shape}")
    position = np.linalg.norm(left[:, :3] - right[:, :3], axis=1)
    orientation = orientation_errors(left[:, 3:6], right[:, 3:6])
    gripper = np.abs(left[:, 6:8] - right[:, 6:8])
    return {
        "position_rmse_m": float(np.sqrt(np.mean(position**2))),
        "position_max_m": float(np.max(position)),
        "orientation_rmse_rad": float(np.sqrt(np.mean(orientation**2))),
        "gripper_mae": float(np.mean(gripper)),
    }


def resample(states: np.ndarray) -> np.ndarray:
    source = np.linspace(0.0, 1.0, len(states))
    target = np.linspace(0.0, 1.0, RESAMPLE_COUNT)
    return np.stack(
        [
            np.interp(target, source, states[:, index])
            for index in range(states.shape[1])
        ],
        axis=1,
    )


def normalized_distance(left: np.ndarray, right: np.ndarray) -> float:
    position = np.linalg.norm(left[:, :3] - right[:, :3], axis=1)
    orientation = orientation_errors(left[:, 3:6], right[:, 3:6])
    gripper = np.abs(left[:, 6:8] - right[:, 6:8])
    return float(
        np.sqrt(np.mean(position**2)) / POSITION_SCALE_M
        + np.sqrt(np.mean(orientation**2)) / ORIENTATION_SCALE_RAD
        + np.sqrt(np.mean(gripper**2)) / GRIPPER_SCALE
    )


def json_rows(cursor: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def main() -> None:
    args = parse_args()
    source = args.source_repo.resolve(strict=True)
    output = ensure_output(args.output)
    database_path, original_root, _ = validate_sources(source)
    con = duckdb.connect(str(database_path), read_only=True)
    try:
        metadata = dict(con.execute("SELECT key, value FROM metadata").fetchall())
        if (
            metadata.get("schema_version") != CATALOG_SCHEMA
            or metadata.get("dataset_revision") != PLUS_REVISION
            or metadata.get("original_dataset_revision") != ORIGINAL_REVISION
        ):
            raise RuntimeError("catalog revision contract mismatch")
        plus_rows = json_rows(
            con.execute(
                """SELECT replay_id, source_episode_index, base_task_key, length,
                          series_path, source_action_sha256,
                          training_environment_category
                   FROM episodes WHERE dataset_id='lerobot_libero_plus'
                   ORDER BY source_episode_index"""
            )
        )
        bddl_paths = dict(
            con.execute(
                "SELECT task_key, bddl_path FROM tasks WHERE source='libero'"
            ).fetchall()
        )
    finally:
        con.close()
    if len(plus_rows) != EXPECTED["plus_episodes"]:
        raise RuntimeError(f"Plus episode count mismatch: {len(plus_rows)}")

    original_by_task, _ = load_original_episodes(original_root)
    plus = load_plus_episodes(plus_rows)
    exact_index: dict[tuple[str, int, str], list[OriginalEpisode]] = defaultdict(list)
    for task_key, episodes in original_by_task.items():
        for episode in episodes:
            exact_index[(task_key, episode.length, episode.action_sha256)].append(
                episode
            )

    mappings: list[dict[str, Any]] = []
    unmatched_groups: dict[tuple[str, int, str], list[PlusEpisode]] = defaultdict(list)
    for episode in plus:
        matches = exact_index.get(
            (episode.task_key, len(episode.actions), episode.action_sha256), []
        )
        if len(matches) > 1:
            raise RuntimeError(f"ambiguous Original action match: {episode.replay_id}")
        if matches:
            match = matches[0]
            mappings.append(
                {
                    "replay_id": episode.replay_id,
                    "reconstruction_id": f"original-proxy-{match.replay_id}",
                    "method": "original_action_match_proxy",
                    "source_replay_id": match.replay_id,
                    "source_action_sha256": episode.action_sha256,
                    "appearance": "original_libero_canonical",
                    "object_motion": "original_successful_demo_proxy",
                    "metrics": trajectory_metrics(episode.states, match.states),
                }
            )
        else:
            unmatched_groups[
                (episode.task_key, len(episode.actions), episode.action_sha256)
            ].append(episode)

    jobs: list[dict[str, Any]] = []
    for (task_key, length, action_hash), members in sorted(unmatched_groups.items()):
        if any(
            not np.array_equal(members[0].actions, item.actions) for item in members[1:]
        ):
            raise RuntimeError(f"action hash collision: {task_key}/{action_hash}")
        resampled_members = [resample(item.states) for item in members]
        medoid_index = min(
            range(len(members)),
            key=lambda index: (
                sum(
                    normalized_distance(resampled_members[index], candidate)
                    for candidate in resampled_members
                ),
                members[index].source_episode_index,
            ),
        )
        candidates = original_by_task.get(task_key)
        if not candidates or task_key not in bddl_paths:
            raise RuntimeError(f"Original reconstruction source is missing: {task_key}")
        candidate_scores = []
        for candidate in candidates:
            sampled = resample(candidate.states)
            score = float(
                np.median(
                    [
                        normalized_distance(member, sampled)
                        for member in resampled_members
                    ]
                )
            )
            candidate_scores.append((score, candidate.replay_id, candidate))
        score, _, candidate = min(candidate_scores, key=lambda item: (item[0], item[1]))
        reconstruction_id = f"mujoco-{action_hash[:24]}"
        relative = f"jobs/{reconstruction_id}.npz"
        write_npz(
            output / relative,
            actions=members[0].actions,
            target_states=np.stack([item.states for item in members]),
            target_episode_indices=np.asarray(
                [item.source_episode_index for item in members], dtype=np.int32
            ),
            candidate_sim_state=candidate.sim_state0,
        )
        job = {
            "reconstruction_id": reconstruction_id,
            "task_key": task_key,
            "bddl_path": str(Path(bddl_paths[task_key]).resolve(strict=True)),
            "action_sha256": action_hash,
            "length": length,
            "tag_members": sorted({item.tag for item in members}),
            "member_replay_ids": [item.replay_id for item in members],
            "medoid_replay_id": members[medoid_index].replay_id,
            "candidate_source_replay_id": candidate.replay_id,
            "candidate_score": score,
            "job": relative,
            "job_bytes": (output / relative).stat().st_size,
            "job_sha256": sha256(output / relative),
        }
        jobs.append(job)
        for item in members:
            mappings.append(
                {
                    "replay_id": item.replay_id,
                    "reconstruction_id": reconstruction_id,
                    "method": "pending_mujoco_reconstruction",
                    "source_replay_id": candidate.replay_id,
                    "source_action_sha256": action_hash,
                    "appearance": "original_libero_canonical",
                    "object_motion": "pending_validation",
                    "metrics": None,
                }
            )

    mappings.sort(key=lambda item: int(item["replay_id"].removeprefix("demo-")))
    exact_count = sum(
        item["method"] == "original_action_match_proxy" for item in mappings
    )
    actual = {
        "plus_episodes": len(mappings),
        "exact_matches": exact_count,
        "unmatched_episodes": len(mappings) - exact_count,
        "unique_jobs": len(jobs),
    }
    if actual != EXPECTED:
        raise RuntimeError(f"reconstruction coverage changed: {actual} != {EXPECTED}")
    mappings_path = output / "mappings.json"
    jobs_path = output / "jobs.json"
    write_json(mappings_path, mappings)
    write_json(jobs_path, jobs)
    manifest = {
        "schema_version": SCHEMA,
        "status": "complete",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "catalog_schema": CATALOG_SCHEMA,
            "libero_plus_dataset_revision": PLUS_REVISION,
            "original_dataset_revision": ORIGINAL_REVISION,
            "libero_revision": LIBERO_REVISION,
        },
        "selection": {
            "resample_count": RESAMPLE_COUNT,
            "position_scale_m": POSITION_SCALE_M,
            "orientation_scale_rad": ORIENTATION_SCALE_RAD,
            "gripper_scale": GRIPPER_SCALE,
            "group_representative": "trajectory_medoid",
            "source_candidate": "minimum_median_normalized_trajectory_distance",
        },
        "counts": actual,
        "mappings": {
            "path": "mappings.json",
            "bytes": mappings_path.stat().st_size,
            "sha256": sha256(mappings_path),
        },
        "jobs": {
            "path": "jobs.json",
            "bytes": jobs_path.stat().st_size,
            "sha256": sha256(jobs_path),
        },
    }
    write_json(output / "manifest.json", manifest)
    print(json.dumps({"output": str(output), "counts": actual}, indent=2))


if __name__ == "__main__":
    main()
