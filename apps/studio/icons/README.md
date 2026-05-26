# Studio app icons

Source artwork lives in `source/`:

- `instrument-solid-square.png` — full-bleed square for macOS 26+ (Tahoe). Used to build `build/icon.icon`.
- `instrument-solid-rounded.png` — designer-provided squircle for macOS before 26, Windows, and Linux.

Regenerate packaged icons after changing sources:

```bash
pnpm --filter @instrument-org/studio icons:generate
pnpm --filter @instrument-org/studio icons:check
```

Requires **ImageMagick** (`magick`) and **iconutil** (macOS). macOS release builds also need **Xcode** so electron-builder can run `actool` on `build/icon.icon`.

Optional: refine `build/icon.icon` in [Icon Composer](https://developer.apple.com/icon-composer/) (GUI). The script seeds a flat bundle; Liquid Glass tuning is easier there.
