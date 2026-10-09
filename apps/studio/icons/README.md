# Studio app icons

## Output folder

`../resources/instrument-folder.svg` is the editable vector artwork for the default `Documents/Instrument` folder on macOS and Linux. It includes a static paper inset regardless of folder contents. Studio embeds the SVG in its main-process bundle and supplies it to AppKit on macOS, which generates the Finder icon representations.

Windows uses `../resources/instrument-folder-windows.svg`, with a stepped front flap, exported to the bundled multi-size `instrument-folder-windows.ico`. Regenerate it on macOS with `node apps/studio/scripts/generate-folder-icon.ts` from the repository root; this requires AppKit and ImageMagick. Studio copies the icon into the folder, writes a Unicode `desktop.ini`, sets the Shell attributes, and notifies Explorer.

Linux writes a hidden SVG and a `.directory` entry for KDE. When GIO is available, it also sets `metadata::custom-icon` for GNOME Files and compatible file managers. Support depends on the file manager and desktop metadata service; there is no universal Linux folder-icon API.

The chat's agent requests decoration after creating and attaching its default output folder. Icon assignment is best-effort, skips symlinked folders and other locations, and preserves existing custom icons and customization files. Headless workspaces do not apply it. The Windows and Linux asset files stay beside the folder metadata so their paths survive app updates.

## App artwork

Source artwork lives in `source/`:

- `instrument-solid-square.png` — full-bleed square for macOS 26+ (Tahoe). Used to build `build/icon.icon`.
- `instrument-solid-rounded.png` — designer-provided squircle for macOS before 26, Windows, and Linux.

`icons:generate` also writes `build/flavors/`: the same artwork recolored for builds that are not the shipping app (`APP_FLAVOR`). A preview gets a full purple set, which `electron-builder.ts` packages in place of the shipping one, and a development run gets a slate Dock icon it sets at launch.

Regenerate packaged icons after changing sources:

```bash
pnpm --filter @instrument-org/studio icons:generate
pnpm --filter @instrument-org/studio icons:check
```

Requires **ImageMagick** (`magick`) and **iconutil** (macOS). macOS release builds need **macOS 26 + Xcode 26+** so `actool` can compile `build/icon.icon`. CI uses `macos-26` / `macos-26-intel` runners (default Xcode 26.x on those images).

Optional: refine `build/icon.icon` in [Icon Composer](https://developer.apple.com/icon-composer/) (GUI). The script seeds a flat bundle; Liquid Glass tuning is easier there.
