# Changes

Screenshot-backed summaries of user-visible product changes. They show design what changed and where so people can target follow-up work. They may inform release notes or a changelog, but they are not an exhaustive chronological log.

## Index

Newest first.

- [2026-08-12: v1.6 beta](2026-08-12-v1.6-beta/README.md) covers `v1.5.0..v1.6.0-beta.4`.
- [2026-08-03: v1.5](2026-08-03-v1.5/README.md) covers `v1.4.4..v1.5.0`.

## Format

Each change review can cover a release, a beta series, or another useful commit or date range. Its folder starts with the date the snapshot was captured so entries sort chronologically even when their scopes differ.

```text
changes/
└── YYYY-MM-DD-<scope>/
    ├── README.md
    └── images/
```

Use `README.md` for the collection and every entry so GitHub renders the overview when a human opens the folder. The root `AGENTS.md` and the `find-ui-changes` skill hold agent instructions. Add a nested `AGENTS.md` only if this subtree develops editing rules that differ from the rest of the repository.

State the exact range and screenshot checkpoint. For each review-worthy surface, include its human app location, one concise description, source commit links, one tightly cropped screenshot when available, and a copyable repo-context block. Preserve historical reviews as snapshots; make only factual or link corrections after their range has shipped.

Keep screenshots in the repository by default so each review remains stable, reviewable, and tied to the commits it describes. Crop to the changed surface and avoid credentials, local paths, personal data, or unrelated task content. PNG is a good default for text-heavy UI; WebP is reasonable when it materially reduces a photographic or unusually large image. As a soft budget, aim for less than 1 MiB per image and 5 MiB per review before considering stronger compression or external storage.

For a quick lossless PNG pass, prefer [OxiPNG](https://github.com/oxipng/oxipng) at its fast default optimization level: `oxipng -o 2 --strip safe images/*.png`. Avoid maximum-effort or Zopfli modes by default; small additional savings are not worth turning routine capture into a long-running step.
