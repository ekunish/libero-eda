# Release procedure

This procedure publishes a read-only static application and a separately
versioned public data repository. It deliberately has no reduced-data mode.

## 1. Export and validate data

Use the validated EDA environment from the source checkout:

```bash
SOURCE=/path/to/PARC2026_pre
STAGING=/path/to/libero-eda-hosted-v1

"$SOURCE/.venv-eda/bin/python" tools/export_hosted_data.py \
  --source-repo "$SOURCE" \
  --output "$STAGING"

"$SOURCE/.venv-eda/bin/python" tools/validate_hosted_data.py "$STAGING"
```

The exporter verifies pinned repositories, catalog revisions, entity counts,
and source assets. The validator then hashes every distributed artifact and
verifies both the browser manifest and the separate integrity index.

## 2. Publish the data snapshot

Copy the versioned files in `data-repository/` into the staging root, rerun the
exporter so it reseals those files, and validate again:

```bash
cp -a data-repository/. "$STAGING/"
"$SOURCE/.venv-eda/bin/python" tools/export_hosted_data.py \
  --source-repo "$SOURCE" \
  --output "$STAGING"
"$SOURCE/.venv-eda/bin/python" tools/validate_hosted_data.py "$STAGING"
```

Then use the current `hf upload` directory workflow. Exclude the local exporter
marker and uploader cache:

```bash
hf upload ekunish/libero-eda-data "$STAGING" \
  --repo-type dataset \
  --exclude '.cache/**' \
  --exclude '.libero-eda-export.json'
```

Do not deploy from `main`. Record the 40-character Hub commit produced after
the complete upload.

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
