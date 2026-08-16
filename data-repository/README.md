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
- derived Original LIBERO MP4 and MuJoCo GLB assets;
- canonical Original LIBERO scene proxies and offline MuJoCo body-motion
  reconstructions for LIBERO-Plus training replays;
- finite official background/light candidate scenes and fail-closed video-match
  decisions for LIBERO-Plus training replays;
- content-addressed LIBERO-Plus evaluation geometry and source textures, plus
  numeric initial-state scene descriptors for all 10,030 evaluation conditions.

LIBERO-Plus training video is not duplicated. Replay manifests link to the
pinned `Sylvest/libero_plus_lerobot` revision. LIBERO-Plus evaluation
classification, BDDL, and init-state files are not copied; the application
loads definitions directly from
`sylvestf/LIBERO-plus@4976dc30028e805ff8094b55501d532c48fec182`.
The distributed scene descriptors were derived with official state index 0,
five zero actions, and a recorded environment/reset seed of 10,000. They retain
source-relative paths and SHA-256 provenance. If robosuite rejects a transient
constructor placement, the exporter advances the same seeded random stream
without reseeding, matching LIBERO's reset rejection sampling, and stops after
100 attempts.
The scene manifest also pins the simulator asset dataset to
`Sylvest/LIBERO-plus@dd2bd61b7d9a6fef1abc52d606e983b41886a149`, records the
source archive SHA-256, and requires the exact 448,799-file extraction before
export. The extraction is matched to the official archive by path, byte size,
CRC, and a deterministic content tree SHA-256. Symlinks and incomplete or
modified extracts are rejected.
The pinned tree digest (`libero-plus-asset-tree-sha256/v1`) is
`6c4c2e638f6401304f01b2573c80af41b35b6d94838df71f6ab91f59468b7ecb`.

Original LIBERO video is displayed in its recorded source orientation. The
published LIBERO-Plus MP4 convention is rotated 180 degrees from raw LIBERO;
each replay manifest declares that convention and the Replay UI restores the
simulator orientation by default. The source pixels are not rewritten.
The public LIBERO-Plus files are one MP4 per episode, so hosted v2 manifests
use a zero-based interval from `0` to `state_count / 20`. The one-way v1-to-v2
migration verifies the older chunk-global interval length before normalizing
it; video bytes are neither copied nor modified.

Hosted v3 adds approximate 3D context for all LIBERO-Plus training records.
12,609 of 14,347 episodes have a unique exact task, length, and float32 action
sequence match to a successful Original LIBERO demonstration; those records
reuse that demonstration's canonical scene and body motion as a proxy. The
remaining 1,738 episodes collapse to 207 unique action sequences and are
replayed offline through the pinned Original LIBERO MuJoCo environment. Results
are published only with their reconstruction method, source record, validation
metrics, and goal status. A failed reconstruction remains explicitly
unavailable. The Plus video and EEF trajectory are never replaced. These proxy
scenes do not recover the training record's Plus-specific textures, lighting,
camera settings, or hidden simulator state.

Hosted v4 treats the published training video as the appearance ground truth.
For the `env` and `light` RLDS path tags, it compares five source-video frames
against all 50 official candidates for that source task and category. Before
matching, every unique source front-video blob is checked against its
content-addressed SHA-256 filename and catalog byte size. A match
is published only when its normalized error, separation from the runner-up,
and frame-to-frame winner consistency all pass the declared gates. The exact
condition ID is an offline inference, not episode metadata from the public
training artifact. A record that fails any gate remains `unmatched` and is
rendered with neutral geometry; no nearest-candidate fallback is used. The
candidate scene supplies its materials, lights, local geometry, and fixed
agentview calibration. Robot and object motion continues to come from the
separately labelled v3 proxy; camera, language, and noise path tags retain the
canonical approximate appearance. If that proxy is unavailable but the
appearance match passes, the official candidate's initial body poses remain
available as a static scene. The recorded EEF trajectory continues to move;
robot and object bodies do not, because their motion was not published and no
replacement motion is fabricated.

The 4,000-candidate appearance library is the complete generated
background/light BDDL universe (50 per category for each of 40 source tasks).
It is not the balanced LIBERO-Plus evaluation subset: 1,076 background and
1,142 light conditions from that universe appear among the 10,030 evaluation
conditions. Keeping those populations separate is required because a training
video can match a generated condition that was not selected for evaluation.

Evaluation scenes are interactive initial states, not screenshots, videos, or
successful trajectories. Geometry is shared per Original LIBERO source task,
and textures are deduplicated by content hash.

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
