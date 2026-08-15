# Security policy

The deployed application is a static export and has no server-side data parser.
Do not run the development toolchain on untrusted repository contents or image
files. Storybook currently depends transitively on `image-size@2.0.2`, for which
the upstream advisory has no patched release as of 2026-08-15; it is not part of
the production application bundle.

Report suspected vulnerabilities privately through GitHub's security advisory
workflow. Do not include access tokens, private dataset URLs, or unpublished
artifacts in a public issue.

LIBERO EDA is read-only and does not accept user-uploaded files or execute model
code. External data origins are fixed at build time and validated by schema and
count before use.
