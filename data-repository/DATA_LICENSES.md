# Data licenses and attribution

This repository contains material from multiple sources.

## Original LIBERO-derived paths

The following paths are derived from the official Original LIBERO
demonstrations distributed by `yifengzhu-hf/LIBERO-datasets` at revision
`f13aa24a3da8c43c7225569f28c562979fa0e35a`:

- `assets/videos/original_libero/`
- Original-LIBERO entries under `assets/series/`
- Original-LIBERO entries under `assets/thumbnails/`
- `assets/scenes/`
- corresponding catalog metadata

The reconstructed GLB scenes also contain geometry and textures from the
Original LIBERO simulator. The upstream MIT notice is preserved at
[`LICENSES/LIBERO-MIT.txt`](LICENSES/LIBERO-MIT.txt).

The validated source manifest identifies the demonstration dataset license as
Creative Commons Attribution 4.0 International (CC BY 4.0). Attribution:
**Lifelong Robot Learning Benchmark (LIBERO), Lifelong-Robot-Learning/LIBERO,
and the official demonstration dataset distributors.**

License text and terms: https://creativecommons.org/licenses/by/4.0/legalcode

## LIBERO-Plus training paths

LIBERO-Plus replay metadata, derived series, and thumbnails are based on the
following pinned sources, whose dataset cards declare MIT:

- `Sylvest/libero_plus_lerobot@22c57433fef692b5b9ecc0795344daac7fa867a5`
- `lerobot/libero_plus@f3f49f426d75030177b18778374005bc12ccd588`
- `Sylvest/libero_plus_rlds@fb0c7029b076030d5d57227229e4f7460def1f7c`

Copyright and attribution remain with their respective authors and uploaders.

## LIBERO-Plus evaluation scene paths

`evaluation-scenes/` contains content-addressed geometry and source textures
from `Sylvest/LIBERO-plus@dd2bd61b7d9a6fef1abc52d606e983b41886a149`, whose
dataset card declares MIT, together with numeric scene descriptors derived by
executing `sylvestf/LIBERO-plus@4976dc30028e805ff8094b55501d532c48fec182`.
The raw classification, BDDL, and init-state files are not redistributed.
Copyright and attribution remain with the LIBERO and LIBERO-Plus authors.

## LIBERO EDA original material

Original export schemas, validation metadata, and code-specific catalog
material are Copyright 2026 ekunish and licensed under Apache License 2.0.
The license text is preserved at
[`LICENSES/LIBERO-EDA-APACHE-2.0.txt`](LICENSES/LIBERO-EDA-APACHE-2.0.txt).

No LIBERO-Plus evaluation BDDL, init-state, or classification file is
redistributed here.
