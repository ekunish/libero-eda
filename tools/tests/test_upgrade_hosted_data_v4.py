from __future__ import annotations

import pytest

from tools.upgrade_hosted_data_v4 import validate_candidate_motion_compatibility


def replay(*, body_names: list[str], scene: str | None, series: str | None) -> dict:
    return {
        "body_names": body_names,
        "scene_asset_id": scene,
        "scene_series_asset_id": series,
        "scene_reconstruction": {
            "method": "unavailable" if not body_names else "mujoco_osc_retarget",
            "object_motion": "not_published" if not body_names else "mujoco_simulated",
        },
    }


def test_accepts_official_initial_scene_without_inventing_body_motion() -> None:
    assert not validate_candidate_motion_compatibility(
        {"robot0_link0", "plate_1"},
        replay(body_names=[], scene=None, series=None),
        "demo-12273",
    )


def test_requires_exact_body_set_when_proxy_motion_is_present() -> None:
    assert validate_candidate_motion_compatibility(
        {"robot0_link0", "plate_1"},
        replay(
            body_names=["robot0_link0", "plate_1"],
            scene="scene.glb",
            series="scene.arrow.gz",
        ),
        "demo-995",
    )
    with pytest.raises(RuntimeError, match="body set mismatch"):
        validate_candidate_motion_compatibility(
            {"robot0_link0", "plate_1"},
            replay(
                body_names=["robot0_link0"],
                scene="scene.glb",
                series="scene.arrow.gz",
            ),
            "demo-bad",
        )


def test_accepts_the_pinned_jointless_living_room_table_body() -> None:
    assert validate_candidate_motion_compatibility(
        {"robot0_link0", "plate_1", "living_room_table_col"},
        replay(
            body_names=["robot0_link0", "plate_1"],
            scene="scene.glb",
            series="scene.arrow.gz",
        ),
        "demo-2147",
    )


def test_rejects_empty_body_contract_with_hidden_motion_assets() -> None:
    with pytest.raises(RuntimeError, match="not an unavailable proxy"):
        validate_candidate_motion_compatibility(
            {"robot0_link0"},
            replay(body_names=[], scene="scene.glb", series=None),
            "demo-bad",
        )
