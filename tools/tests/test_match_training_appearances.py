from __future__ import annotations

import numpy as np

from tools.match_training_appearances import (
    MIN_MASK_COVERAGE,
    candidate_scores,
    shifted,
    synthetic_query,
)


def scalar_scores(
    target: np.ndarray,
    stable: np.ndarray,
    images: np.ndarray,
    masks: np.ndarray,
) -> np.ndarray:
    result: list[float] = []
    target_float = target.astype(np.float32) / 255.0
    for image, mask in zip(images, masks, strict=True):
        best = float("inf")
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                candidate = shifted(image, dy, dx, fill=0).astype(np.float32) / 255.0
                candidate_mask = shifted(mask, dy, dx, fill=False) & stable
                if float(candidate_mask.mean()) < MIN_MASK_COVERAGE:
                    continue
                error = np.abs(target_float - candidate).mean(axis=2)
                best = min(best, float(np.mean(error[candidate_mask])))
        result.append(best)
    return np.asarray(result)


def test_vectorized_candidate_scores_equal_scalar_reference() -> None:
    rng = np.random.default_rng(31)
    target = rng.integers(0, 256, (128, 128, 3), dtype=np.uint8)
    images = rng.integers(0, 256, (4, 128, 128, 3), dtype=np.uint8)
    masks = rng.random((4, 128, 128)) > 0.2
    stable = rng.random((128, 128)) > 0.1

    np.testing.assert_allclose(
        candidate_scores(target, stable, images, masks),
        scalar_scores(target, stable, images, masks),
        rtol=1e-6,
        atol=1e-6,
    )


def test_candidate_scores_recover_a_two_pixel_alignment() -> None:
    image = np.zeros((128, 128, 3), dtype=np.uint8)
    image[24:108, 18:99] = [23, 167, 241]
    distractor = image.copy()
    distractor[24:108, 18:99] = [241, 71, 19]
    target = shifted(image, 2, -2, fill=0)
    masks = np.ones((2, 128, 128), dtype=bool)

    scores = candidate_scores(
        target,
        np.ones((128, 128), dtype=bool),
        np.stack([image, distractor]),
        masks,
    )

    assert scores[0] < 1e-7
    assert scores[1] > 0.25


def test_light_calibration_preserves_brightness_signal() -> None:
    image = np.full((128, 128, 3), 120, dtype=np.uint8)

    transformed = synthetic_query(image, 0, "light")

    assert abs(float(transformed[2:-2, 2:-2].mean()) - 120.0) < 0.2
    assert abs(float(synthetic_query(image, 0, "env").mean()) - 120.0) > 3.0
