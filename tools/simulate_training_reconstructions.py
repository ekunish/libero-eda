#!/usr/bin/env python3
"""Generate approximate 3D motion for unmatched LIBERO-Plus training records.

Run this stage with the pinned LIBERO / robosuite environment.  It first
replays the published action sequence through the official OSC controller.  If
that misses the recorded EEF trajectory, it retries with closed-loop OSC pose
retargeting.  Object motion is published only when the task succeeds; otherwise
the canonical objects remain static and the result is explicitly robot-only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from libero.libero.envs import OffScreenRenderEnv
from robosuite.utils import transform_utils as transform

from pipeline.scene_export import export_mujoco_scene

INPUT_SCHEMA = "libero-plus-training-reconstruction-input/v1"
OUTPUT_SCHEMA = "libero-plus-training-reconstructions/v1"
OWNER = {
    "schema_version": OUTPUT_SCHEMA,
    "owner": "libero-eda-reconstruction-simulator",
}
LIBERO_REVISION = "8f1084e3132a39270c3a13ebe37270a43ece2a01"
SCENE_SCHEMA = "parc-mujoco-scene/v3"
POSITION_RMSE_LIMIT_M = 0.02
POSITION_MAX_LIMIT_M = 0.05
ORIENTATION_RMSE_LIMIT_RAD = math.radians(15.0)
GRIPPER_MAE_LIMIT = 0.01
RETARGET_POSITION_P95_LIMIT_M = 0.006
RETARGET_ORIENTATION_P95_LIMIT_RAD = math.radians(5.0)
POSITION_ACTION_SCALE_M = 0.05
ORIENTATION_ACTION_SCALE_RAD = 0.5
RETARGET_INITIALIZATION_STEPS = 20
RETARGET_INITIAL_POSITION_LIMIT_M = 0.001
RETARGET_INITIAL_ORIENTATION_LIMIT_RAD = math.radians(1.0)
RETARGET_SUBSTEPS_PER_FRAME = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-repo", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
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
        marker = output / ".libero-eda-training-reconstructions.json"
        if not marker.is_file() or json.loads(marker.read_text()) != OWNER:
            raise RuntimeError(f"output is not owned by this tool: {output}")
        if (output / "manifest.json").exists():
            raise RuntimeError(
                f"completed reconstruction output is immutable: {output}"
            )
    else:
        output.mkdir(parents=True)
        write_json(output / ".libero-eda-training-reconstructions.json", OWNER)
    return output


def safe_file(
    root: Path, relative: Any, expected_size: Any, expected_hash: Any
) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise RuntimeError(f"invalid relative path: {relative!r}")
    lexical = Path(relative)
    if ".." in lexical.parts:
        raise RuntimeError(f"relative path escapes root: {relative}")
    path = root / lexical
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"input artifact is missing: {relative}")
    if path.stat().st_size != expected_size or sha256(path) != expected_hash:
        raise RuntimeError(f"input artifact integrity mismatch: {relative}")
    return path


def validate_sources(source: Path) -> None:
    libero = source / "LIBERO"
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=libero,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    if head != LIBERO_REVISION:
        raise RuntimeError(f"Original LIBERO revision mismatch: {head}")
    dirty = subprocess.run(
        [
            "git",
            "status",
            "--porcelain",
            "--untracked-files=no",
            "--",
            "libero/libero/bddl_files",
            "libero/libero/envs",
            "libero/libero/assets",
        ],
        cwd=libero,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    if dirty:
        raise RuntimeError(f"guarded Original LIBERO files are modified: {dirty}")


def load_input(
    root: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    manifest_path = root / "manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise RuntimeError("reconstruction input manifest is missing")
    manifest = json.loads(manifest_path.read_text())
    if (
        manifest.get("schema_version") != INPUT_SCHEMA
        or manifest.get("status") != "complete"
        or manifest.get("sources", {}).get("libero_revision") != LIBERO_REVISION
        or manifest.get("counts")
        != {
            "exact_matches": 12_609,
            "plus_episodes": 14_347,
            "unique_jobs": 207,
            "unmatched_episodes": 1_738,
        }
    ):
        raise RuntimeError("reconstruction input manifest contract mismatch")
    mappings_record = manifest["mappings"]
    jobs_record = manifest["jobs"]
    mappings_path = safe_file(
        root,
        mappings_record["path"],
        mappings_record["bytes"],
        mappings_record["sha256"],
    )
    jobs_path = safe_file(
        root, jobs_record["path"], jobs_record["bytes"], jobs_record["sha256"]
    )
    mappings = json.loads(mappings_path.read_text())
    jobs = json.loads(jobs_path.read_text())
    if len(mappings) != 14_347 or len(jobs) != 207:
        raise RuntimeError("reconstruction input row count mismatch")
    return manifest, mappings, jobs


def body_names(simulation: Any) -> list[str]:
    names = list(simulation.model.body_names)
    decoded = [
        item.decode() if isinstance(item, bytes) else str(item) for item in names
    ]
    if (
        not decoded
        or len(decoded) != simulation.model.nbody
        or len(decoded) != len(set(decoded))
    ):
        raise RuntimeError("MuJoCo body-name contract mismatch")
    return decoded


def capture(
    env: OffScreenRenderEnv, observation: dict[str, Any]
) -> dict[str, np.ndarray]:
    return {
        "eef_position": np.asarray(
            observation["robot0_eef_pos"], dtype=np.float64
        ).copy(),
        "eef_quaternion": np.asarray(
            observation["robot0_eef_quat"], dtype=np.float64
        ).copy(),
        "gripper": np.asarray(
            observation["robot0_gripper_qpos"], dtype=np.float64
        ).copy(),
        "joints": np.asarray(observation["robot0_joint_pos"], dtype=np.float64).copy(),
        "body_positions": np.asarray(env.sim.data.body_xpos, dtype=np.float64).copy(),
        "body_quaternions": np.asarray(
            env.sim.data.body_xquat, dtype=np.float64
        ).copy(),
        "qpos": np.asarray(env.sim.data.qpos, dtype=np.float64).copy(),
        "qvel": np.asarray(env.sim.data.qvel, dtype=np.float64).copy(),
    }


def retarget_action(
    observation: dict[str, Any], desired: np.ndarray, gripper_action: float
) -> tuple[np.ndarray, float, float]:
    current_position = np.asarray(observation["robot0_eef_pos"], dtype=np.float64)
    current_quaternion = np.asarray(observation["robot0_eef_quat"], dtype=np.float64)
    target_quaternion = transform.axisangle2quat(desired[3:6])
    orientation_error = transform.quat2axisangle(
        transform.quat_distance(target_quaternion, current_quaternion)
    )
    position_error = desired[:3] - current_position
    action = np.empty((7,), dtype=np.float64)
    action[:3] = np.clip(position_error / POSITION_ACTION_SCALE_M, -1.0, 1.0)
    action[3:6] = np.clip(orientation_error / ORIENTATION_ACTION_SCALE_RAD, -1.0, 1.0)
    action[6] = gripper_action
    return (
        action,
        float(np.linalg.norm(position_error)),
        float(np.linalg.norm(orientation_error)),
    )


def run_episode(
    env: OffScreenRenderEnv,
    initial_state: np.ndarray,
    actions: np.ndarray,
    target: np.ndarray | None,
) -> tuple[dict[str, np.ndarray], bool]:
    env.reset()
    observation = env.set_init_state(initial_state)
    if target is not None:
        for _ in range(RETARGET_INITIALIZATION_STEPS):
            action, position_error, orientation_error = retarget_action(
                observation, target[0], float(actions[0, 6])
            )
            if (
                position_error <= RETARGET_INITIAL_POSITION_LIMIT_M
                and orientation_error <= RETARGET_INITIAL_ORIENTATION_LIMIT_RAD
            ):
                break
            observation, _, _, _ = env.step(action)
    frames = [capture(env, observation)]
    success = bool(env.check_success())
    for index, source_action in enumerate(actions[:-1]):
        if target is not None:
            desired = target[index + 1]
            for _ in range(RETARGET_SUBSTEPS_PER_FRAME):
                action, _, _ = retarget_action(
                    observation, desired, float(source_action[6])
                )
                observation, _, done, _ = env.step(action)
                success = success or bool(done) or bool(env.check_success())
        else:
            action = np.asarray(source_action, dtype=np.float64).copy()
            observation, _, done, _ = env.step(action)
            success = success or bool(done) or bool(env.check_success())
        frames.append(capture(env, observation))
    arrays = {key: np.stack([frame[key] for frame in frames]) for key in frames[0]}
    if any(not np.all(np.isfinite(value)) for value in arrays.values()):
        raise RuntimeError("MuJoCo reconstruction produced non-finite state")
    return arrays, success


def target_quaternions(states: np.ndarray) -> np.ndarray:
    flat = states[..., 3:6].reshape(-1, 3)
    values = np.stack([transform.axisangle2quat(item) for item in flat])
    return values.reshape(*states.shape[:-1], 4)


def metrics(
    arrays: dict[str, np.ndarray], targets: np.ndarray
) -> list[dict[str, float]]:
    target_quats = target_quaternions(targets)
    result = []
    for index, target in enumerate(targets):
        position = np.linalg.norm(arrays["eef_position"] - target[:, :3], axis=1)
        dots = np.abs(np.sum(arrays["eef_quaternion"] * target_quats[index], axis=1))
        orientation = 2.0 * np.arccos(np.clip(dots, 0.0, 1.0))
        gripper = np.abs(arrays["gripper"] - target[:, 6:8])
        result.append(
            {
                "position_rmse_m": float(np.sqrt(np.mean(position**2))),
                "position_max_m": float(np.max(position)),
                "position_p95_m": float(np.quantile(position, 0.95)),
                "orientation_rmse_rad": float(np.sqrt(np.mean(orientation**2))),
                "orientation_p95_rad": float(np.quantile(orientation, 0.95)),
                "gripper_mae": float(np.mean(gripper)),
            }
        )
    return result


def action_replay_accepted(values: list[dict[str, float]], success: bool) -> bool:
    return success and all(
        item["position_rmse_m"] <= POSITION_RMSE_LIMIT_M
        and item["position_max_m"] <= POSITION_MAX_LIMIT_M
        and item["orientation_rmse_rad"] <= ORIENTATION_RMSE_LIMIT_RAD
        and item["gripper_mae"] <= GRIPPER_MAE_LIMIT
        for item in values
    )


def retarget_accepted(values: list[dict[str, float]]) -> bool:
    return all(
        item["position_p95_m"] <= RETARGET_POSITION_P95_LIMIT_M
        and item["orientation_p95_rad"] <= RETARGET_ORIENTATION_P95_LIMIT_RAD
        for item in values
    )


def make_robot_only(arrays: dict[str, np.ndarray], names: list[str]) -> None:
    dynamic = tuple("robot0_ gripper0_".split())
    for index, name in enumerate(names):
        if name.startswith(dynamic):
            continue
        arrays["body_positions"][:, index] = arrays["body_positions"][0, index]
        arrays["body_quaternions"][:, index] = arrays["body_quaternions"][0, index]


def write_series(
    path: Path, arrays: dict[str, np.ndarray], actions: np.ndarray
) -> None:
    write_npz(
        path,
        ee_positions=arrays["eef_position"],
        ee_orientations=arrays["eef_quaternion"],
        gripper_qpos=arrays["gripper"],
        actions=actions,
        joint_positions=arrays["joints"],
        body_positions=arrays["body_positions"],
        body_quaternions=arrays["body_quaternions"],
        qpos=arrays["qpos"],
        qvel=arrays["qvel"],
    )


def validate_receipt(output: Path, receipt_path: Path) -> dict[str, Any]:
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("schema_version") != OUTPUT_SCHEMA:
        raise RuntimeError(f"invalid reconstruction receipt: {receipt_path}")
    if receipt["method"] != "unavailable":
        safe_file(
            output,
            receipt["series"],
            receipt["series_bytes"],
            receipt["series_sha256"],
        )
        safe_file(
            output,
            receipt["scene"],
            receipt["scene_bytes"],
            receipt["scene_sha256"],
        )
    return receipt


def main() -> None:
    args = parse_args()
    source = args.source_repo.resolve(strict=True)
    input_root = args.input.resolve(strict=True)
    output = ensure_output(args.output)
    validate_sources(source)
    input_manifest, input_mappings, jobs = load_input(input_root)
    selected = jobs[: args.limit] if args.limit is not None else jobs
    if args.limit is not None and (args.limit < 1 or args.limit > len(jobs)):
        raise RuntimeError(f"invalid limit: {args.limit}")

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for job in selected:
        grouped[job["task_key"]].append(job)
    receipts: list[dict[str, Any]] = []
    processed = 0
    for task_key, task_jobs in sorted(grouped.items()):
        bddl = Path(task_jobs[0]["bddl_path"]).resolve(strict=True)
        if any(
            Path(item["bddl_path"]).resolve(strict=True) != bddl for item in task_jobs
        ):
            raise RuntimeError(f"inconsistent BDDL path: {task_key}")
        env = OffScreenRenderEnv(
            bddl_file_name=str(bddl),
            camera_heights=64,
            camera_widths=64,
            control_freq=20,
            ignore_done=True,
            horizon=max(item["length"] for item in task_jobs)
            * RETARGET_SUBSTEPS_PER_FRAME
            + RETARGET_INITIALIZATION_STEPS
            + 10,
        )
        try:
            scene_record: dict[str, Any] | None = None
            names: list[str] | None = None
            for job in task_jobs:
                receipt_path = output / "receipts" / f"{job['reconstruction_id']}.json"
                if receipt_path.is_file():
                    receipts.append(validate_receipt(output, receipt_path))
                    processed += 1
                    continue
                job_path = safe_file(
                    input_root, job["job"], job["job_bytes"], job["job_sha256"]
                )
                with np.load(job_path, allow_pickle=False) as data:
                    actions = np.asarray(data["actions"], dtype=np.float64)
                    targets = np.asarray(data["target_states"], dtype=np.float64)
                    initial = np.asarray(data["candidate_sim_state"], dtype=np.float64)
                    indices = np.asarray(data["target_episode_indices"], dtype=np.int64)
                if (
                    actions.shape != (job["length"], 7)
                    or targets.shape
                    != (len(job["member_replay_ids"]), job["length"], 8)
                    or len(indices) != len(job["member_replay_ids"])
                ):
                    raise RuntimeError(
                        f"reconstruction job shape mismatch: {job['reconstruction_id']}"
                    )
                if (
                    hashlib.sha256(
                        np.ascontiguousarray(actions, dtype="<f4").tobytes(order="C")
                    ).hexdigest()
                    != job["action_sha256"]
                ):
                    raise RuntimeError(
                        f"reconstruction job action mismatch: {job['reconstruction_id']}"
                    )

                arrays, success = run_episode(env, initial, actions, None)
                values = metrics(arrays, targets)
                method = "mujoco_action_replay"
                object_motion = "mujoco_simulated"
                if not action_replay_accepted(values, success):
                    medoid = job["member_replay_ids"].index(job["medoid_replay_id"])
                    arrays, success = run_episode(
                        env, initial, actions, targets[medoid]
                    )
                    values = metrics(arrays, targets)
                    method = "mujoco_osc_retarget"
                    object_motion = "mujoco_simulated"
                    if not retarget_accepted(values):
                        method = "unavailable"
                        object_motion = "not_published"
                    elif not success:
                        method = "mujoco_osc_robot_only"
                        object_motion = "static_canonical"

                if method != "unavailable":
                    if names is None:
                        names = body_names(env.sim)
                    if arrays["body_positions"].shape[1] != len(names):
                        raise RuntimeError(
                            f"body count mismatch: {job['reconstruction_id']}"
                        )
                    if object_motion == "static_canonical":
                        make_robot_only(arrays, names)
                    if scene_record is None:
                        scene = export_mujoco_scene(env.sim.model, output / "scenes")
                        scene_record = {
                            "path": str(scene.path.relative_to(output)),
                            "bytes": scene.path.stat().st_size,
                            "sha256": sha256(scene.path),
                            "hash": scene.scene_hash,
                            "schema": SCENE_SCHEMA,
                        }
                    series_path = output / "series" / f"{job['reconstruction_id']}.npz"
                    write_series(series_path, arrays, actions)
                    receipt = {
                        "schema_version": OUTPUT_SCHEMA,
                        "reconstruction_id": job["reconstruction_id"],
                        "task_key": task_key,
                        "method": method,
                        "object_motion": object_motion,
                        "appearance": "original_libero_canonical",
                        "candidate_source_replay_id": job["candidate_source_replay_id"],
                        "candidate_score": job["candidate_score"],
                        "source_action_sha256": job["action_sha256"],
                        "member_replay_ids": job["member_replay_ids"],
                        "member_episode_indices": indices.tolist(),
                        "metrics": dict(
                            zip(job["member_replay_ids"], values, strict=True)
                        ),
                        "goal_success": success,
                        "body_names": names,
                        "scene": scene_record["path"],
                        "scene_hash": scene_record["hash"],
                        "scene_schema": scene_record["schema"],
                        "scene_bytes": scene_record["bytes"],
                        "scene_sha256": scene_record["sha256"],
                        "series": str(series_path.relative_to(output)),
                        "series_bytes": series_path.stat().st_size,
                        "series_sha256": sha256(series_path),
                    }
                else:
                    receipt = {
                        "schema_version": OUTPUT_SCHEMA,
                        "reconstruction_id": job["reconstruction_id"],
                        "task_key": task_key,
                        "method": "unavailable",
                        "object_motion": "not_published",
                        "appearance": "not_available",
                        "candidate_source_replay_id": job["candidate_source_replay_id"],
                        "candidate_score": job["candidate_score"],
                        "source_action_sha256": job["action_sha256"],
                        "member_replay_ids": job["member_replay_ids"],
                        "member_episode_indices": indices.tolist(),
                        "metrics": dict(
                            zip(job["member_replay_ids"], values, strict=True)
                        ),
                        "goal_success": success,
                        "reason": "OSC reconstruction exceeded the published EEF acceptance limits",
                    }
                write_json(receipt_path, receipt)
                receipts.append(receipt)
                processed += 1
                print(
                    f"[{processed}/{len(selected)}] {job['reconstruction_id']} "
                    f"{receipt['method']} goal={receipt['goal_success']}",
                    flush=True,
                )
        finally:
            env.close()

    if args.limit is not None:
        print(
            json.dumps(
                {"output": str(output), "processed": processed, "complete": False}
            )
        )
        return
    receipts.sort(key=lambda item: item["reconstruction_id"])
    if (
        len(receipts) != 207
        or len({item["reconstruction_id"] for item in receipts}) != 207
    ):
        raise RuntimeError("reconstruction receipt coverage mismatch")
    receipt_by_id = {item["reconstruction_id"]: item for item in receipts}
    output_mappings = []
    for mapping in input_mappings:
        value = dict(mapping)
        if value["method"] == "pending_mujoco_reconstruction":
            receipt = receipt_by_id[value["reconstruction_id"]]
            value.update(
                {
                    "method": receipt["method"],
                    "object_motion": receipt["object_motion"],
                    "appearance": receipt["appearance"],
                    "metrics": receipt["metrics"][value["replay_id"]],
                    "goal_success": receipt["goal_success"],
                }
            )
        output_mappings.append(value)
    methods = Counter(item["method"] for item in output_mappings)
    reconstruction_methods = Counter(item["method"] for item in receipts)
    mappings_path = output / "mappings.json"
    records_path = output / "reconstructions.json"
    write_json(mappings_path, output_mappings)
    write_json(records_path, receipts)
    manifest = {
        "schema_version": OUTPUT_SCHEMA,
        "status": "complete",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_input": {
            "schema_version": INPUT_SCHEMA,
            "manifest_sha256": sha256(input_root / "manifest.json"),
            "libero_revision": LIBERO_REVISION,
        },
        "thresholds": {
            "action_replay": {
                "position_rmse_m": POSITION_RMSE_LIMIT_M,
                "position_max_m": POSITION_MAX_LIMIT_M,
                "orientation_rmse_rad": ORIENTATION_RMSE_LIMIT_RAD,
                "gripper_mae": GRIPPER_MAE_LIMIT,
                "goal_success_required": True,
            },
            "osc_retarget": {
                "position_p95_m": RETARGET_POSITION_P95_LIMIT_M,
                "orientation_p95_rad": RETARGET_ORIENTATION_P95_LIMIT_RAD,
                "initialization_steps": RETARGET_INITIALIZATION_STEPS,
                "initial_position_limit_m": RETARGET_INITIAL_POSITION_LIMIT_M,
                "initial_orientation_limit_rad": RETARGET_INITIAL_ORIENTATION_LIMIT_RAD,
                "substeps_per_frame": RETARGET_SUBSTEPS_PER_FRAME,
            },
        },
        "counts": {
            "plus_episodes": len(output_mappings),
            "unique_reconstructions": len(receipts),
            "episode_methods": dict(sorted(methods.items())),
            "reconstruction_methods": dict(sorted(reconstruction_methods.items())),
        },
        "mappings": {
            "path": "mappings.json",
            "bytes": mappings_path.stat().st_size,
            "sha256": sha256(mappings_path),
        },
        "reconstructions": {
            "path": "reconstructions.json",
            "bytes": records_path.stat().st_size,
            "sha256": sha256(records_path),
        },
    }
    write_json(output / "manifest.json", manifest)
    print(json.dumps({"output": str(output), "counts": manifest["counts"]}, indent=2))


if __name__ == "__main__":
    main()
