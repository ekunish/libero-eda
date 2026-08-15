# LIBERO EDA

A browser-based explorer for Original LIBERO demonstrations, LIBERO-Plus
training trajectories, and LIBERO-Plus evaluation conditions.

The hosted application is intentionally read-only. It has no DuckDB server,
GPU job runner, model-run registry, or media proxy. Metadata and derived replay
assets are loaded from a pinned Hugging Face dataset. Evaluation classifications
and BDDL definitions are fetched directly from a pinned official LIBERO-Plus
GitHub revision.

Hosted data snapshot:
[`ekunish/libero-eda-data@9146d92`](https://huggingface.co/datasets/ekunish/libero-eda-data/tree/9146d9262c43a4dc10523d0c15baa83e01a2249f).

## Workspaces

- **Recorded Data** — 6,500 Original LIBERO demonstrations and 14,347
  LIBERO-Plus training trajectories.
- **Evaluation** — the 10,030 LIBERO-Plus evaluation conditions, seven
  categories, and published difficulty labels.
- **Sources** — exact repositories, revisions, structures, counts, and data
  lineage.
- **Replay** — synchronized front/wrist video, 3D scene when available, and
  trajectory/action plots. Original video keeps its recorded orientation;
  LIBERO-Plus declares its published 180-degree convention and is shown in raw
  simulator orientation by default.

PARC Track 1 and local experiment management are deliberately outside the
scope of this public repository.

## Local development

Requirements: Node.js 22.13+ or 24+, and pnpm 11.21.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The released immutable manifest is the default. To inspect another complete
export, copy `.env.example` to `.env.local` and replace `REVISION` with its
40-character Hub commit before starting the app.

The manifest URL must identify a complete `libero-eda-hosted/v1` export. A
missing, malformed, or count-mismatched manifest stops the application; there
is no reduced-data fallback.

## Validation

```bash
pnpm check
pnpm test
pnpm test:storybook
pnpm build
```

The migration exporter is a fail-closed bridge from the original validated EDA
catalog:

```bash
/path/to/PARC2026_pre/.venv-eda/bin/python tools/export_hosted_data.py \
  --source-repo /path/to/PARC2026_pre \
  --output /path/to/new-empty-or-owned-export
```

It verifies source revisions and catalog counts, writes the top-level manifest
last, and refuses to reuse an output directory without its ownership marker.

## Hosted architecture

`next build` exports only static HTML, JavaScript, CSS, and fonts. The browser
loads a small, immutable manifest and derived replay artifacts from Hugging
Face, plus evaluation definitions from a pinned official GitHub revision.
There is no deployed database or server function, so the public site fits a
noncommercial Vercel Hobby deployment. See [docs/RELEASE.md](docs/RELEASE.md)
for the fail-closed release sequence.

Set `NEXT_PUBLIC_LIBERO_EDA_DATA_MANIFEST` to an immutable Hugging Face commit
URL when deploying a different export. Never point production at `main`.

## License

Source code: Apache License 2.0, Copyright 2026 ekunish.

Third-party data and benchmark definitions retain their own licenses and
attribution requirements. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
