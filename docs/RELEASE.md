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

"$SOURCE/.venv-eda/bin/python" tools/validate_hosted_data.py "$STAGING"
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
"$SOURCE/.venv-eda/bin/python" tools/validate_hosted_data.py "$STAGING"
```

Create a release branch from the last immutable snapshot. Upload new and
rewritten artifacts first, the integrity index second to last, and the v2
manifest last. Until the final command, the branch continues to expose its
inherited valid v1 manifest instead of a partial v2 release:

```bash
DATA_REPO=ekunish/libero-eda-data
DATA_BRANCH=v0.2.0-data
BASE_REVISION=9146d9262c43a4dc10523d0c15baa83e01a2249f

hf repos branch create "$DATA_REPO" "$DATA_BRANCH" \
  --type dataset --revision "$BASE_REVISION"
hf upload "$DATA_REPO" "$STAGING/evaluation-scenes" evaluation-scenes \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Add evaluation scene assets'
hf upload-large-folder "$DATA_REPO" "$STAGING" \
  --type dataset --revision "$DATA_BRANCH" --include 'assets/series/**'
hf upload "$DATA_REPO" "$STAGING/catalog/tasks" catalog/tasks \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Normalize replay timebases'
hf upload "$DATA_REPO" "$STAGING/catalog/sources.json" catalog/sources.json \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Update source registry'
hf upload "$DATA_REPO" "$STAGING/README.md" README.md \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Update data documentation'
hf upload "$DATA_REPO" "$STAGING/DATA_LICENSES.md" DATA_LICENSES.md \
  --type dataset --revision "$DATA_BRANCH"
hf upload "$DATA_REPO" "$STAGING/LICENSES" LICENSES \
  --type dataset --revision "$DATA_BRANCH"
hf upload "$DATA_REPO" "$STAGING/integrity/artifacts.json" integrity/artifacts.json \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Seal v2 integrity index'
hf upload "$DATA_REPO" "$STAGING/manifest.json" manifest.json \
  --type dataset --revision "$DATA_BRANCH" --commit-message 'Publish hosted v2 manifest'
```

Do not configure the application with a mutable `main` URL. Record the
40-character Hub commit produced by the final manifest upload, validate that
exact revision, then create the `v0.2.0` data tag from it.

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
