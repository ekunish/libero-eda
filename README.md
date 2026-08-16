# LIBERO EDA

A browser-based explorer for Original LIBERO demonstrations, LIBERO-Plus
training trajectories, and LIBERO-Plus evaluation conditions.

The hosted application is intentionally read-only. It has no DuckDB server,
GPU job runner, model-run registry, or media proxy. Metadata and derived replay
assets are loaded from a pinned Hugging Face dataset. Evaluation classifications
and BDDL definitions come from a pinned official LIBERO-Plus GitHub revision;
the hosted data snapshot also contains validated, interactive initial-state
scene reconstructions derived from that same revision.

Hosted data snapshot:
[`ekunish/libero-eda-data@e42cf01`](https://huggingface.co/datasets/ekunish/libero-eda-data/tree/e42cf0101811f5f922a0f0122e8d4890ef200180).

## Workspaces

- **Recorded Data** — 6,500 Original LIBERO demonstrations and 14,347
  LIBERO-Plus training trajectories.
- **Evaluation** — the 10,030 LIBERO-Plus evaluation conditions, seven
  categories, published difficulty labels, BDDL success predicates, and an
  orbitable initial 3D scene for every condition. Each scene uses official
  state index 0 followed by the five zero actions used by the official task
  renderer. Environment construction and reset use LIBERO's default seed
  10,000 so the published descriptor is reproducible; it is not a recorded
  rollout.
- **Sources** — exact repositories, revisions, structures, counts, and data
  lineage.
- **Replay** — synchronized front/wrist video, 3D scene when available, and
  trajectory/action plots. Original video keeps its recorded orientation;
  LIBERO-Plus declares its published 180-degree convention and is shown in raw
  simulator orientation by default. LIBERO-Plus training records also expose a
  validated, explicitly approximate canonical 3D reconstruction: the published
  video and EEF series remain source data, while robot joints and object motion
  come from an exact Original-action match or an offline MuJoCo replay.
  For records tagged `env` or `light`, appearance is shown only when a
  five-frame offline comparison passes absolute-error, runner-up-margin, and
  multi-frame consistency gates against the finite official candidate set.
  This is an inference, not a condition ID published with the episode. Failed
  matches use neutral geometry; camera, language, and noise tags keep the
  explicitly approximate canonical appearance. When a validated appearance
  match has no accepted body-motion proxy, Replay shows the official
  candidate's initial body poses as a static scene beside the recorded EEF
  trajectory; it does not invent robot or object motion. The v0.4 data release
  accepts 1,002 matches, leaves 4,750 `env`/`light` records explicitly
  unmatched, and marks the other 8,595 records not applicable. The 4,000
  generated candidates are distinct from the balanced evaluation subset,
  which contains 1,076 background and 1,142 light conditions.

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

The manifest URL must identify a complete `libero-eda-hosted/v4` export. A
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
catalog. Evaluation scenes are exported separately so they can be resumed by
source task, then both inputs are sealed into hosted v2. Training-scene
reconstruction is a separate offline stage: it groups the 1,738 Plus episodes
without an exact Original action match into 207 unique action sequences, runs
the official controller in the pinned simulator, and seals validated results
into v3. Hosted v4 then adds separately validated background/light appearance
matches without changing the recorded video or motion series:

```bash
/path/to/PARC2026_pre/.venv-eda/bin/python tools/export_hosted_data.py \
  --source-repo /path/to/PARC2026_pre \
  --output /path/to/hosted-v1

LIBERO_CONFIG_PATH=/path/to/PARC2026_pre/.parc/libero-eval \
MUJOCO_GL=osmesa \
PYTHONPATH=/path/to/PARC2026_pre/LIBERO-plus:/path/to/PARC2026_pre \
/path/to/PARC2026_pre/.venv-eval/bin/python tools/export_evaluation_scenes.py \
  --source-repo /path/to/PARC2026_pre \
  --hosted-root /path/to/hosted-v1 \
  --output /path/to/evaluation-scenes

/path/to/PARC2026_pre/.venv-eda/bin/python tools/upgrade_hosted_data_v2.py \
  --source-v1 /path/to/hosted-v1 \
  --evaluation-scenes /path/to/evaluation-scenes \
  --output /path/to/hosted-v2

/path/to/PARC2026_pre/.venv-eda/bin/python tools/prepare_training_reconstructions.py \
  --source-repo /path/to/PARC2026_pre \
  --output /path/to/reconstruction-input

LIBERO_CONFIG_PATH=/path/to/PARC2026_pre/.parc/libero-original-eda \
MUJOCO_GL=egl \
PYTHONPATH=/path/to/PARC2026_pre/LIBERO:/path/to/PARC2026_pre \
/path/to/PARC2026_pre/.venv-eval/bin/python tools/simulate_training_reconstructions.py \
  --source-repo /path/to/PARC2026_pre \
  --input /path/to/reconstruction-input \
  --output /path/to/reconstructions

/path/to/PARC2026_pre/.venv-eda/bin/python tools/upgrade_hosted_data_v3.py \
  --source-v2 /path/to/hosted-v2 \
  --reconstructions /path/to/reconstructions \
  --output /path/to/hosted-v3

/path/to/PARC2026_pre/.venv-eda/bin/python tools/validate_hosted_data.py \
  /path/to/hosted-v3

LIBERO_CONFIG_PATH=/path/to/PARC2026_pre/.parc/libero-eval \
MUJOCO_GL=osmesa \
PYTHONPATH=/path/to/PARC2026_pre/LIBERO-plus:/path/to/PARC2026_pre \
/path/to/PARC2026_pre/.venv-eval/bin/python \
  tools/export_training_appearance_candidates.py \
  --source-repo /path/to/PARC2026_pre \
  --hosted-root /path/to/hosted-v3 \
  --output /path/to/appearance-candidates

/path/to/PARC2026_pre/.venv-eda/bin/python tools/match_training_appearances.py \
  --source-repo /path/to/PARC2026_pre \
  --hosted-root /path/to/hosted-v3 \
  --candidates /path/to/appearance-candidates \
  --output /path/to/appearance-matches

/path/to/PARC2026_pre/.venv-eda/bin/python tools/upgrade_hosted_data_v4.py \
  --source-v3 /path/to/hosted-v3 \
  --candidates /path/to/appearance-candidates \
  --matches /path/to/appearance-matches \
  --output /path/to/hosted-v4
```

When v3 is published as a patch over an immutable, already validated v2 Hub
commit, `upgrade_hosted_data_v3.py --sparse-source` validates the complete v2
integrity index and stages only changed files. After upload,
`tools/validate_hosted_remote.py` checks all indexed remote sizes and SHA-256
values at the final 40-character Hub commit, including inherited LFS/Xet
objects.

The exporters verify source revisions, exact category and entity counts,
initialization contracts, content-addressed geometry and textures, and every
distributed artifact SHA-256. The top-level manifest is written last, and an
output directory without the exact ownership marker is never reused.

## Hosted architecture

`next build` exports only static HTML, JavaScript, CSS, and fonts. The browser
loads a small, immutable manifest and derived replay artifacts from Hugging
Face, plus evaluation definitions from a pinned official GitHub revision.
Evaluation geometry is shared per source task and textures are content
addressed globally; 10,030 screenshots are neither generated nor distributed.
There is no deployed database or server function, so the public application is
served as a static site. See [docs/RELEASE.md](docs/RELEASE.md) for the
fail-closed release sequence.

Set `NEXT_PUBLIC_LIBERO_EDA_DATA_MANIFEST` to an immutable Hugging Face commit
URL when deploying a different export. Never point production at `main`.

## License

Source code: Apache License 2.0, Copyright 2026 ekunish.

Third-party data and benchmark definitions retain their own licenses and
attribution requirements. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
