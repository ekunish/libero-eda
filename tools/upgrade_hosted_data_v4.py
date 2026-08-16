#!/usr/bin/env python3
"""Attach validated training-video appearance matches to hosted v3.

The exact background / light condition ID is absent from the published
training metadata.  This migration publishes only finite official candidates
and accepts a candidate only when the offline matcher already passed every
configured gate.  An unmatched episode is kept explicitly unmatched; there is
no visual fallback.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from validate_hosted_data import load_json, reject_symlinks
from training_appearance_candidates import (
    OFFICIAL_FIXED_CANDIDATE_ONLY_BODIES,
    compatible_motion_body_sets,
)

SCHEMA_VERSION = "libero-eda-hosted/v4"
SOURCE_SCHEMA = "libero-eda-hosted/v3"
PROXY_SOURCE_SCHEMA = "libero-plus-training-scene-proxy/v1"
PROXY_SCHEMA = "libero-plus-training-scene-proxy/v2"
CANDIDATE_SCHEMA = "libero-plus-training-appearance-candidates/v1"
CANDIDATE_SHARD_SCHEMA = "libero-plus-training-appearance-candidate-shard/v1"
MATCH_SCHEMA = "libero-plus-training-appearance-matches/v1"
MATCH_RECORD_SCHEMA = "libero-plus-training-appearance-match/v1"
EXPECTED_EPISODES = 14_347
EXPECTED_TASKS = 40
EXPECTED_CANDIDATES = 4_000
OWNER = {"schema_version": SCHEMA_VERSION, "owner": "libero-eda-v4-upgrader"}
SHA256_CHARS = set("0123456789abcdef")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-v3", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--matches", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= SHA256_CHARS


def confined(relative: Any) -> str:
    if (
        not isinstance(relative, str)
        or not relative
        or Path(relative).is_absolute()
        or ".." in Path(relative).parts
    ):
        raise RuntimeError(f"invalid artifact path: {relative!r}")
    return relative


def write_json(path: Path, value: Any) -> None:
    payload = (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode()
    write_bytes(path, payload)


def write_gzip_json(path: Path, value: Any) -> None:
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temporary.exists():
        raise RuntimeError(f"unowned temporary file exists: {temporary}")
    try:
        with temporary.open("xb") as stream:
            with gzip.GzipFile(fileobj=stream, mode="wb", mtime=0) as compressed:
                compressed.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def write_bytes(path: Path, payload: bytes) -> None:
    if path.exists():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != payload:
            raise RuntimeError(f"existing output differs: {path}")
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


def output_root(path: Path) -> Path:
    output = path.resolve()
    marker = output / ".libero-eda-export.json"
    if output.exists():
        if marker.is_symlink() or not marker.is_file() or load_json(marker) != OWNER:
            raise RuntimeError(f"output is not owned by the v4 upgrader: {output}")
    else:
        output.mkdir(parents=True)
        write_json(marker, OWNER)
    if (output / "manifest.json").exists():
        raise RuntimeError(f"completed hosted v4 output is immutable: {output}")
    return output


def checked_file(root: Path, relative: Any, record: dict[str, Any]) -> Path:
    relative = confined(relative)
    path = root / relative
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"artifact is missing or unsafe: {relative}")
    if (
        set(record) != {"bytes", "sha256"}
        or not isinstance(record["bytes"], int)
        or record["bytes"] < 0
        or not valid_sha256(record["sha256"])
        or path.stat().st_size != record["bytes"]
        or digest(path) != record["sha256"]
    ):
        raise RuntimeError(f"artifact integrity mismatch: {relative}")
    return path


def validate_candidate_motion_compatibility(
    candidate_bodies: set[str], replay: dict[str, Any], replay_id: str
) -> bool:
    """Validate whether an accepted candidate can use recorded proxy motion.

    Returns ``True`` when the hosted replay has a complete dynamic body series.
    A replay whose previous reconstruction was explicitly unavailable may still
    use the official candidate's initial body poses, but must not acquire
    invented body motion or a legacy scene asset through this migration.
    """

    body_names = replay.get("body_names")
    if not isinstance(body_names, list) or any(
        not isinstance(name, str) or not name for name in body_names
    ):
        raise RuntimeError(f"hosted replay body names are invalid: {replay_id}")
    if body_names:
        if not compatible_motion_body_sets(candidate_bodies, set(body_names)):
            raise RuntimeError(f"matched appearance body set mismatch: {replay_id}")
        if not replay.get("scene_asset_id") or not replay.get("scene_series_asset_id"):
            raise RuntimeError(
                f"matched replay motion assets are incomplete: {replay_id}"
            )
        return True

    reconstruction = replay.get("scene_reconstruction")
    if (
        replay.get("scene_asset_id") is not None
        or replay.get("scene_series_asset_id") is not None
        or not isinstance(reconstruction, dict)
        or reconstruction.get("method") != "unavailable"
        or reconstruction.get("object_motion") != "not_published"
    ):
        raise RuntimeError(
            f"empty-body replay is not an unavailable proxy: {replay_id}"
        )
    return False


def artifact_index(root: Path, manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    integrity = manifest.get("integrity")
    if (
        not isinstance(integrity, dict)
        or integrity.get("index") != "integrity/artifacts.json"
    ):
        raise RuntimeError("hosted v3 integrity contract is missing")
    index_path = checked_file(
        root,
        integrity["index"],
        {"bytes": integrity.get("bytes"), "sha256": integrity.get("sha256")},
    )
    index = load_json(index_path)
    artifacts = index.get("artifacts")
    if index.get("schema_version") != "libero-eda-integrity/v1" or not isinstance(
        artifacts, dict
    ):
        raise RuntimeError("hosted v3 artifact index is invalid")
    total = 0
    for relative, record in artifacts.items():
        confined(relative)
        if (
            not isinstance(record, dict)
            or set(record) != {"bytes", "sha256"}
            or not isinstance(record["bytes"], int)
            or record["bytes"] < 0
            or not valid_sha256(record["sha256"])
        ):
            raise RuntimeError(f"hosted v3 artifact record is invalid: {relative}")
        total += record["bytes"]
    if (
        index.get("artifact_count") != len(artifacts)
        or integrity.get("artifact_count") != len(artifacts)
        or index.get("artifact_bytes") != total
        or integrity.get("artifact_bytes") != total
    ):
        raise RuntimeError("hosted v3 integrity aggregates are invalid")
    return artifacts


def stage_file(
    source: Path,
    target: Path,
    expected: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"source artifact is missing or unsafe: {source}")
    record = {"bytes": source.stat().st_size, "sha256": digest(source)}
    if expected is not None and record != expected:
        raise RuntimeError(f"source artifact integrity mismatch: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        if temporary.exists():
            raise RuntimeError(f"unowned temporary file exists: {temporary}")
        try:
            with (
                source.open("rb") as input_stream,
                temporary.open("xb") as output_stream,
            ):
                shutil.copyfileobj(input_stream, output_stream, length=1024 * 1024)
                output_stream.flush()
                os.fsync(output_stream.fileno())
            temporary.replace(target)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    if (
        target.is_symlink()
        or not target.is_file()
        or {
            "bytes": target.stat().st_size,
            "sha256": digest(target),
        }
        != record
    ):
        raise RuntimeError(f"staged artifact differs: {target}")
    return record


def load_candidates(
    root: Path,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], str]:
    manifest_path = root / "manifest.json"
    manifest = load_json(manifest_path)
    if (
        manifest.get("schema_version") != CANDIDATE_SCHEMA
        or manifest.get("status") != "complete"
        or manifest.get("counts", {}).get("source_tasks") != EXPECTED_TASKS
        or manifest.get("counts", {}).get("candidates") != EXPECTED_CANDIDATES
    ):
        raise RuntimeError("appearance candidate library is incomplete")
    tasks = manifest.get("tasks")
    if not isinstance(tasks, dict) or len(tasks) != EXPECTED_TASKS:
        raise RuntimeError("appearance candidate task registry is invalid")
    shards: dict[str, dict[str, Any]] = {}
    for task_key, task in sorted(tasks.items()):
        if task.get("task_key") != task_key or task.get("candidate_count") != 100:
            raise RuntimeError(f"appearance candidate task mismatch: {task_key}")
        shard_path = checked_file(
            root,
            task.get("candidate_shard"),
            {
                "bytes": task.get("candidate_shard_bytes"),
                "sha256": task.get("candidate_shard_sha256"),
            },
        )
        checked_file(
            root,
            task.get("geometry_pack"),
            {
                "bytes": task.get("geometry_bytes"),
                "sha256": task.get("geometry_sha256"),
            },
        )
        checked_file(
            root,
            task.get("reference_bank"),
            {
                "bytes": task.get("reference_bytes"),
                "sha256": task.get("reference_sha256"),
            },
        )
        with gzip.open(shard_path, "rt", encoding="utf-8") as stream:
            shard = json.load(stream)
        records = shard.get("records")
        if (
            shard.get("schema_version") != CANDIDATE_SHARD_SCHEMA
            or shard.get("task_key") != task_key
            or not isinstance(records, dict)
            or len(records) != 100
        ):
            raise RuntimeError(f"appearance candidate shard is invalid: {task_key}")
        shards[task_key] = shard
    return manifest, shards, digest(manifest_path)


def load_matches(
    root: Path, candidate_sha: str, source_sha: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = load_json(root / "manifest.json")
    if (
        manifest.get("schema_version") != MATCH_SCHEMA
        or manifest.get("status") != "complete"
        or manifest.get("counts", {}).get("episodes") != EXPECTED_EPISODES
        or manifest.get("sources", {}).get("candidate_manifest_sha256") != candidate_sha
        or manifest.get("sources", {}).get("hosted_manifest_sha256") != source_sha
        or manifest.get("comparison", {}).get("fallback") != "forbidden"
    ):
        raise RuntimeError("appearance match manifest contract mismatch")
    match_record = manifest.get("matches")
    threshold_record = manifest.get("thresholds")
    if not isinstance(match_record, dict) or not isinstance(threshold_record, dict):
        raise RuntimeError("appearance match artifacts are missing")
    matches_path = checked_file(
        root,
        match_record.get("path"),
        {"bytes": match_record.get("bytes"), "sha256": match_record.get("sha256")},
    )
    checked_file(
        root,
        threshold_record.get("path"),
        {
            "bytes": threshold_record.get("bytes"),
            "sha256": threshold_record.get("sha256"),
        },
    )
    matches = load_json(matches_path)
    if not isinstance(matches, list) or len(matches) != EXPECTED_EPISODES:
        raise RuntimeError("appearance match coverage is incomplete")
    by_id = {item.get("replay_id"): item for item in matches}
    if len(by_id) != len(matches):
        raise RuntimeError("appearance match replay IDs are not unique")
    return manifest, matches


def public_sources(value: dict[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(value))
    groups = result.get("groups")
    if not isinstance(groups, list):
        raise RuntimeError("source registry groups are invalid")
    training = [
        item for item in groups if item.get("group_id") == "libero_plus_training"
    ]
    if len(training) != 1 or not isinstance(training[0].get("sources"), list):
        raise RuntimeError("LIBERO-Plus training source group is missing")
    primary = [
        item
        for item in training[0]["sources"]
        if item.get("source_id") == "libero_plus_lerobot"
    ]
    if len(primary) != 1 or not isinstance(primary[0].get("structure"), list):
        raise RuntimeError("LIBERO-Plus training primary source is missing")
    primary[0]["structure"] = [
        item for item in primary[0]["structure"] if "textures, lighting" not in item
    ]
    primary[0]["structure"].extend(
        [
            "published video remains the appearance ground truth",
            "background and light displays use only offline video matches that pass absolute, runner-up, and multi-frame gates",
            "the exact condition ID is inferred and is not published episode metadata",
            "unmatched appearance-tagged records use neutral geometry with no fallback candidate",
        ]
    )
    return result


def main() -> None:
    args = parse_args()
    source = args.source_v3.resolve(strict=True)
    candidates_root = args.candidates.resolve(strict=True)
    matches_root = args.matches.resolve(strict=True)
    output = output_root(args.output)
    if any(
        output == root or output.is_relative_to(root)
        for root in (source, candidates_root, matches_root)
    ):
        raise RuntimeError("v4 output must be independent from every input")
    reject_symlinks(candidates_root, "appearance candidate input")
    reject_symlinks(matches_root, "appearance match input")
    source_manifest_path = source / "manifest.json"
    source_manifest = load_json(source_manifest_path)
    if source_manifest.get("schema_version") != SOURCE_SCHEMA:
        raise RuntimeError("migration source is not hosted v3")
    source_artifacts = artifact_index(source, source_manifest)
    candidate_manifest, candidate_shards, candidate_sha = load_candidates(
        candidates_root
    )
    match_manifest, matches = load_matches(
        matches_root, candidate_sha, digest(source_manifest_path)
    )
    matches_by_id = {item["replay_id"]: item for item in matches}
    catalog = load_json(source / source_manifest["catalog"]["tasks"])
    task_shards = catalog.get("task_shards")
    if not isinstance(task_shards, dict) or len(task_shards) != 130:
        raise RuntimeError("hosted task-shard registry is invalid")

    artifacts = json.loads(json.dumps(source_artifacts))
    staged: set[str] = set()
    status_counts: Counter[str] = Counter()
    seen_matches: set[str] = set()
    for task_key, relative in sorted(task_shards.items()):
        source_record = source_artifacts.get(relative)
        if not isinstance(source_record, dict):
            raise RuntimeError(f"task shard is not indexed: {relative}")
        shard = load_json(checked_file(source, relative, source_record))
        plus_entries = shard.get("datasets", {}).get("lerobot_libero_plus")
        if not isinstance(plus_entries, list):
            raise RuntimeError(f"Plus task shard dataset is invalid: {task_key}")
        changed = False
        for entry in plus_entries:
            replay = entry.get("manifest")
            if not isinstance(replay, dict):
                raise RuntimeError(f"Plus replay manifest is invalid: {task_key}")
            replay_id = replay.get("replay_id")
            match = matches_by_id.get(replay_id)
            reconstruction = replay.get("scene_reconstruction")
            if (
                not isinstance(match, dict)
                or replay_id in seen_matches
                or not isinstance(reconstruction, dict)
                or reconstruction.get("schema_version") != PROXY_SOURCE_SCHEMA
            ):
                raise RuntimeError(f"appearance match join failed: {replay_id}")
            seen_matches.add(replay_id)
            status = match.get("status")
            category = entry.get("record", {}).get("training_environment_category")
            if (
                status not in {"matched", "unmatched", "not_applicable"}
                or match.get("category") != category
            ):
                raise RuntimeError(
                    f"appearance match semantics are invalid: {replay_id}"
                )
            if status == "matched":
                if category not in {"env", "light"} or not match.get("candidate_key"):
                    raise RuntimeError(
                        f"invalid accepted appearance match: {replay_id}"
                    )
                candidate = (
                    candidate_shards.get(task_key, {})
                    .get("records", {})
                    .get(match["candidate_key"])
                )
                if (
                    not isinstance(candidate, dict)
                    or candidate.get("category") != category
                    or candidate.get("name") != match.get("candidate_name")
                    or candidate.get("variant") != match.get("candidate_variant")
                    or candidate.get("resolved_bddl") != match.get("candidate_bddl")
                    or candidate.get("resolved_bddl_sha256")
                    != match.get("candidate_bddl_sha256")
                ):
                    raise RuntimeError(
                        f"accepted candidate identity mismatch: {replay_id}"
                    )
                candidate_bodies = {
                    body["name"] for body in candidate["snapshot"]["bodies"]
                }
                has_dynamic_motion = validate_candidate_motion_compatibility(
                    candidate_bodies, replay, replay_id
                )
                if not has_dynamic_motion:
                    replay["scene_fidelity"] = "analysis_approximate"
                    replay["scene_fidelity_reason"] = (
                        "The validated official candidate supplies the initial scene and "
                        "fixed camera. Object and robot body motion is not published, so "
                        "the candidate scene remains static while the recorded EEF "
                        "trajectory advances."
                    )
                    provenance = replay.get("provenance")
                    if not isinstance(provenance, dict):
                        raise RuntimeError(f"replay provenance is invalid: {replay_id}")
                    provenance["initial_scene_available"] = True
                    provenance["initial_scene_motion"] = "static_not_published"
                    reconstruction["reason"] = replay["scene_fidelity_reason"]
                appearance = "video_matched_official_candidate"
            elif status == "unmatched":
                if (
                    category not in {"env", "light"}
                    or match.get("candidate_key") is not None
                ):
                    raise RuntimeError(
                        f"invalid unmatched appearance record: {replay_id}"
                    )
                appearance = "not_available"
            else:
                if (
                    category in {"env", "light"}
                    or match.get("candidate_key") is not None
                ):
                    raise RuntimeError(
                        f"invalid non-applicable appearance record: {replay_id}"
                    )
                appearance = "original_libero_canonical"
            reconstruction["schema_version"] = PROXY_SCHEMA
            reconstruction["appearance"] = appearance
            reconstruction["appearance_match"] = {
                "schema_version": MATCH_RECORD_SCHEMA,
                **{
                    key: match.get(key)
                    for key in (
                        "status",
                        "category",
                        "candidate_key",
                        "candidate_name",
                        "candidate_variant",
                        "candidate_bddl",
                        "candidate_bddl_sha256",
                        "best_score",
                        "runner_up_score",
                        "relative_margin",
                        "frame_wins",
                        "frame_count",
                        "reason",
                    )
                },
            }
            status_counts[status] += 1
            changed = True
        if changed:
            target = output / relative
            write_json(target, shard)
            staged.add(relative)
            artifacts[relative] = {
                "bytes": target.stat().st_size,
                "sha256": digest(target),
            }
    if seen_matches != set(matches_by_id) or len(seen_matches) != EXPECTED_EPISODES:
        raise RuntimeError("appearance matches do not cover the hosted replay set")

    source_relative = source_manifest["catalog"]["sources"]
    source_record = source_artifacts.get(source_relative)
    if not isinstance(source_record, dict):
        raise RuntimeError("source registry is not indexed")
    source_registry = public_sources(
        load_json(checked_file(source, source_relative, source_record))
    )
    source_target = output / source_relative
    write_json(source_target, source_registry)
    staged.add(source_relative)
    artifacts[source_relative] = {
        "bytes": source_target.stat().st_size,
        "sha256": digest(source_target),
    }

    public_tasks: dict[str, Any] = {}
    for task_key, task in sorted(candidate_manifest["tasks"].items()):
        public_shard = json.loads(json.dumps(candidate_shards[task_key]))
        for record in public_shard["records"].values():
            record.pop("reference_index", None)
        shard_relative = task["candidate_shard"]
        shard_target = output / "training-appearances" / shard_relative
        write_gzip_json(shard_target, public_shard)
        staged_relative = shard_target.relative_to(output).as_posix()
        staged.add(staged_relative)
        artifacts[staged_relative] = {
            "bytes": shard_target.stat().st_size,
            "sha256": digest(shard_target),
        }
        geometry_relative = confined(task["geometry_pack"])
        staged_geometry = f"training-appearances/{geometry_relative}"
        artifacts[staged_geometry] = stage_file(
            candidates_root / geometry_relative,
            output / staged_geometry,
            {"bytes": task["geometry_bytes"], "sha256": task["geometry_sha256"]},
        )
        staged.add(staged_geometry)
        public_tasks[task_key] = {
            key: task[key]
            for key in (
                "task_key",
                "suite",
                "name",
                "candidate_count",
                "geometry_count",
            )
        } | {
            "candidate_shard": shard_relative,
            "candidate_shard_bytes": shard_target.stat().st_size,
            "candidate_shard_sha256": digest(shard_target),
            "geometry_pack": geometry_relative,
            "geometry_bytes": task["geometry_bytes"],
            "geometry_sha256": task["geometry_sha256"],
        }
    textures_root = candidates_root / "textures"
    for source_texture in sorted(textures_root.rglob("*.png")):
        key = source_texture.stem
        if not valid_sha256(key) or digest(source_texture) != key:
            raise RuntimeError(
                f"candidate texture is not content-addressed: {source_texture}"
            )
        relative = f"training-appearances/{source_texture.relative_to(candidates_root).as_posix()}"
        artifacts[relative] = stage_file(source_texture, output / relative)
        staged.add(relative)
    public_candidate_manifest = {
        **{
            key: candidate_manifest[key]
            for key in (
                "schema_version",
                "status",
                "source",
                "initialization",
                "counts",
            )
        },
        "tasks": public_tasks,
    }
    candidate_manifest_relative = "training-appearances/manifest.json"
    write_json(output / candidate_manifest_relative, public_candidate_manifest)
    staged.add(candidate_manifest_relative)
    artifacts[candidate_manifest_relative] = {
        "bytes": (output / candidate_manifest_relative).stat().st_size,
        "sha256": digest(output / candidate_manifest_relative),
    }

    match_manifest_relative = "training-appearances/matches/manifest.json"
    for name in ("manifest.json", "matches.json", "thresholds.json"):
        relative = f"training-appearances/matches/{name}"
        artifacts[relative] = stage_file(matches_root / name, output / relative)
        staged.add(relative)

    for support in (
        source_manifest["catalog"]["tasks"],
        source_manifest["catalog"]["episodes"],
    ):
        record = source_artifacts.get(support)
        if not isinstance(record, dict):
            raise RuntimeError(
                f"required sparse support artifact is not indexed: {support}"
            )
        artifacts[support] = stage_file(
            checked_file(source, support, record), output / support, record
        )
        staged.add(support)

    release_root = Path(__file__).resolve().parent.parent / "data-repository"
    reject_symlinks(release_root, "versioned data-repository files")
    release_files = [path for path in release_root.rglob("*") if path.is_file()]
    if not release_files:
        raise RuntimeError("versioned data-repository files are missing")
    for source_file in sorted(release_files):
        relative = source_file.relative_to(release_root).as_posix()
        target = output / relative
        write_bytes(target, source_file.read_bytes())
        staged.add(relative)
        artifacts[relative] = {
            "bytes": target.stat().st_size,
            "sha256": digest(target),
        }

    excluded = {".libero-eda-export.json", "manifest.json", "integrity/artifacts.json"}
    reject_symlinks(output, "hosted v4 staging output")
    actual = {
        path.relative_to(output).as_posix()
        for path in output.rglob("*")
        if path.is_file() and path.relative_to(output).as_posix() not in excluded
    }
    if actual != staged:
        raise RuntimeError(
            f"hosted v4 staging path mismatch: missing={sorted(staged - actual)[:5]}, extra={sorted(actual - staged)[:5]}"
        )
    integrity_path = output / "integrity/artifacts.json"
    write_json(
        integrity_path,
        {
            "schema_version": "libero-eda-integrity/v1",
            "artifact_count": len(artifacts),
            "artifact_bytes": sum(item["bytes"] for item in artifacts.values()),
            "artifacts": artifacts,
        },
    )
    manifest = {
        **source_manifest,
        "schema_version": SCHEMA_VERSION,
        "revision": hashlib.sha256(
            json.dumps(artifacts, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "generated_at": datetime.now(UTC).isoformat(),
        "training_reconstructions": {
            **source_manifest["training_reconstructions"],
            "schema_version": PROXY_SCHEMA,
        },
        "training_appearances": {
            "schema_version": MATCH_RECORD_SCHEMA,
            "candidate_manifest": candidate_manifest_relative,
            "match_manifest": match_manifest_relative,
            "source_tasks": EXPECTED_TASKS,
            "candidates": EXPECTED_CANDIDATES,
            "episodes": EXPECTED_EPISODES,
            "statuses": {
                key: status_counts[key]
                for key in ("matched", "unmatched", "not_applicable")
            },
            "motion_compatibility": {
                "candidate_only_fixed_bodies": sorted(
                    OFFICIAL_FIXED_CANDIDATE_ONLY_BODIES
                ),
                "static_initial_scene_episodes": 1,
            },
        },
        "integrity": {
            "index": "integrity/artifacts.json",
            "bytes": integrity_path.stat().st_size,
            "sha256": digest(integrity_path),
            "artifact_count": len(artifacts),
            "artifact_bytes": sum(item["bytes"] for item in artifacts.values()),
        },
    }
    write_json(output / "manifest.json", manifest)
    print(
        json.dumps(
            {
                "output": str(output),
                "revision": manifest["revision"],
                "artifacts": len(artifacts),
                "artifact_bytes": manifest["integrity"]["artifact_bytes"],
                "appearance_statuses": manifest["training_appearances"]["statuses"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
