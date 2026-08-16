#!/usr/bin/env python3
"""Validate an immutable hosted release without downloading every LFS payload."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

from huggingface_hub import HfApi, RepoFile, hf_hub_download

SHA256 = set("0123456789abcdef")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_id")
    parser.add_argument("--revision", required=True)
    parser.add_argument("--repo-type", default="dataset", choices=("dataset",))
    return parser.parse_args()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= SHA256


def valid_revision(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 40 and set(value) <= SHA256


def load_download(
    repo_id: str,
    filename: str,
    revision: str,
    repo_type: str,
    cache: Path,
) -> tuple[Path, Any]:
    path = Path(
        hf_hub_download(
            repo_id,
            filename=filename,
            revision=revision,
            repo_type=repo_type,
            local_dir=cache,
        )
    )
    with path.open(encoding="utf-8") as stream:
        return path, json.load(stream)


def main() -> None:
    args = parse_args()
    if not valid_revision(args.revision):
        raise RuntimeError("revision must be an immutable 40-character Git commit")
    api = HfApi()
    info = api.repo_info(
        args.repo_id,
        repo_type=args.repo_type,
        revision=args.revision,
    )
    if info.sha != args.revision:
        raise RuntimeError(f"remote revision mismatch: {info.sha}")

    with tempfile.TemporaryDirectory(prefix="libero-eda-remote-validate.") as raw:
        cache = Path(raw)
        manifest_path, manifest = load_download(
            args.repo_id,
            "manifest.json",
            args.revision,
            args.repo_type,
            cache,
        )
        if manifest.get("schema_version") != "libero-eda-hosted/v4":
            raise RuntimeError("remote release is not hosted v4")
        appearances = manifest.get("training_appearances")
        if (
            not isinstance(appearances, dict)
            or appearances.get("schema_version")
            != "libero-plus-training-appearance-match/v1"
            or appearances.get("source_tasks") != 40
            or appearances.get("candidates") != 4_000
            or appearances.get("episodes") != 14_347
            or not isinstance(appearances.get("statuses"), dict)
            or sum(appearances["statuses"].values()) != 14_347
            or appearances.get("motion_compatibility")
            != {
                "candidate_only_fixed_bodies": ["living_room_table_col"],
                "static_initial_scene_episodes": 1,
            }
        ):
            raise RuntimeError("remote training appearance contract is invalid")
        integrity = manifest.get("integrity")
        if (
            not isinstance(integrity, dict)
            or integrity.get("index") != "integrity/artifacts.json"
            or not valid_sha256(integrity.get("sha256"))
        ):
            raise RuntimeError("remote manifest integrity contract is invalid")
        integrity_path, index = load_download(
            args.repo_id,
            integrity["index"],
            args.revision,
            args.repo_type,
            cache,
        )
        if (
            integrity_path.stat().st_size != integrity.get("bytes")
            or digest(integrity_path) != integrity["sha256"]
        ):
            raise RuntimeError("remote integrity index hash mismatch")
        artifacts = index.get("artifacts")
        if (
            index.get("schema_version") != "libero-eda-integrity/v1"
            or not isinstance(artifacts, dict)
            or not artifacts
        ):
            raise RuntimeError("remote artifact index is invalid")
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
                raise RuntimeError(f"invalid indexed artifact: {relative!r}")
            total_bytes += record["bytes"]
        if (
            index.get("artifact_count") != len(artifacts)
            or integrity.get("artifact_count") != len(artifacts)
            or index.get("artifact_bytes") != total_bytes
            or integrity.get("artifact_bytes") != total_bytes
        ):
            raise RuntimeError("remote artifact aggregates are invalid")

        remote: dict[str, RepoFile] = {}
        for entry in api.list_repo_tree(
            args.repo_id,
            repo_type=args.repo_type,
            revision=args.revision,
            recursive=True,
            expand=False,
        ):
            if isinstance(entry, RepoFile):
                remote[entry.path] = entry
        allowed_unindexed = {".gitattributes", "manifest.json", integrity["index"]}
        if set(remote) - set(artifacts) - allowed_unindexed:
            raise RuntimeError(
                "remote release contains unindexed files: "
                f"{sorted(set(remote) - set(artifacts) - allowed_unindexed)[:5]}"
            )
        missing = set(artifacts) - set(remote)
        if missing:
            raise RuntimeError(
                f"remote release is missing artifacts: {sorted(missing)[:5]}"
            )

        downloaded_git_blobs = 0
        for ordinal, (relative, record) in enumerate(
            sorted(artifacts.items()), start=1
        ):
            remote_file = remote[relative]
            if remote_file.size != record["bytes"]:
                raise RuntimeError(f"remote artifact size mismatch: {relative}")
            if remote_file.lfs is not None:
                if (
                    remote_file.lfs.size != record["bytes"]
                    or remote_file.lfs.sha256 != record["sha256"]
                ):
                    raise RuntimeError(f"remote LFS digest mismatch: {relative}")
            else:
                path = Path(
                    hf_hub_download(
                        args.repo_id,
                        filename=relative,
                        revision=args.revision,
                        repo_type=args.repo_type,
                        local_dir=cache,
                    )
                )
                downloaded_git_blobs += 1
                if (
                    path.stat().st_size != record["bytes"]
                    or digest(path) != record["sha256"]
                ):
                    raise RuntimeError(
                        f"remote Git artifact digest mismatch: {relative}"
                    )
            if ordinal % 5000 == 0:
                print(
                    f"verified {ordinal}/{len(artifacts)} remote artifacts", flush=True
                )

        if manifest_path.stat().st_size != remote["manifest.json"].size:
            raise RuntimeError("remote manifest size mismatch")
        print(
            json.dumps(
                {
                    "repo_id": args.repo_id,
                    "revision": args.revision,
                    "artifacts": len(artifacts),
                    "artifact_bytes": total_bytes,
                    "downloaded_git_blobs": downloaded_git_blobs,
                    "status": "valid",
                },
                indent=2,
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
