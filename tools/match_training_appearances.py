#!/usr/bin/env python3
"""Match Plus training videos to the finite official appearance candidates.

Matching is deliberately conservative.  The exact candidate ID is absent from
the public training metadata, so a record is accepted only when a multi-frame
comparison passes the calibrated absolute-score, runner-up-margin, and frame
consistency gates.  There is no best-effort fallback.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import subprocess
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import numpy as np

SCHEMA_VERSION = "libero-plus-training-appearance-matches/v1"
CANDIDATE_SCHEMA = "libero-plus-training-appearance-candidates/v1"
OWNER = {
    "schema_version": SCHEMA_VERSION,
    "owner": "libero-eda-training-appearance-matcher",
}
CATALOG_SCHEMA = "7"
PLUS_REVISION = "f3f49f426d75030177b18778374005bc12ccd588"
HOSTED_SCHEMA = "libero-eda-hosted/v3"
FRAME_FRACTIONS = (0.0, 0.25, 0.5, 0.75, 0.95)
FRAME_COUNT = len(FRAME_FRACTIONS)
REFERENCE_SIZE = 128
MIN_MASK_COVERAGE = 0.30
MIN_FRAME_WINS = 4
MIN_RELATIVE_MARGIN = 0.08
MAX_NORMALIZED_MAE = {"env": 0.16, "light": 0.10}


@dataclass(frozen=True)
class Episode:
    replay_id: str
    task_key: str
    category: str | None
    length: int
    fps: float
    video_path: Path
    start_time_sec: float
    end_time_sec: float


@dataclass(frozen=True)
class CandidateBank:
    task_key: str
    category: str
    keys: tuple[str, ...]
    records: dict[str, dict[str, Any]]
    images: np.ndarray
    masks: np.ndarray


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-repo", type=Path, required=True)
    parser.add_argument("--hosted-root", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--workers", type=int, default=max(1, min(8, os.cpu_count() or 1))
    )
    parser.add_argument("--probe-replay")
    parser.add_argument("--probe-task")
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


def ensure_output(path: Path, *, probe: bool) -> Path:
    output = path.resolve()
    marker = output / ".libero-training-appearance-matches.json"
    if output.exists():
        if (
            marker.is_symlink()
            or not marker.is_file()
            or json.loads(marker.read_text()) != OWNER
        ):
            raise RuntimeError(f"output is not owned by this matcher: {output}")
    else:
        output.mkdir(parents=True)
        write_json(marker, OWNER)
    if (output / "manifest.json").exists() and not probe:
        raise RuntimeError(f"completed appearance match output is immutable: {output}")
    return output


def load_hosted_records(hosted_root: Path) -> tuple[dict[str, dict[str, Any]], str]:
    manifest_path = hosted_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if (
        manifest.get("schema_version") != HOSTED_SCHEMA
        or manifest.get("counts", {}).get("plus_training_episodes") != 14_347
    ):
        raise RuntimeError("hosted v3 reconstruction source is incompatible")
    catalog_path = hosted_root / manifest["catalog"]["tasks"]
    catalog = json.loads(catalog_path.read_text())
    records: dict[str, dict[str, Any]] = {}
    for task_key, relative in sorted(catalog["task_shards"].items()):
        shard = json.loads((hosted_root / relative).read_text())
        if shard.get("task_key") != task_key:
            raise RuntimeError(f"hosted task shard identity mismatch: {task_key}")
        for entry in shard["datasets"]["lerobot_libero_plus"]:
            replay_id = entry["manifest"]["replay_id"]
            if replay_id in records:
                raise RuntimeError(f"duplicate hosted replay: {replay_id}")
            records[replay_id] = entry
    if len(records) != 14_347:
        raise RuntimeError(f"hosted replay coverage mismatch: {len(records)}")
    return records, sha256(manifest_path)


def load_episodes(
    source_repo: Path, hosted: dict[str, dict[str, Any]]
) -> tuple[list[Episode], dict[str, Any]]:
    database = source_repo / ".parc/eda/index.duckdb"
    connection = duckdb.connect(str(database), read_only=True)
    try:
        metadata = dict(
            connection.execute("SELECT key, value FROM metadata").fetchall()
        )
        if (
            metadata.get("schema_version") != CATALOG_SCHEMA
            or metadata.get("dataset_revision") != PLUS_REVISION
        ):
            raise RuntimeError("local catalog revision contract mismatch")
        rows = connection.execute(
            """SELECT e.replay_id, e.base_task_key, e.training_environment_category,
                      e.length, e.fps, v.start_time_sec, v.end_time_sec, a.path,
                      a.size_bytes
               FROM episodes e
               JOIN episode_videos v ON v.replay_id=e.replay_id AND v.camera='agentview'
               JOIN assets a ON a.asset_id=v.asset_id
               WHERE e.dataset_id='lerobot_libero_plus'
               ORDER BY e.source_episode_index"""
        ).fetchall()
    finally:
        connection.close()
    result: list[Episode] = []
    verified_videos: dict[Path, int] = {}
    for (
        replay_id,
        task_key,
        category,
        length,
        fps,
        start,
        end,
        video_path,
        video_bytes,
    ) in rows:
        entry = hosted.get(replay_id)
        if (
            entry is None
            or entry["record"]["base_task_key"] != task_key
            or entry["record"]["training_environment_category"] != category
            or entry["manifest"]["state_count"] != length
        ):
            raise RuntimeError(f"hosted/local replay mismatch: {replay_id}")
        raw_path = Path(video_path)
        path = raw_path.resolve(strict=True)
        if raw_path.is_symlink() or not path.is_file() or path.is_symlink():
            raise RuntimeError(f"unsafe source video path: {replay_id}")
        if (
            not isinstance(video_bytes, int)
            or video_bytes < 1
            or path.stat().st_size != video_bytes
        ):
            raise RuntimeError(f"source video size mismatch: {replay_id}")
        if path not in verified_videos:
            if len(path.name) != 64 or set(path.name) - set("0123456789abcdef"):
                raise RuntimeError(
                    f"source video is not a content-addressed Hub blob: {path}"
                )
            if sha256(path) != path.name:
                raise RuntimeError(f"source video content hash mismatch: {path}")
            verified_videos[path] = video_bytes
        elif verified_videos[path] != video_bytes:
            raise RuntimeError(f"source video size metadata is inconsistent: {path}")
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            raise RuntimeError(f"invalid source video time range: {replay_id}")
        result.append(
            Episode(
                replay_id=replay_id,
                task_key=task_key,
                category=category,
                length=int(length),
                fps=float(fps),
                video_path=path,
                start_time_sec=float(start),
                end_time_sec=float(end),
            )
        )
    if len(result) != 14_347:
        raise RuntimeError(f"local Plus episode coverage mismatch: {len(result)}")
    return result, {
        "contract": "huggingface_cache_blob_filename_equals_sha256",
        "unique_blobs": len(verified_videos),
        "unique_blob_bytes": sum(verified_videos.values()),
    }


def load_candidate_banks(
    root: Path,
) -> tuple[dict[tuple[str, str], CandidateBank], str]:
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema_version") != CANDIDATE_SCHEMA or manifest.get(
        "status"
    ) not in {
        "complete",
        "probe",
    }:
        raise RuntimeError("appearance candidate manifest is incomplete")
    result: dict[tuple[str, str], CandidateBank] = {}
    for task_key, task in sorted(manifest["tasks"].items()):
        shard_path = root / task["candidate_shard"]
        reference_path = root / task["reference_bank"]
        if (
            sha256(shard_path) != task["candidate_shard_sha256"]
            or sha256(reference_path) != task["reference_sha256"]
        ):
            raise RuntimeError(f"candidate task artifact hash mismatch: {task_key}")
        with gzip.open(shard_path, "rt", encoding="utf-8") as stream:
            shard = json.load(stream)
        with np.load(reference_path, allow_pickle=False) as data:
            images = np.asarray(data["images"], dtype=np.uint8)
            masks = np.asarray(data["masks"], dtype=bool)
        if images.shape != (100, REFERENCE_SIZE, REFERENCE_SIZE, 3) or masks.shape != (
            100,
            REFERENCE_SIZE,
            REFERENCE_SIZE,
        ):
            raise RuntimeError(f"candidate reference bank shape mismatch: {task_key}")
        for category in ("env", "light"):
            records = {
                key: value
                for key, value in shard["records"].items()
                if value["category"] == category
            }
            keys = tuple(
                sorted(records, key=lambda key: records[key]["reference_index"])
            )
            indices = [records[key]["reference_index"] for key in keys]
            if len(keys) != 50 or len(set(indices)) != 50:
                raise RuntimeError(
                    f"candidate category coverage mismatch: {task_key}/{category}"
                )
            result[(task_key, category)] = CandidateBank(
                task_key=task_key,
                category=category,
                keys=keys,
                records=records,
                images=images[indices],
                masks=masks[indices],
            )
    return result, sha256(manifest_path)


def extract_frames(episode: Episode) -> np.ndarray:
    frame_indices = sorted(
        {
            min(episode.length - 1, max(0, round((episode.length - 1) * fraction)))
            for fraction in FRAME_FRACTIONS
        }
    )
    if len(frame_indices) != FRAME_COUNT:
        raise RuntimeError(
            f"episode is too short for matching frames: {episode.replay_id}"
        )
    expression = "+".join(f"eq(n\\,{index})" for index in frame_indices)
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{episode.start_time_sec:.9f}",
        "-i",
        str(episode.video_path),
        "-vf",
        f"select='{expression}',hflip,vflip,scale={REFERENCE_SIZE}:{REFERENCE_SIZE}",
        "-vsync",
        "0",
        "-frames:v",
        str(FRAME_COUNT),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
    ]
    completed = subprocess.run(command, check=True, capture_output=True)
    expected = FRAME_COUNT * REFERENCE_SIZE * REFERENCE_SIZE * 3
    if len(completed.stdout) != expected:
        raise RuntimeError(
            f"source video frame extraction mismatch: {episode.replay_id}: "
            f"{len(completed.stdout)} != {expected}"
        )
    return np.frombuffer(completed.stdout, dtype=np.uint8).reshape(
        FRAME_COUNT, REFERENCE_SIZE, REFERENCE_SIZE, 3
    )


def shifted(value: np.ndarray, dy: int, dx: int, *, fill: float | bool) -> np.ndarray:
    result = np.full_like(value, fill)
    source_y = slice(max(0, -dy), min(value.shape[0], value.shape[0] - dy))
    target_y = slice(max(0, dy), min(value.shape[0], value.shape[0] + dy))
    source_x = slice(max(0, -dx), min(value.shape[1], value.shape[1] - dx))
    target_x = slice(max(0, dx), min(value.shape[1], value.shape[1] + dx))
    result[target_y, target_x] = value[source_y, source_x]
    return result


def candidate_scores(
    target: np.ndarray,
    stable: np.ndarray,
    images: np.ndarray,
    masks: np.ndarray,
) -> np.ndarray:
    if (
        target.shape != (REFERENCE_SIZE, REFERENCE_SIZE, 3)
        or stable.shape != (REFERENCE_SIZE, REFERENCE_SIZE)
        or images.ndim != 4
        or images.shape[1:] != target.shape
        or masks.shape != images.shape[:3]
    ):
        raise RuntimeError("appearance score array contract mismatch")
    target_float = target.astype(np.float32) / 255.0
    images_float = images.astype(np.float32) / 255.0
    best = np.full(images.shape[0], np.inf, dtype=np.float64)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            source_y = slice(max(0, -dy), min(REFERENCE_SIZE, REFERENCE_SIZE - dy))
            target_y = slice(max(0, dy), min(REFERENCE_SIZE, REFERENCE_SIZE + dy))
            source_x = slice(max(0, -dx), min(REFERENCE_SIZE, REFERENCE_SIZE - dx))
            target_x = slice(max(0, dx), min(REFERENCE_SIZE, REFERENCE_SIZE + dx))
            candidate_mask = (
                masks[:, source_y, source_x] & stable[target_y, target_x][None, :, :]
            )
            pixels = candidate_mask.sum(axis=(1, 2))
            valid = pixels >= MIN_MASK_COVERAGE * REFERENCE_SIZE * REFERENCE_SIZE
            if not np.any(valid):
                continue
            error = np.abs(
                images_float[:, source_y, source_x, :]
                - target_float[target_y, target_x, :][None, :, :, :]
            ).mean(axis=3)
            values = np.divide(
                (error * candidate_mask).sum(axis=(1, 2)),
                pixels,
                out=np.full(images.shape[0], np.inf, dtype=np.float64),
                where=pixels > 0,
            )
            best[valid] = np.minimum(best[valid], values[valid])
    if not np.all(np.isfinite(best)):
        raise RuntimeError("appearance score has no sufficiently large static mask")
    return best


def rank_candidates(
    frames: np.ndarray, bank: CandidateBank
) -> tuple[list[tuple[float, str]], int]:
    target = np.median(frames.astype(np.float32), axis=0).astype(np.uint8)
    deviation = np.median(
        np.abs(frames.astype(np.float32) - target.astype(np.float32)), axis=(0, 3)
    )
    stable = deviation <= 10.0
    aggregate = sorted(
        zip(
            candidate_scores(target, stable, bank.images, bank.masks).tolist(),
            bank.keys,
            strict=True,
        )
    )
    winner = aggregate[0][1]
    frame_wins = 0
    for frame in frames:
        ranked = min(
            zip(
                candidate_scores(frame, stable, bank.images, bank.masks).tolist(),
                bank.keys,
                strict=True,
            )
        )
        frame_wins += ranked[1] == winner
    return aggregate, frame_wins


def synthetic_query(image: np.ndarray, index: int, category: str) -> np.ndarray:
    value = image.astype(np.float32)
    if category == "light":
        if index == 0:
            value = shifted(value, 1, 0, fill=0.0)
        elif index == 1:
            value = shifted(value, 0, -1, fill=0.0)
        else:
            raise RuntimeError(f"unsupported light calibration transform: {index}")
        rng = np.random.default_rng(17 + index)
        value += rng.normal(0, 1.5, value.shape)
        return np.rint(np.clip(value, 0, 255)).astype(np.uint8)
    if index == 0:
        value = shifted(value, 1, 0, fill=0.0) * 0.92 + 5.0
    elif index == 1:
        value = shifted(value, 0, -1, fill=0.0) * 1.08 - 4.0
    elif index == 2:
        value = shifted(value, -2, 1, fill=0.0) * 0.88 + 8.0
    else:
        rng = np.random.default_rng(17)
        value = shifted(value, 2, -2, fill=0.0) * 1.12 + rng.normal(0, 4, value.shape)
    return np.clip(value, 0, 255).astype(np.uint8)


def calibrate(bank: CandidateBank) -> dict[str, Any]:
    correct_scores: list[float] = []
    margins: list[float] = []
    eligible: list[str] = []
    top1_correct = 0
    validation_total = len(bank.keys) * 2
    for index in range(len(bank.keys)):
        key = bank.keys[index]
        image = bank.images[index]
        candidate_correct = True
        for transform in range(2):
            query = synthetic_query(image, transform, bank.category)
            ranking = sorted(
                zip(
                    candidate_scores(
                        query,
                        np.ones(image.shape[:2], dtype=bool),
                        bank.images,
                        bank.masks,
                    ).tolist(),
                    bank.keys,
                    strict=True,
                )
            )
            score, winner = ranking[0]
            margin = (ranking[1][0] - score) / max(score, 1e-9)
            if winner == key:
                top1_correct += 1
                correct_scores.append(score)
                margins.append(margin)
            else:
                candidate_correct = False
        if candidate_correct:
            eligible.append(key)
    if not correct_scores or not margins:
        raise RuntimeError(
            f"candidate calibration has no identifiable samples: {bank.task_key}"
        )
    if not eligible:
        raise RuntimeError(
            f"candidate calibration has no self-identifiable candidates: {bank.task_key}/{bank.category}"
        )
    absolute = MAX_NORMALIZED_MAE[bank.category]
    margin = max(MIN_RELATIVE_MARGIN, float(np.percentile(margins, 5)) * 0.5)
    coverage = top1_correct / validation_total
    return {
        "absolute_score_max": absolute,
        "synthetic_self_match_score_max": max(correct_scores),
        "relative_margin_min": margin,
        "validation_samples": validation_total,
        "validation_top1_correct": top1_correct,
        "validation_top1_coverage": coverage,
        "eligible_candidates": len(eligible),
        "eligible_candidate_keys": eligible,
    }


def match_episode(
    episode: Episode, bank: CandidateBank, threshold: dict[str, Any]
) -> dict[str, Any]:
    frames = extract_frames(episode)
    ranking, frame_wins = rank_candidates(frames, bank)
    best_score, best_key = ranking[0]
    second_score = ranking[1][0]
    margin = (second_score - best_score) / max(best_score, 1e-9)
    accepted = (
        best_key in threshold["eligible_candidate_keys"]
        and best_score <= float(threshold["absolute_score_max"])
        and margin >= float(threshold["relative_margin_min"])
        and frame_wins >= MIN_FRAME_WINS
    )
    if accepted:
        status = "matched"
        reason = "passed_absolute_margin_and_multiframe_consistency"
        candidate = bank.records[best_key]
    else:
        status = "unmatched"
        candidate = None
        if best_key not in threshold["eligible_candidate_keys"]:
            reason = "winning_candidate_failed_self_identifiability_calibration"
        elif best_score > float(threshold["absolute_score_max"]):
            reason = "absolute_score_above_calibrated_limit"
        elif margin < float(threshold["relative_margin_min"]):
            reason = "runner_up_margin_below_calibrated_limit"
        else:
            reason = "multiframe_winner_inconsistent"
    return {
        "replay_id": episode.replay_id,
        "status": status,
        "category": episode.category,
        "candidate_key": best_key if accepted else None,
        "candidate_name": candidate["name"] if candidate else None,
        "candidate_variant": candidate["variant"] if candidate else None,
        "candidate_bddl": candidate["resolved_bddl"] if candidate else None,
        "candidate_bddl_sha256": candidate["resolved_bddl_sha256"]
        if candidate
        else None,
        "best_score": best_score,
        "runner_up_score": second_score,
        "relative_margin": margin,
        "frame_wins": frame_wins,
        "frame_count": FRAME_COUNT,
        "reason": reason,
    }


def main() -> None:
    args = parse_args()
    source_repo = args.source_repo.resolve(strict=True)
    hosted_root = args.hosted_root.resolve(strict=True)
    candidate_root = args.candidates.resolve(strict=True)
    probe = args.probe_replay is not None or args.probe_task is not None
    output = ensure_output(args.output, probe=probe)
    hosted, hosted_manifest_sha256 = load_hosted_records(hosted_root)
    episodes, source_video_validation = load_episodes(source_repo, hosted)
    banks, candidate_manifest_sha256 = load_candidate_banks(candidate_root)
    if args.probe_replay:
        episodes = [item for item in episodes if item.replay_id == args.probe_replay]
        if len(episodes) != 1:
            raise RuntimeError(f"unknown probe replay: {args.probe_replay}")
    if args.probe_task:
        episodes = [item for item in episodes if item.task_key == args.probe_task]
        if not episodes:
            raise RuntimeError(f"unknown probe task: {args.probe_task}")

    def calibrate_item(
        item: tuple[tuple[str, str], CandidateBank],
    ) -> tuple[tuple[str, str], dict[str, Any]]:
        key, bank = item
        return key, calibrate(bank)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        thresholds = dict(pool.map(calibrate_item, sorted(banks.items())))
    matches: list[dict[str, Any]] = []
    matchable = [item for item in episodes if item.category in {"env", "light"}]
    not_applicable = [
        item for item in episodes if item.category not in {"env", "light"}
    ]
    for episode in not_applicable:
        matches.append(
            {
                "replay_id": episode.replay_id,
                "status": "not_applicable",
                "category": episode.category,
                "candidate_key": None,
                "candidate_name": None,
                "candidate_variant": None,
                "candidate_bddl": None,
                "candidate_bddl_sha256": None,
                "best_score": None,
                "runner_up_score": None,
                "relative_margin": None,
                "frame_wins": None,
                "frame_count": 0,
                "reason": "training_path_tag_has_no_official_background_or_light_candidate_set",
            }
        )

    def run(item: Episode) -> dict[str, Any]:
        bank = banks.get((item.task_key, item.category or ""))
        if bank is None:
            raise RuntimeError(
                f"appearance candidate bank is missing: {item.task_key}/{item.category}"
            )
        return match_episode(
            item, bank, thresholds[(item.task_key, item.category or "")]
        )

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for index, value in enumerate(pool.map(run, matchable), start=1):
            matches.append(value)
            if index % 100 == 0 or index == len(matchable):
                print(
                    f"matched {index}/{len(matchable)} appearance-tagged episodes",
                    flush=True,
                )
    matches.sort(key=lambda item: int(item["replay_id"].removeprefix("demo-")))
    if not probe and len(matches) != 14_347:
        raise RuntimeError(f"appearance match coverage mismatch: {len(matches)}")
    statuses = Counter(item["status"] for item in matches)
    status_counts = {
        key: statuses[key] for key in ("matched", "unmatched", "not_applicable")
    }
    categories = defaultdict(Counter)
    for item in matches:
        categories[str(item["category"])][item["status"]] += 1
    match_path = output / "matches.json"
    write_json(match_path, matches)
    threshold_path = output / "thresholds.json"
    write_json(
        threshold_path,
        {
            f"{task_key}|{category}": value
            for (task_key, category), value in sorted(thresholds.items())
        },
    )
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "status": "probe" if probe else "complete",
        "generated_at": datetime.now(UTC).isoformat(),
        "sources": {
            "hosted_schema": HOSTED_SCHEMA,
            "hosted_manifest_sha256": hosted_manifest_sha256,
            "candidate_schema": CANDIDATE_SCHEMA,
            "candidate_manifest_sha256": candidate_manifest_sha256,
            "catalog_schema": CATALOG_SCHEMA,
            "libero_plus_dataset_revision": PLUS_REVISION,
        },
        "comparison": {
            "camera": "agentview",
            "source_display_transform": "rotate_180",
            "source_video_validation": source_video_validation,
            "frame_fractions": list(FRAME_FRACTIONS),
            "reference_size": REFERENCE_SIZE,
            "alignment_search_pixels": 2,
            "calibration_queries_per_candidate": 2,
            "calibration_model": {
                "env": "one_pixel_alignment_plus_global_photometric_shift",
                "light": "one_pixel_alignment_plus_codec_scale_noise_without_brightness_shift",
            },
            "candidate_acceptance_requires_self_identifiability": True,
            "minimum_static_mask_coverage": MIN_MASK_COVERAGE,
            "minimum_frame_wins": MIN_FRAME_WINS,
            "fallback": "forbidden",
        },
        "counts": {
            "episodes": len(matches),
            "statuses": status_counts,
            "categories": {
                key: dict(sorted(value.items()))
                for key, value in sorted(categories.items())
            },
        },
        "matches": {
            "path": "matches.json",
            "bytes": match_path.stat().st_size,
            "sha256": sha256(match_path),
        },
        "thresholds": {
            "path": "thresholds.json",
            "bytes": threshold_path.stat().st_size,
            "sha256": sha256(threshold_path),
        },
    }
    write_json(output / "manifest.json", manifest)
    print(json.dumps({"output": str(output), "counts": manifest["counts"]}, indent=2))


if __name__ == "__main__":
    main()
