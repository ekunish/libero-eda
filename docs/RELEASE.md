# Release procedure

This procedure publishes a read-only static application and a separately
versioned public data repository. It deliberately has no reduced-data mode.

## 1. Export and validate data

Use the validated EDA environment from the source checkout:

```bash
SOURCE=/path/to/PARC2026_pre
BASE=/path/to/libero-eda-hosted-v1
SCENES=/path/to/libero-evaluation-scenes-v1
STAGING=/path/to/libero-eda-hosted-v2
SPARSE_V2=/path/to/libero-eda-hosted-v2-metadata
RECON_INPUT=/path/to/libero-plus-reconstruction-input
RECON_OUTPUT=/path/to/libero-plus-reconstructions
RELEASE_V3=/path/to/libero-eda-hosted-v3-patch
APPEARANCE_CANDIDATES=/path/to/libero-plus-appearance-candidates
APPEARANCE_MATCHES=/path/to/libero-plus-appearance-matches
RELEASE=/path/to/libero-eda-hosted-v4-patch

"$SOURCE/.venv-eda/bin/python" tools/export_hosted_data.py \
  --source-repo "$SOURCE" \
  --output "$BASE"

LIBERO_CONFIG_PATH="$SOURCE/.parc/libero-eval" \
MUJOCO_GL=osmesa \
PYTHONPATH="$SOURCE/LIBERO-plus:$SOURCE" \
"$SOURCE/.venv-eval/bin/python" tools/export_evaluation_scenes.py \
  --source-repo "$SOURCE" \
  --hosted-root "$BASE" \
  --output "$SCENES"

"$SOURCE/.venv-eda/bin/python" tools/upgrade_hosted_data_v2.py \
  --source-v1 "$BASE" \
  --evaluation-scenes "$SCENES" \
  --output "$STAGING"

"$SOURCE/.venv-eda/bin/python" tools/prepare_training_reconstructions.py \
  --source-repo "$SOURCE" \
  --output "$RECON_INPUT"

LIBERO_CONFIG_PATH="$SOURCE/.parc/libero-original-eda" \
MUJOCO_GL=egl \
PYTHONPATH="$SOURCE/LIBERO:$SOURCE" \
"$SOURCE/.venv-eval/bin/python" tools/simulate_training_reconstructions.py \
  --source-repo "$SOURCE" \
  --input "$RECON_INPUT" \
  --output "$RECON_OUTPUT"

"$SOURCE/.venv-eda/bin/python" tools/upgrade_hosted_data_v3.py \
  --source-v2 "$STAGING" \
  --reconstructions "$RECON_OUTPUT" \
  --output "$RELEASE_V3"

LIBERO_CONFIG_PATH="$SOURCE/.parc/libero-eval" \
MUJOCO_GL=osmesa \
PYTHONPATH="$SOURCE/LIBERO-plus:$SOURCE" \
"$SOURCE/.venv-eval/bin/python" tools/export_training_appearance_candidates.py \
  --source-repo "$SOURCE" \
  --hosted-root "$RELEASE_V3" \
  --output "$APPEARANCE_CANDIDATES"

"$SOURCE/.venv-eda/bin/python" tools/match_training_appearances.py \
  --source-repo "$SOURCE" \
  --hosted-root "$RELEASE_V3" \
  --candidates "$APPEARANCE_CANDIDATES" \
  --output "$APPEARANCE_MATCHES"

"$SOURCE/.venv-eda/bin/python" tools/upgrade_hosted_data_v4.py \
  --source-v3 "$RELEASE_V3" \
  --candidates "$APPEARANCE_CANDIDATES" \
  --matches "$APPEARANCE_MATCHES" \
  --output "$RELEASE"

"$SOURCE/.venv-eda/bin/python" tools/validate_hosted_patch_v4.py "$RELEASE" \
  --base-v3 "$RELEASE_V3"
```

The exporter verifies pinned repositories, catalog revisions, entity counts,
and the complete 448,799-file simulator asset tree. The evaluation exporter
follows official state index 0 and
five zero actions, with environment/reset seed 10,000 recorded explicitly,
without rasterizing video or screenshots. Constructor placements use LIBERO's
rejection-sampling behavior: the seeded stream advances without reseeding and
the export stops if no placement succeeds within 100 attempts. The validator then
hashes every distributed artifact, checks all 10,030 scene descriptors and all
40 geometry packs, and verifies both the browser manifest and the separate
integrity index.

The training reconstruction stage hashes all 14,347 published action streams,
requires unique exact matches for the Original-demo proxy path, and validates
all remaining MuJoCo replays against the recorded EEF trajectory. Video and EEF
series remain source data; reconstructed joints and object motion are stored in
separate assets with explicit method and error metadata. No Plus-specific
texture, light, camera, or hidden state is inferred by the motion stage.

The appearance stage is separate. For the published `env` and `light` path
tags, it renders the finite 50-candidate official set for each source task and
first verifies every unique source front-video blob against its content-addressed
SHA-256 filename and catalog byte size, then compares five video frames. It
publishes a candidate only after absolute
error, runner-up margin, multi-frame consistency, and candidate
self-identifiability all pass. The exact condition ID is an inference rather
than published episode metadata. Unmatched records remain unmatched and use
neutral geometry; no nearest-candidate fallback is permitted. Offline RGB and
segmentation reference banks are excluded from the public release.
An accepted appearance may still lack an accepted body-motion proxy. In that
case the official candidate supplies only a static initial scene and fixed
camera beside the recorded EEF trajectory. The release must not synthesize
robot or object motion to fill that gap.
The 4,000 rendered candidates are the complete generated BDDL universe, not
the balanced evaluation selection. The latter contains 1,076 background and
1,142 light conditions; training matching must not discard valid generated
conditions merely because they were excluded from that evaluation subset.

For a release derived from an already validated immutable v2 commit, download
only its root manifest, integrity index, catalog indexes, and 130 task shards.
Then add `--sparse-source` to the v3 command. The upgrader requires the complete
v2 integrity index and stages a patch whose unchanged artifacts are inherited
from that exact base commit; it does not silently omit them from the new
integrity contract. Validate that patch independently before upload:

```bash
"$SOURCE/.venv-eda/bin/python" tools/validate_hosted_patch.py "$RELEASE_V3" \
  --base-v2 "$SPARSE_V2"
```

## 2. Publish the data snapshot

Keep the validated v1 input immutable. The v2 upgrader copies the versioned
files in `data-repository/` into a fresh `STAGING` directory and seals them with
the scene artifacts. It also verifies and normalizes legacy chunk-global
LIBERO-Plus timestamps to the zero-based timebase of the public per-episode
MP4s. Series gzip headers are normalized to omit temporary filenames and
process identifiers while preserving the decompressed Arrow payload:

```bash
"$SOURCE/.venv-eda/bin/python" tools/upgrade_hosted_data_v2.py \
  --source-v1 "$BASE" \
  --evaluation-scenes "$SCENES" \
  --output "$STAGING"
"$SOURCE/.venv-eda/bin/python" tools/upgrade_hosted_data_v3.py \
  --source-v2 "$STAGING" \
  --reconstructions "$RECON_OUTPUT" \
  --output "$RELEASE_V3"
"$SOURCE/.venv-eda/bin/python" tools/validate_hosted_data.py "$RELEASE_V3"
```

Create a release branch from the last immutable v3 snapshot. Upload new and
rewritten artifacts first, the integrity index second to last, and the v4
manifest last. Until the final command, the branch continues to expose its
inherited valid v3 manifest instead of a partial v4 release:

```bash
DATA_REPO=ekunish/libero-eda-data
DATA_BRANCH=v0.4.0-data
BASE_REVISION=d0707eeceeac4680f1decd5f434160afca9b134b

hf repos branch create "$DATA_REPO" "$DATA_BRANCH" \
  --type dataset --revision "$BASE_REVISION"
hf upload "$DATA_REPO" "$RELEASE/training-appearances" training-appearances \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Add validated training appearance matches'
hf upload "$DATA_REPO" "$RELEASE/catalog/tasks" catalog/tasks \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Attach appearance match metadata'
hf upload "$DATA_REPO" "$RELEASE/catalog/sources.json" catalog/sources.json \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Clarify appearance inference sources'
hf upload "$DATA_REPO" "$RELEASE/README.md" README.md \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Update data documentation'
hf upload "$DATA_REPO" "$RELEASE/DATA_LICENSES.md" DATA_LICENSES.md \
  --type dataset --revision "$DATA_BRANCH"
hf upload "$DATA_REPO" "$RELEASE/LICENSES" LICENSES \
  --type dataset --revision "$DATA_BRANCH"
hf upload "$DATA_REPO" "$RELEASE/integrity/artifacts.json" integrity/artifacts.json \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Seal v4 integrity index'
hf upload "$DATA_REPO" "$RELEASE/manifest.json" manifest.json \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Publish hosted v4 manifest'
```

Do not configure the application with a mutable `main` URL. Record the
40-character Hub commit produced by the final manifest upload, validate every
indexed remote file against that exact revision, then create the `v0.4.0` data
tag from it:

```bash
"$SOURCE/.venv-eval/bin/python" tools/validate_hosted_remote.py "$DATA_REPO" \
  --revision "$FINAL_DATA_REVISION"
hf repos tag create "$DATA_REPO" v0.4.0 --type dataset \
  --revision "$FINAL_DATA_REVISION" --message 'LIBERO EDA hosted data v0.4.0'
```

## 3. Pin, verify, and deploy the app

Set `NEXT_PUBLIC_LIBERO_EDA_DATA_MANIFEST` to the exact Hub commit URL, then
run every gate before deploying:

```bash
pnpm check
pnpm test
pnpm test:storybook
pnpm build
LIBERO_EDA_E2E_BASE_URL=https://your-preview.example pnpm test:e2e
```

For a protected Vercel preview, provide its project-scoped
`VERCEL_AUTOMATION_BYPASS_SECRET`; Playwright uses the documented protection
header once to establish a scoped bypass cookie before browser tests. Do not
disable preview protection for testing.

Production deployment is allowed only when the data validator and all web
gates succeed. A missing source, malformed manifest, count mismatch, or test
failure stops the release.
