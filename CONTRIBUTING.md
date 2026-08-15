# Contributing

Use pnpm and keep the hosted application read-only. New data sources must have
an immutable revision, explicit license/provenance, a validator, and tests.
Missing metadata or failed validation must stop the build; do not add silent
fallbacks or partial-data modes.

Before opening a change, run:

```bash
pnpm check
pnpm test
pnpm test:storybook
pnpm build
```
