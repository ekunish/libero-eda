#!/usr/bin/env python3
"""Export all official LIBERO-Plus evaluation initial states for the browser.

The exporter uses condition state index 0 and follows the official
``render_single_task.py`` settling procedure: reset, install the state, then
apply five zero actions.  It emits one reusable geometry pack per Original
LIBERO source task, content-addressed PNG textures, and a gzip JSON shard with
the exact settled descriptor for every related evaluation condition.

No screenshot, video, successful trajectory, or inferred object pose is
generated.  Missing source files and partially generated outputs are fatal.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import random
import re
import subprocess
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch

SCHEMA_VERSION = "libero-evaluation-scenes/v1"
OWNER = {
    "schema_version": SCHEMA_VERSION,
    "owner": "libero-eda-evaluation-scene-exporter",
}
LIBERO_PLUS_REVISION = "4976dc30028e805ff8094b55501d532c48fec182"
LIBERO_PLUS_ASSETS_REVISION = "dd2bd61b7d9a6fef1abc52d606e983b41886a149"
LIBERO_PLUS_ASSETS_ARCHIVE_SHA256 = (
    "96764a4bfbdaea98d4411598caeab235458318fe0f549611b93d1a323027b3cf"
)
LIBERO_PLUS_ASSETS_ARCHIVE_BYTES = 6_395_849_578
LIBERO_PLUS_ASSETS_FILE_COUNT = 448_799
LIBERO_PLUS_ASSETS_TREE_HASH_SCHEMA = "libero-plus-asset-tree-sha256/v1"
LIBERO_PLUS_ASSETS_TREE_SHA256 = (
    "6c4c2e638f6401304f01b2573c80af41b35b6d94838df71f6ab91f59468b7ecb"
)
EXPECTED_CONDITIONS = 10_030
EXPECTED_BASE_TASKS = 40
ENVIRONMENT_SEED = 10_000
CONSTRUCTOR_ATTEMPT_LIMIT = 100
CONSTRUCTOR_RANDOMIZATION_POLICY = "retry_without_reseeding"
EXPECTED_CATEGORIES = {
    "Background Textures": 1_076,
    "Camera Viewpoints": 1_599,
    "Language Instructions": 1_537,
    "Light Conditions": 1_142,
    "Objects Layout": 1_525,
    "Robot Initial States": 1_550,
    "Sensor Noise": 1_601,
}
SOURCE_FILE_VARIANTS = {
    "libero/libero/benchmark/__init__.py": {
        "upstream": "70ed74d8a05cdc0808d0347536781e4a0e3d8fec45437f06e7b570f84b94e4e9",
        "pytorch_weights_only_compatibility": "ecabf4b7baf39d0c973d494bbd15e20cc981aa851981e66855117701b734fb41",
    },
    "libero/libero/envs/env_wrapper.py": {
        "upstream": "e91d7b7b35cc3ad2b073606c99860def6b3ac43b66eba00ef0ddb6bfd8f39c3c",
        "numpy_float64_compatibility": "3084614bc4b1a5a6bf83773ceaae0a6d87b8e89fed304334b483ca1313efed57",
    },
}


@dataclass(frozen=True)
class BaseTask:
    task_key: str
    suite: str
    name: str
    instruction: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-repo", type=Path, required=True)
    parser.add_argument("--hosted-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--workers", type=int, default=max(1, min(8, os.cpu_count() or 1))
    )
    parser.add_argument(
        "--probe-task",
        help="Export one source task into a non-publishable probe result.",
    )
    parser.add_argument(
        "--probe-limit",
        type=int,
        help="Limit a probe to the first N official conditions; never valid for a full export.",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def simulator_asset_tree_sha256(root: Path) -> tuple[int, str]:
    files: list[tuple[str, Path]] = []
    for path in root.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(
                f"LIBERO-Plus simulator assets contain a symlink: {path}"
            )
        if path.is_file():
            files.append((path.relative_to(root).as_posix(), path))
    tree = hashlib.sha256()
    for index, (relative, path) in enumerate(sorted(files), start=1):
        size = path.stat().st_size
        tree.update(relative.encode())
        tree.update(b"\0")
        tree.update(str(size).encode())
        tree.update(b"\0")
        tree.update(bytes.fromhex(sha256(path)))
        tree.update(b"\n")
        if index % 50_000 == 0:
            print(f"[assets] verified {index}/{len(files)} files", flush=True)
    return len(files), tree.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(
            value, stream, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def write_gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("wb") as raw:
        with gzip.GzipFile(
            filename="", fileobj=raw, mode="wb", compresslevel=9, mtime=0
        ) as stream:
            stream.write(
                json.dumps(
                    value,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            )
        raw.flush()
        os.fsync(raw.fileno())
    temporary.replace(path)


def ensure_owned_output(path: Path, *, probe: bool) -> Path:
    result = path.resolve()
    marker = result / ".libero-evaluation-scenes.json"
    if result.exists():
        if (
            marker.is_symlink()
            or not marker.is_file()
            or json.loads(marker.read_text()) != OWNER
        ):
            raise RuntimeError(f"Output is not owned by this exporter: {result}")
    else:
        result.mkdir(parents=True)
        write_json(marker, OWNER)
    manifest = result / "manifest.json"
    if manifest.exists() and not probe:
        raise RuntimeError(
            f"Completed evaluation scene export already exists: {manifest}"
        )
    return result


def validate_source(source_repo: Path, hosted_root: Path) -> dict[str, Any]:
    plus = source_repo / "LIBERO-plus"
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=plus,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    if head != LIBERO_PLUS_REVISION:
        raise RuntimeError(f"LIBERO-Plus revision mismatch: {head}")
    guarded = subprocess.run(
        [
            "git",
            "status",
            "--porcelain",
            "--untracked-files=no",
            "--",
            "libero/libero/assets",
            "libero/libero/bddl_files",
            "libero/libero/init_files",
            "libero/libero/benchmark/task_classification.json",
            "benchmark_scripts/render_single_task.py",
        ],
        cwd=plus,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    if guarded:
        raise RuntimeError(f"Guarded LIBERO-Plus source paths are modified: {guarded}")
    assets_root = plus / "libero/libero/assets"
    asset_metadata = (
        source_repo / ".parc/downloads/.cache/huggingface/download/assets.zip.metadata"
    )
    if assets_root.is_symlink() or not assets_root.is_dir():
        raise RuntimeError(
            "LIBERO-Plus simulator asset root is missing or is a symlink"
        )
    if asset_metadata.is_symlink() or not asset_metadata.is_file():
        raise RuntimeError(
            "LIBERO-Plus simulator asset download metadata is missing or is a symlink"
        )
    metadata_lines = asset_metadata.read_text(encoding="utf-8").splitlines()
    if metadata_lines[:2] != [
        LIBERO_PLUS_ASSETS_REVISION,
        LIBERO_PLUS_ASSETS_ARCHIVE_SHA256,
    ]:
        raise RuntimeError("LIBERO-Plus simulator asset snapshot mismatch")
    asset_file_count, asset_tree_sha256 = simulator_asset_tree_sha256(assets_root)
    if (
        asset_file_count != LIBERO_PLUS_ASSETS_FILE_COUNT
        or asset_tree_sha256 != LIBERO_PLUS_ASSETS_TREE_SHA256
    ):
        raise RuntimeError(
            "LIBERO-Plus simulator asset tree mismatch: "
            f"files={asset_file_count}, sha256={asset_tree_sha256}"
        )
    source_files: dict[str, Any] = {}
    for relative, variants in SOURCE_FILE_VARIANTS.items():
        digest = sha256(plus / relative)
        matched = next(
            (name for name, value in variants.items() if value == digest), None
        )
        if matched is None:
            raise RuntimeError(
                f"Unsupported LIBERO-Plus source file: {relative}: {digest}"
            )
        source_files[relative] = {"variant": matched, "sha256": digest}
    hosted_manifest = json.loads((hosted_root / "manifest.json").read_text())
    if (
        hosted_manifest.get("schema_version")
        not in {
            "libero-eda-hosted/v1",
            "libero-eda-hosted/v2",
            "libero-eda-hosted/v3",
            "libero-eda-hosted/v4",
        }
        or hosted_manifest.get("counts", {}).get("evaluation_conditions")
        != EXPECTED_CONDITIONS
        or hosted_manifest.get("evaluation", {}).get("revision") != LIBERO_PLUS_REVISION
    ):
        raise RuntimeError("Hosted v1 source manifest is incompatible")
    return {
        "runtime_source_files": source_files,
        "simulator_assets": {
            "repository": "Sylvest/LIBERO-plus",
            "revision": LIBERO_PLUS_ASSETS_REVISION,
            "archive_sha256": LIBERO_PLUS_ASSETS_ARCHIVE_SHA256,
            "archive_bytes": LIBERO_PLUS_ASSETS_ARCHIVE_BYTES,
            "extracted_file_count": LIBERO_PLUS_ASSETS_FILE_COUNT,
            "tree_hash_schema": LIBERO_PLUS_ASSETS_TREE_HASH_SCHEMA,
            "tree_sha256": LIBERO_PLUS_ASSETS_TREE_SHA256,
        },
    }


def load_base_tasks(hosted_root: Path) -> list[BaseTask]:
    catalog = json.loads((hosted_root / "catalog/tasks.json").read_text())
    result = [
        BaseTask(
            task_key=item["task_key"],
            suite=item["suite"],
            name=item["name"],
            instruction=item["instruction"],
        )
        for item in catalog["families"]
        if item["is_plus_source"]
    ]
    if len(result) != EXPECTED_BASE_TASKS:
        raise RuntimeError(f"Expected 40 LIBERO-Plus source tasks, found {len(result)}")
    return result


def map_conditions(
    source_repo: Path, bases: list[BaseTask]
) -> dict[str, list[dict[str, Any]]]:
    plus_root = source_repo / "LIBERO-plus/libero/libero"
    raw = json.loads((plus_root / "benchmark/task_classification.json").read_text())
    ordered = sorted(bases, key=lambda item: len(item.name), reverse=True)
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    categories: Counter[str] = Counter()
    ids: set[tuple[str, int]] = set()
    for suite, entries in raw.items():
        for entry in entries:
            identity = (suite, int(entry["id"]))
            if identity in ids:
                raise RuntimeError(f"Duplicate evaluation condition id: {identity}")
            ids.add(identity)
            base = next(
                (
                    item
                    for item in ordered
                    if item.suite == suite and entry["name"].startswith(item.name)
                ),
                None,
            )
            if base is None:
                raise RuntimeError(
                    f"Evaluation condition has no source task: {suite}/{entry['name']}"
                )
            row = {
                "task_key": f"plus:{suite}:{entry['id']}",
                "suite": suite,
                "suite_id": int(entry["id"]),
                "name": entry["name"],
                "category": entry["category"],
                "difficulty": entry["difficulty_level"],
                "base_task_key": base.task_key,
            }
            categories[row["category"]] += 1
            result[base.task_key].append(row)
    if len(ids) != EXPECTED_CONDITIONS or dict(categories) != EXPECTED_CATEGORIES:
        raise RuntimeError(
            f"Official classification mismatch: total={len(ids)}, categories={dict(categories)}"
        )
    if set(result) != {item.task_key for item in bases}:
        raise RuntimeError("Not every source task has evaluation conditions")
    for rows in result.values():
        rows.sort(key=lambda item: item["suite_id"])
    return result


def bddl_paths(plus_root: Path, suite: str, name: str) -> tuple[Path, Path]:
    """Return the official ControlEnv dispatch path and the BDDL it resolves.

    View/init/noise conditions deliberately pass a synthetic filename to
    ``ControlEnv``. Its official constructor parses the suffix and opens the
    pre-``_view_`` BDDL; requiring the dispatch path itself to exist would
    reject valid benchmark entries.
    """
    runtime = plus_root / "bddl_files" / suite / f"{name}.bddl"
    base_name = name.split("_view_")[0]
    base = plus_root / "bddl_files" / suite / f"{base_name}.bddl"
    if not base.is_file():
        raise RuntimeError(f"Resolved BDDL is missing: {base}")
    if "_view_" not in name and runtime != base:
        raise RuntimeError(f"Unexpected BDDL dispatch mapping: {name}")
    return runtime, base


def init_path(plus_root: Path, suite: str, name: str) -> Path:
    root = plus_root / "init_files"
    if "_language_" in name:
        result = root / suite / f"{name.split('_language_')[0]}.pruned_init"
    elif "_view_" in name:
        result = root / suite / f"{name.split('_view_')[0]}.pruned_init"
    elif "_add_" in name or "_level" in name:
        result = root / "libero_newobj" / suite / f"{name}.pruned_init"
    elif "_light_" in name:
        result = root / suite / f"{name.split('_light_')[0]}.pruned_init"
    elif "_tb_" in name:
        base_name = re.sub(r"_tb_\d+", "", name)
        result = root / suite / f"{base_name}.pruned_init"
    elif "_table_" in name:
        base_name = re.sub(r"_table_\d+", "", name)
        result = root / suite / f"{base_name}.pruned_init"
    else:
        result = root / suite / f"{name}.pruned_init"
    if not result.is_file():
        raise RuntimeError(f"Resolved init state is missing: {result}")
    return result


def load_initial_state(path: Path, *, object_layout: bool) -> np.ndarray:
    value = torch.load(path, map_location="cpu", weights_only=False)
    array = (
        value.detach().cpu().numpy()
        if isinstance(value, torch.Tensor)
        else np.asarray(value)
    )
    if object_layout and array.ndim == 1:
        array = array.reshape(1, -1)
    if array.ndim != 2 or array.shape[0] < 1 or not np.isfinite(array).all():
        raise RuntimeError(f"Invalid official init-state tensor: {path}: {array.shape}")
    return np.asarray(array[0], dtype=np.float64)


def condition_settings(row: dict[str, Any]) -> dict[str, Any]:
    name = row["name"]
    settings: dict[str, Any] = {"category": row["category"]}
    view = re.search(
        r"_view_(-?\d+)_(-?\d+)_(-?\d+)_(-?\d+)_(-?\d+)_initstate_(\d+)(?:_noise_(\d+))?$",
        name,
    )
    if view:
        settings.update(
            {
                "horizontal_view_degrees": int(view.group(1)),
                "vertical_view_degrees": int(view.group(2)),
                "distance_scale": int(view.group(3)) / 100,
                "endpoint_rotation_degrees": int(view.group(4)),
                "endpoint_vertical_degrees": int(view.group(5)),
                "robot_initial_variant": int(view.group(6)),
                "sensor_noise_variant": int(view.group(7) or 0),
            }
        )
    suffix = next(
        (
            match.group(0).lstrip("_")
            for pattern in (
                r"_table_\d+$",
                r"_tb_\d+$",
                r"_light_\d+$",
                r"_add_\d+$",
                r"_level\d+_sample\d+$",
                r"_language_\d+(?:_view_.*)?$",
            )
            if (match := re.search(pattern, name))
        ),
        None,
    )
    if suffix:
        settings["definition_variant"] = suffix
    return settings


def validate_condition_sources(
    source_repo: Path,
    bases: list[BaseTask],
    conditions: dict[str, list[dict[str, Any]]],
) -> None:
    """Resolve every official condition before starting the expensive export."""
    plus_root = source_repo / "LIBERO-plus/libero/libero"
    checked = 0
    for base in bases:
        canonical_bddl = plus_root / "bddl_files" / base.suite / f"{base.name}.bddl"
        canonical_init = init_path(plus_root, base.suite, base.name)
        canonical_definition = re.sub(
            r"\(:language\s+[^\r\n)]+\)",
            "(:language <instruction>)",
            canonical_bddl.read_text(),
        )
        for row in conditions[base.task_key]:
            runtime, resolved = bddl_paths(plus_root, row["suite"], row["name"])
            init = init_path(plus_root, row["suite"], row["name"])
            if "_view_" not in row["name"] and not runtime.is_file():
                raise RuntimeError(f"Official runtime BDDL is missing: {runtime}")
            if not resolved.is_file() or not init.is_file():
                raise RuntimeError(
                    f"Incomplete official condition source: {row['task_key']}"
                )
            settings = condition_settings(row)
            if settings == {"category": row["category"]}:
                raise RuntimeError(
                    f"Condition settings could not be decoded: {row['task_key']}"
                )
            if row["category"] in {"Language Instructions", "Sensor Noise"}:
                expected = {
                    "horizontal_view_degrees": 0,
                    "vertical_view_degrees": 0,
                    "distance_scale": 1.0,
                    "endpoint_rotation_degrees": 0,
                    "endpoint_vertical_degrees": 0,
                    "robot_initial_variant": 0,
                }
                if init != canonical_init or any(
                    settings.get(key) != value for key, value in expected.items()
                ):
                    raise RuntimeError(
                        f"Reusable physical condition is not canonical: {row['task_key']}"
                    )
                if row["category"] == "Language Instructions":
                    normalized = re.sub(
                        r"\(:language\s+[^\r\n)]+\)",
                        "(:language <instruction>)",
                        resolved.read_text(),
                    )
                    if (
                        normalized != canonical_definition
                        or settings.get("sensor_noise_variant") != 0
                    ):
                        raise RuntimeError(
                            f"Language condition changes physical state: {row['task_key']}"
                        )
                elif (
                    resolved != canonical_bddl
                    or not isinstance(settings.get("sensor_noise_variant"), int)
                    or int(settings["sensor_noise_variant"]) <= 0
                ):
                    raise RuntimeError(
                        f"Sensor-noise condition changes physical state: {row['task_key']}"
                    )
            checked += 1
    if checked != EXPECTED_CONDITIONS:
        raise RuntimeError(f"Condition source preflight is incomplete: {checked}")


def _install_source(source_repo: Path) -> None:
    plus_python = str(source_repo / "LIBERO-plus")
    root = str(source_repo)
    for entry in (plus_python, root):
        if entry not in sys.path:
            sys.path.insert(0, entry)
    os.environ["LIBERO_CONFIG_PATH"] = str(source_repo / ".parc/libero-eval")
    os.environ.setdefault("MUJOCO_GL", "osmesa")


def settled_components(
    source_repo: Path,
    runtime_bddl: Path,
    init_state: np.ndarray,
) -> Any:
    _install_source(source_repo)
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
                bddl_file_name=str(runtime_bddl),
                use_camera_obs=False,
                has_renderer=False,
                has_offscreen_renderer=False,
                camera_names=["agentview", "robot0_eye_in_hand"],
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
        env.set_init_state(init_state)
        for _ in range(5):
            env.step([0.0] * 7)
        result = extract_evaluation_scene_components(env.sim.model, env.sim.data)
        validate_evaluation_snapshot(result.snapshot)
        return result
    finally:
        env.close()


def copy_texture(output: Path, key: str, payload: bytes) -> None:
    if hashlib.sha256(payload).hexdigest() != key:
        raise RuntimeError(f"Texture hash mismatch: {key}")
    target = output / f"textures/{key[:2]}/{key}.png"
    if target.is_symlink():
        raise RuntimeError(f"Existing texture is a symlink: {target}")
    if target.exists():
        if target.stat().st_size != len(payload) or sha256(target) != key:
            raise RuntimeError(f"Existing texture differs: {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    with temporary.open("xb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        temporary.replace(target)
    except FileExistsError:
        temporary.unlink(missing_ok=True)
        if target.stat().st_size != len(payload) or sha256(target) != key:
            raise RuntimeError(f"Concurrent texture differs: {target}")


def export_base_task(
    job: tuple[str, str, BaseTask, list[dict[str, Any]]],
) -> dict[str, Any]:
    source_raw, output_raw, base, conditions = job
    source_repo = Path(source_raw)
    output = Path(output_raw)
    plus_root = source_repo / "LIBERO-plus/libero/libero"
    shard_key = hashlib.sha256(base.task_key.encode()).hexdigest()[:20]
    shard = output / f"conditions/{shard_key}.json.gz"
    pack = output / f"geometry/{shard_key}.glb"
    receipt = output / f"receipts/{shard_key}.json"
    if receipt.is_symlink() or shard.is_symlink() or pack.is_symlink():
        raise RuntimeError(
            f"Completed task artifacts contain a symlink: {base.task_key}"
        )
    if receipt.is_file():
        value = json.loads(receipt.read_text())
        if (
            value.get("task_key") != base.task_key
            or value.get("condition_count") != len(conditions)
            or not shard.is_file()
            or not pack.is_file()
            or value.get("shard_sha256") != sha256(shard)
            or value.get("geometry_sha256") != sha256(pack)
        ):
            raise RuntimeError(
                f"Completed task receipt is inconsistent: {base.task_key}"
            )
        print(
            f"[{base.task_key}] reused {value['condition_count']} validated conditions",
            flush=True,
        )
        return value

    from pipeline.evaluation_scene_export import write_evaluation_geometry_pack

    geometries: dict[str, Any] = {}
    records: dict[str, Any] = {}
    canonical_runtime, canonical_bddl = bddl_paths(plus_root, base.suite, base.name)
    canonical_init = init_path(plus_root, base.suite, base.name)
    canonical_physical_key = hashlib.sha256(
        json.dumps(
            {
                "runtime": str(canonical_runtime.relative_to(plus_root)),
                "bddl_sha256": sha256(canonical_bddl),
                "init_sha256": sha256(canonical_init),
                "environment_seed": ENVIRONMENT_SEED,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    canonical = settled_components(
        source_repo,
        canonical_runtime,
        load_initial_state(canonical_init, object_layout=False),
    )
    geometries.update(canonical.geometries)
    for key, payload in canonical.textures.items():
        copy_texture(output, key, payload)

    for position, row in enumerate(conditions, start=1):
        runtime_bddl, resolved_bddl = bddl_paths(plus_root, row["suite"], row["name"])
        init = init_path(plus_root, row["suite"], row["name"])
        if row["category"] in {"Language Instructions", "Sensor Noise"}:
            components = canonical
            physical_key = canonical_physical_key
        else:
            physical_key = hashlib.sha256(
                json.dumps(
                    {
                        "runtime": str(runtime_bddl.relative_to(plus_root)),
                        "bddl_sha256": sha256(resolved_bddl),
                        "init_sha256": sha256(init),
                        "environment_seed": ENVIRONMENT_SEED,
                    },
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            try:
                components = settled_components(
                    source_repo,
                    runtime_bddl,
                    load_initial_state(
                        init,
                        object_layout=row["category"] == "Objects Layout",
                    ),
                )
            except Exception as exc:
                raise RuntimeError(
                    f"Failed evaluation scene {position}/{len(conditions)} "
                    f"for {base.task_key}: {row['task_key']} ({row['name']})"
                ) from exc
        geometries.update(components.geometries)
        for key, payload in components.textures.items():
            copy_texture(output, key, payload)
        records[row["task_key"]] = {
            "condition": row,
            "settings": condition_settings(row),
            "initialization": {
                "state_index": 0,
                "settle_zero_actions": 5,
                "environment_seed": ENVIRONMENT_SEED,
                "control_action": [0.0] * 7,
                "runtime_bddl": str(runtime_bddl.relative_to(plus_root)),
                "resolved_bddl": str(resolved_bddl.relative_to(plus_root)),
                "resolved_bddl_sha256": sha256(resolved_bddl),
                "init_state": str(init.relative_to(plus_root)),
                "init_state_sha256": sha256(init),
                "physical_state_key": physical_key,
            },
            "snapshot": components.snapshot,
        }
        if position % 50 == 0:
            print(
                f"[{base.task_key}] {position}/{len(conditions)} conditions",
                flush=True,
            )

    write_evaluation_geometry_pack(pack, geometries)
    write_gzip_json(
        shard,
        {
            "schema_version": "libero-evaluation-scene-shard/v1",
            "task_key": base.task_key,
            "geometry_pack": f"geometry/{shard_key}.glb",
            "records": records,
        },
    )
    value = {
        "task_key": base.task_key,
        "suite": base.suite,
        "name": base.name,
        "condition_count": len(conditions),
        "condition_shard": f"conditions/{shard_key}.json.gz",
        "condition_shard_bytes": shard.stat().st_size,
        "shard_sha256": sha256(shard),
        "geometry_pack": f"geometry/{shard_key}.glb",
        "geometry_bytes": pack.stat().st_size,
        "geometry_sha256": sha256(pack),
        "geometry_count": len(geometries),
    }
    write_json(receipt, value)
    return value


def build_manifest(
    output: Path,
    receipts: list[dict[str, Any]],
    *,
    probe: bool,
    source_files: dict[str, Any],
) -> None:
    receipts.sort(key=lambda item: item["task_key"])
    condition_count = sum(item["condition_count"] for item in receipts)
    if not probe and (
        len(receipts) != EXPECTED_BASE_TASKS or condition_count != EXPECTED_CONDITIONS
    ):
        raise RuntimeError(
            f"Incomplete evaluation scene export: tasks={len(receipts)}, conditions={condition_count}"
        )
    texture_files = sorted((output / "textures").rglob("*.png"))
    for path in texture_files:
        if path.stem != sha256(path):
            raise RuntimeError(f"Texture filename/hash mismatch: {path}")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "status": "probe" if probe else "complete",
        "source": {
            "repository": "sylvestf/LIBERO-plus",
            "revision": LIBERO_PLUS_REVISION,
            **source_files,
        },
        "initialization": {
            "state_index": 0,
            "settle_zero_actions": 5,
            "environment_seed": ENVIRONMENT_SEED,
            "constructor_randomization_policy": CONSTRUCTOR_RANDOMIZATION_POLICY,
            "constructor_attempt_limit": CONSTRUCTOR_ATTEMPT_LIMIT,
            "action_dimension": 7,
            "source_procedure": "LIBERO-plus/benchmark_scripts/render_single_task.py",
        },
        "counts": {
            "source_tasks": len(receipts),
            "conditions": condition_count,
            "geometry_assets": sum(item["geometry_count"] for item in receipts),
            "texture_assets": len(texture_files),
        },
        "tasks": {item["task_key"]: item for item in receipts},
    }
    write_json(output / "manifest.json", manifest)


def main() -> None:
    args = parse_args()
    source_repo = args.source_repo.resolve(strict=True)
    hosted_root = args.hosted_root.resolve(strict=True)
    probe = args.probe_task is not None
    if args.probe_limit is not None and (not probe or args.probe_limit < 1):
        raise RuntimeError("--probe-limit requires --probe-task and a positive value")
    output = ensure_owned_output(args.output, probe=probe)
    source_files = validate_source(source_repo, hosted_root)
    _install_source(source_repo)
    bases = load_base_tasks(hosted_root)
    conditions = map_conditions(source_repo, bases)
    validate_condition_sources(source_repo, bases, conditions)
    if args.probe_task:
        bases = [
            item
            for item in bases
            if item.task_key == args.probe_task or item.name == args.probe_task
        ]
        if len(bases) != 1:
            raise RuntimeError(f"Probe source task is not unique: {args.probe_task}")
        if args.probe_limit is not None:
            conditions[bases[0].task_key] = conditions[bases[0].task_key][
                : args.probe_limit
            ]
    jobs = [
        (str(source_repo), str(output), base, conditions[base.task_key])
        for base in bases
    ]
    if args.workers == 1:
        receipts = [export_base_task(job) for job in jobs]
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            receipts = list(pool.map(export_base_task, jobs))
    build_manifest(output, receipts, probe=probe, source_files=source_files)
    print(
        json.dumps(
            {
                "output": str(output),
                "status": "probe" if probe else "complete",
                "tasks": len(receipts),
                "conditions": sum(item["condition_count"] for item in receipts),
                "bytes": sum(
                    path.stat().st_size for path in output.rglob("*") if path.is_file()
                ),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
