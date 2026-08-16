"""Pure discovery helpers for the generated LIBERO-Plus appearance universe."""

from __future__ import annotations

import re
from pathlib import Path

EXPECTED_PER_TASK = {"env": 50, "light": 50}
# The pinned official living-room appearance assets place the table visual in
# this jointless child body.  Older canonical proxy scenes attach that visual
# directly to the parent table, so the candidate body may exist without a
# motion-series column.  It remains at its official initial pose; no dynamic
# body may be omitted through this exception.
OFFICIAL_FIXED_CANDIDATE_ONLY_BODIES = frozenset({"living_room_table_col"})
PATTERNS = {
    "env": re.compile(r"(?:table|tb)_\d+"),
    "light": re.compile(r"light_\d+"),
}


def discover_candidate_names(
    resolved_root: Path, base_name: str
) -> dict[str, list[tuple[str, str]]]:
    discovered: dict[str, list[tuple[str, str]]] = {
        category: [] for category in EXPECTED_PER_TASK
    }
    for resolved in sorted(resolved_root.glob(f"{base_name}_*.bddl")):
        variant = resolved.stem.removeprefix(f"{base_name}_")
        for category, pattern in PATTERNS.items():
            if pattern.fullmatch(variant):
                discovered[category].append((variant, resolved.stem))
                break
    return discovered


def compatible_motion_body_sets(
    candidate_bodies: set[str], motion_bodies: set[str]
) -> bool:
    """Accept exact motion coverage plus the one pinned jointless scene body."""

    return (
        not (motion_bodies - candidate_bodies)
        and (candidate_bodies - motion_bodies) <= OFFICIAL_FIXED_CANDIDATE_ONLY_BODIES
    )
