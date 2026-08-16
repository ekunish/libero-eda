#!/usr/bin/env python3
"""Export official background and light candidates for training-video matching.

The public LIBERO-Plus training artifact identifies an episode only as ``env``
or ``light``.  It does not publish the exact BDDL variant.  This exporter builds
the finite official candidate library used by the separate matcher.  It emits
one shared geometry pack and one gzip shard per Original source task, plus an
offline-only RGB / segmentation reference bank.  It never assigns a candidate
to a training episode.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import random
import sys
from dataclasses import dataclass
from multiprocessing import get_context
from pathlib import Path
from typing import Any

import numpy as np

from export_evaluation_scenes import (
    CONSTRUCTOR_ATTEMPT_LIMIT,
    CONSTRUCTOR_RANDOMIZATION_POLICY,
    ENVIRONMENT_SEED,
    LIBERO_PLUS_REVISION,
    BaseTask,
    bddl_paths,
    copy_texture,
    init_path,
    load_base_tasks,
    load_initial_state,
    sha256,
    validate_source,
    write_gzip_json,
    write_json,
)
from training_appearance_candidates import EXPECTED_PER_TASK, discover_candidate_names

SCHEMA_VERSION = "libero-plus-training-appearance-candidates/v1"
SHARD_SCHEMA = "libero-plus-training-appearance-candidate-shard/v1"
OWNER = {
    "schema_version": SCHEMA_VERSION,
    "owner": "libero-eda-training-appearance-exporter",
}
EXPECTED_TASKS = 40
REFERENCE_SIZE = 128


@dataclass(frozen=True)
class Candidate:
    category: str
    variant: str
    name: str
    runtime_bddl: Path
    resolved_bddl: Path
    init_state: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-repo", type=Path, required=True)
    parser.add_argument("--hosted-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--workers", type=int, default=max(1, min(6, os.cpu_count() or 1))
    )
    parser.add_argument("--probe-task")
    return parser.parse_args()


def ensure_output(path: Path, *, probe: bool) -> Path:
    output = path.resolve()
    marker = output / ".libero-training-appearance-candidates.json"
    if output.exists():
        if (
            marker.is_symlink()
            or not marker.is_file()
            or json.loads(marker.read_text()) != OWNER
        ):
            raise RuntimeError(f"output is not owned by this exporter: {output}")
    else:
        output.mkdir(parents=True)
        write_json(marker, OWNER)
    if (output / "manifest.json").exists() and not probe:
        raise RuntimeError(
            f"completed appearance candidate export is immutable: {output}"
        )
    return output


def candidate_rows(source_repo: Path, base: BaseTask) -> list[Candidate]:
    plus_root = source_repo / "LIBERO-plus/libero/libero"
    canonical_init = init_path(plus_root, base.suite, base.name)
    result: list[Candidate] = []
    resolved_root = plus_root / "bddl_files" / base.suite
    discovered = discover_candidate_names(resolved_root, base.name)
    for category in EXPECTED_PER_TASK:
        for variant, name in sorted(discovered[category]):
            runtime, resolved = bddl_paths(plus_root, base.suite, name)
            if not runtime.is_file() or not resolved.is_file():
                raise RuntimeError(
                    f"official appearance candidate is missing: {runtime}"
                )
            result.append(
                Candidate(
                    category=category,
                    variant=variant,
                    name=name,
                    runtime_bddl=runtime,
                    resolved_bddl=resolved,
                    init_state=canonical_init,
                )
            )
    counts = {
        category: sum(item.category == category for item in result)
        for category in EXPECTED_PER_TASK
    }
    if counts != EXPECTED_PER_TASK or len(result) != 100:
        raise RuntimeError(
            f"appearance candidate coverage mismatch: {base.task_key}: {counts}"
        )
    return result


def _install_source(source_repo: Path) -> None:
    for entry in (str(source_repo / "LIBERO-plus"), str(source_repo)):
        if entry not in sys.path:
            sys.path.insert(0, entry)
    os.environ["LIBERO_CONFIG_PATH"] = str(source_repo / ".parc/libero-eval")
    os.environ.setdefault("MUJOCO_GL", "osmesa")


def _body_is_static(model: Any, body_index: int) -> bool:
    current = body_index
    while current > 0:
        name = (model.body_id2name(current) or "").lower()
        if "robot" in name or "gripper" in name or "panda" in name:
            return False
        if int(model.body_jntnum[current]) > 0:
            return False
        current = int(model.body_parentid[current])
    return True


def _static_surface_mask(model: Any, segmentation: np.ndarray) -> np.ndarray:
    import mujoco  # noqa: PLC0415

    if segmentation.shape != (REFERENCE_SIZE, REFERENCE_SIZE, 2):
        raise RuntimeError(f"unexpected segmentation shape: {segmentation.shape}")
    mask = np.zeros(segmentation.shape[:2], dtype=bool)
    geom_type = int(mujoco.mjtObj.mjOBJ_GEOM)
    object_types = segmentation[:, :, 0]
    object_ids = segmentation[:, :, 1]
    for geom_id in np.unique(object_ids[object_types == geom_type]):
        if geom_id < 0 or geom_id >= int(model.ngeom):
            continue
        body = int(model.geom_bodyid[int(geom_id)])
        if _body_is_static(model, body):
            mask |= (object_types == geom_type) & (object_ids == geom_id)
    coverage = float(mask.mean())
    if coverage < 0.45:
        raise RuntimeError(f"static reference mask is too small: {coverage:.3f}")
    return mask


def capture_candidate(
    source_repo: Path, candidate: Candidate
) -> tuple[Any, np.ndarray, np.ndarray]:
    _install_source(source_repo)
    import torch  # noqa: PLC0415
    from libero.libero.envs.env_wrapper import ControlEnv  # noqa: PLC0415
    from pipeline.evaluation_scene_export import (  # noqa: PLC0415
        extract_evaluation_scene_components,
        validate_evaluation_snapshot,
    )
    from robosuite.utils.errors import RandomizationError  # noqa: PLC0415

    random.seed(ENVIRONMENT_SEED)
    np.random.seed(ENVIRONMENT_SEED)
    torch.manual_seed(ENVIRONMENT_SEED)
    env = None
    for attempt in range(1, CONSTRUCTOR_ATTEMPT_LIMIT + 1):
        try:
            env = ControlEnv(
                bddl_file_name=str(candidate.runtime_bddl),
                use_camera_obs=True,
                has_renderer=False,
                has_offscreen_renderer=True,
                camera_names=["agentview", "robot0_eye_in_hand"],
                camera_heights=REFERENCE_SIZE,
                camera_widths=REFERENCE_SIZE,
            )
        except RandomizationError:
            if attempt == CONSTRUCTOR_ATTEMPT_LIMIT:
                raise
        else:
            break
    if env is None:
        raise RuntimeError("ControlEnv constructor did not produce an environment")
    try:
        env.seed(ENVIRONMENT_SEED)
        env.reset()
        observation = env.set_init_state(
            load_initial_state(candidate.init_state, object_layout=False)
        )
        for _ in range(5):
            observation, *_ = env.step([0.0] * 7)
        image = np.asarray(observation["agentview_image"], dtype=np.uint8)
        segmentation = np.asarray(
            env.sim.render(
                width=REFERENCE_SIZE,
                height=REFERENCE_SIZE,
                camera_name="agentview",
                segmentation=True,
            ),
            dtype=np.int32,
        )
        if image.shape != (REFERENCE_SIZE, REFERENCE_SIZE, 3):
            raise RuntimeError(f"unexpected candidate reference image: {image.shape}")
        components = extract_evaluation_scene_components(env.sim.model, env.sim.data)
        validate_evaluation_snapshot(components.snapshot)
        return components, image, _static_surface_mask(env.sim.model, segmentation)
    finally:
        env.close()


def write_reference_bank(path: Path, images: np.ndarray, masks: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("wb") as stream:
        np.savez_compressed(stream, images=images, masks=masks)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def export_task(job: tuple[str, str, BaseTask]) -> dict[str, Any]:
    source_repo = Path(job[0])
    output = Path(job[1])
    base = job[2]
    task_hash = hashlib.sha256(base.task_key.encode()).hexdigest()[:20]
    shard = output / f"candidates/{task_hash}.json.gz"
    geometry_pack = output / f"geometry/{task_hash}.glb"
    reference_bank = output / f"references/{task_hash}.npz"
    receipt = output / f"receipts/{task_hash}.json"
    if any(
        path.is_symlink() for path in (shard, geometry_pack, reference_bank, receipt)
    ):
        raise RuntimeError(f"candidate task artifact is a symlink: {base.task_key}")
    candidates = candidate_rows(source_repo, base)
    if receipt.is_file():
        value = json.loads(receipt.read_text())
        for path_key, hash_key in (
            ("candidate_shard", "candidate_shard_sha256"),
            ("geometry_pack", "geometry_sha256"),
            ("reference_bank", "reference_sha256"),
        ):
            path = output / value[path_key]
            if not path.is_file() or sha256(path) != value[hash_key]:
                raise RuntimeError(
                    f"candidate receipt is inconsistent: {base.task_key}"
                )
        with gzip.open(shard, "rt", encoding="utf-8") as stream:
            existing_shard = json.load(stream)
        expected_keys = {
            f"{candidate.category}:{candidate.variant}" for candidate in candidates
        }
        if (
            value.get("candidate_count") != len(candidates)
            or existing_shard.get("task_key") != base.task_key
            or set(existing_shard.get("records", {})) != expected_keys
        ):
            raise RuntimeError(
                f"candidate receipt does not match the official BDDL set: {base.task_key}"
            )
        print(f"[{base.task_key}] reused 100 candidates", flush=True)
        return value

    from pipeline.evaluation_scene_export import write_evaluation_geometry_pack  # noqa: PLC0415

    geometries: dict[str, Any] = {}
    records: dict[str, Any] = {}
    images: list[np.ndarray] = []
    masks: list[np.ndarray] = []
    plus_root = source_repo / "LIBERO-plus/libero/libero"
    for index, candidate in enumerate(candidates, start=1):
        components, image, mask = capture_candidate(source_repo, candidate)
        geometries.update(components.geometries)
        for key, payload in components.textures.items():
            copy_texture(output, key, payload)
        candidate_key = f"{candidate.category}:{candidate.variant}"
        records[candidate_key] = {
            "candidate_key": candidate_key,
            "base_task_key": base.task_key,
            "category": candidate.category,
            "variant": candidate.variant,
            "name": candidate.name,
            "runtime_bddl": str(candidate.runtime_bddl.relative_to(plus_root)),
            "resolved_bddl": str(candidate.resolved_bddl.relative_to(plus_root)),
            "resolved_bddl_sha256": sha256(candidate.resolved_bddl),
            "snapshot": components.snapshot,
            "reference_index": index - 1,
        }
        images.append(image)
        masks.append(mask)
        if index % 10 == 0:
            print(f"[{base.task_key}] {index}/100 appearance candidates", flush=True)
    write_evaluation_geometry_pack(geometry_pack, geometries)
    write_reference_bank(
        reference_bank,
        np.stack(images).astype(np.uint8),
        np.stack(masks).astype(bool),
    )
    write_gzip_json(
        shard,
        {
            "schema_version": SHARD_SCHEMA,
            "task_key": base.task_key,
            "geometry_pack": f"geometry/{task_hash}.glb",
            "records": records,
        },
    )
    value = {
        "task_key": base.task_key,
        "suite": base.suite,
        "name": base.name,
        "candidate_count": len(records),
        "candidate_shard": str(shard.relative_to(output)),
        "candidate_shard_bytes": shard.stat().st_size,
        "candidate_shard_sha256": sha256(shard),
        "geometry_pack": str(geometry_pack.relative_to(output)),
        "geometry_bytes": geometry_pack.stat().st_size,
        "geometry_sha256": sha256(geometry_pack),
        "geometry_count": len(geometries),
        "reference_bank": str(reference_bank.relative_to(output)),
        "reference_bytes": reference_bank.stat().st_size,
        "reference_sha256": sha256(reference_bank),
    }
    write_json(receipt, value)
    return value


def main() -> None:
    args = parse_args()
    source_repo = args.source_repo.resolve(strict=True)
    hosted_root = args.hosted_root.resolve(strict=True)
    output = ensure_output(args.output, probe=args.probe_task is not None)
    source = validate_source(source_repo, hosted_root)
    bases = load_base_tasks(hosted_root)
    if args.probe_task:
        bases = [item for item in bases if item.task_key == args.probe_task]
        if len(bases) != 1:
            raise RuntimeError(f"unknown probe task: {args.probe_task}")
    jobs = [(str(source_repo), str(output), base) for base in bases]
    # MuJoCo / OpenGL contexts retain several gigabytes of process-local caches
    # after 100 environment constructions.  One task per child keeps the full
    # 40-task export bounded instead of letting those caches accumulate.
    with get_context("spawn").Pool(
        processes=min(args.workers, len(jobs)), maxtasksperchild=1
    ) as pool:
        receipts = pool.map(export_task, jobs)
    receipts.sort(key=lambda item: item["task_key"])
    if not args.probe_task and (
        len(receipts) != EXPECTED_TASKS
        or sum(item["candidate_count"] for item in receipts) != EXPECTED_TASKS * 100
    ):
        raise RuntimeError("appearance candidate export is incomplete")
    texture_files = sorted((output / "textures").rglob("*.png"))
    for path in texture_files:
        if path.stem != sha256(path):
            raise RuntimeError(f"content-addressed candidate texture mismatch: {path}")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "status": "probe" if args.probe_task else "complete",
        "source": {
            "repository": "sylvestf/LIBERO-plus",
            "revision": LIBERO_PLUS_REVISION,
            **source,
        },
        "initialization": {
            "state_index": 0,
            "settle_zero_actions": 5,
            "environment_seed": ENVIRONMENT_SEED,
            "constructor_randomization_policy": CONSTRUCTOR_RANDOMIZATION_POLICY,
            "constructor_attempt_limit": CONSTRUCTOR_ATTEMPT_LIMIT,
            "reference_size": REFERENCE_SIZE,
        },
        "counts": {
            "source_tasks": len(receipts),
            "candidates": sum(item["candidate_count"] for item in receipts),
            "background_candidates": len(receipts) * 50,
            "light_candidates": len(receipts) * 50,
            "geometry_assets": sum(item["geometry_count"] for item in receipts),
            "texture_assets": len(texture_files),
        },
        "tasks": {item["task_key"]: item for item in receipts},
    }
    write_json(output / "manifest.json", manifest)
    print(json.dumps({"output": str(output), "counts": manifest["counts"]}, indent=2))


if __name__ == "__main__":
    main()
