---
license: other
pretty_name: LIBERO EDA Hosted Data
task_categories:
  - robotics
size_categories:
  - 10K<n<100K
tags:
  - libero
  - libero-plus
  - robotics
  - visual-language-action
---

# LIBERO EDA Hosted Data

Immutable, browser-oriented data for the LIBERO EDA web application.

This repository contains:

- metadata for 130 Original LIBERO task families;
- browser replay metadata for 6,500 Original LIBERO demonstrations and 14,347
  LIBERO-Plus training trajectories;
- gzip-compressed Arrow IPC trajectory series;
- 128 x 128 WebP thumbnails;
- derived Original LIBERO MP4 and MuJoCo GLB assets.

LIBERO-Plus training video is not duplicated. Replay manifests link to the
pinned `Sylvest/libero_plus_lerobot` revision. LIBERO-Plus evaluation
classification and BDDL files are also not copied; the application loads them
directly from `sylvestf/LIBERO-plus@4976dc30028e805ff8094b55501d532c48fec182`.

`manifest.json` is the small browser entry point for schema, counts, and
provenance. It pins `integrity/artifacts.json`, which records every distributed
file's byte size and SHA-256 value. Both are written only after a complete
export.

## License and attribution

This is a mixed-license dataset. Do not treat the repository as uniformly
Apache-2.0. See [DATA_LICENSES.md](DATA_LICENSES.md) before redistribution.

The Original LIBERO demonstration derivative retains the source attribution
and CC BY 4.0 requirements. LIBERO-Plus material retains its upstream MIT
license. LIBERO EDA's original catalog/export code is Apache-2.0.
