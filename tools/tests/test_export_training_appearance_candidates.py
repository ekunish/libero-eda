from pathlib import Path

from tools.training_appearance_candidates import discover_candidate_names


def touch(root: Path, name: str) -> None:
    (root / f"{name}.bddl").write_text("(define (problem fixture))\n")


def test_discovers_the_actual_official_numbering_instead_of_assuming_one_based(
    tmp_path: Path,
) -> None:
    base = "pick_up_the_black_bowl"
    for suffix in (
        "table_0",
        "table_27",
        "tb_1",
        "tb_22",
        "light_1",
        "light_50",
        "language_1",
        "table_28_with_modified_region",
    ):
        touch(tmp_path, f"{base}_{suffix}")
    touch(tmp_path, "another_task_table_0")

    discovered = discover_candidate_names(tmp_path, base)

    assert discovered == {
        "env": [
            ("table_0", f"{base}_table_0"),
            ("table_27", f"{base}_table_27"),
            ("tb_1", f"{base}_tb_1"),
            ("tb_22", f"{base}_tb_22"),
        ],
        "light": [
            ("light_1", f"{base}_light_1"),
            ("light_50", f"{base}_light_50"),
        ],
    }
