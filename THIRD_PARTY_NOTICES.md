# Third-party data and assets

The Apache-2.0 license in this repository covers the LIBERO EDA source code.
It does not replace the licenses of data, benchmark definitions, models, or
assets loaded by the application.

| Material | Pinned source | Treatment |
| --- | --- | --- |
| Original LIBERO task definitions and simulator assets | `Lifelong-Robot-Learning/LIBERO@8f1084e…` | MIT; the data repository preserves the upstream license text for reconstructed GLB scenes. |
| Original LIBERO demonstrations and derived replay media | `yifengzhu-hf/LIBERO-datasets@f13aa24…` | Distributed in the data repository under CC BY 4.0 attribution requirements recorded by the source manifest. |
| LIBERO-Plus training trajectories | `Sylvest/libero_plus_lerobot@22c5743…`, validated against `lerobot/libero_plus@f3f49f4…` | Loaded from the pinned upstream dataset; the source card declares MIT. |
| LIBERO-Plus RLDS provenance | `Sylvest/libero_plus_rlds@fb0c702…` | Metadata-derived labels only; the source card declares MIT. |
| LIBERO-Plus evaluation definitions | `sylvestf/LIBERO-plus@4976dc3…` | Fetched directly at runtime. They are not copied into this repository or the hosted data repository because the GitHub source does not publish a repository license. |
| LIBERO-Plus simulator assets | `Sylvest/LIBERO-plus` | Not redistributed by this code repository; the dataset card declares MIT. |

Exact URLs, revisions, counts, and consumed structures are exposed in the
application's **Sources** workspace.

## Web dependencies

The deployed site embeds Noto Sans JP from `@fontsource-variable/noto-sans-jp`
under the SIL Open Font License 1.1. The required notice is distributed at
[`public/licenses/NOTO-SANS-JP-OFL-1.1.txt`](public/licenses/NOTO-SANS-JP-OFL-1.1.txt).
Other JavaScript package licenses and exact versions are recorded by
`pnpm-lock.yaml` and the packages' own license metadata.
