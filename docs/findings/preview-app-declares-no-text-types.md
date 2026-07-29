# Preview.app cannot open the file types tasks mostly produce

**Status:** closed. Working as designed, nothing to fix in our code. Recorded 2026-07-28.

## Context

The "Open with" menu ([file-open-target.ts](../../apps/studio/src/electron-main/lib/file-open-target.ts)) offers Preview for PDFs and images but never for Markdown, source, CSV, or SVG. That reads like a bug in our curation policy, and it is the kind of thing someone will try to "fix" by adding Preview to a list in [candidate-policy.ts](../../apps/studio/src/electron-main/lib/file-open-target/candidate-policy.ts). It cannot be fixed there, and forcing it produces something worse than the omission.

## What we found

**Nothing in our code filters Preview.** Running the production `DARWIN_CANDIDATES_SCRIPT` unmodified against real files on macOS 26.5:

| Type                                              | Preview offered?         |
| ------------------------------------------------- | ------------------------ |
| `.pdf` `.png` `.jpg` `.heic` `.webp`              | yes, flagged `isDefault` |
| `.svg` `.md` `.txt` `.json` `.csv` `.html` `.mp4` | absent                   |

Neither `EXCLUDED_BUNDLE_IDS` nor `RESTRICTED_BUNDLE_IDS` mentions `com.apple.Preview`, and the structural filters in the enumeration script (nested bundles, cache directories, `LSUIElement` agents) do not match `/System/Applications/Preview.app`.

**The absence is Launch Services being accurate.** Preview's `Info.plist` declares 48 `CFBundleDocumentTypes`, all PDF, PostScript, and raster-image UTIs plus `public.folder` and `com.apple.application-bundle`. There is no `public.plain-text`, no `public.svg-image`, and no source-code UTI among them:

```
plutil -extract CFBundleDocumentTypes json -o - /System/Applications/Preview.app/Contents/Info.plist | jq length
# 48
```

**Forcing it produces a silent no-op, not an error.** `open -a Preview file.md` and `open -a Preview file.svg` both exit 0 and launch Preview with **zero windows**: no document, no error dialog, just a bounced icon. Verified through System Events, which reports an empty window list for the process. Hardcoding Preview for those types would ship a menu row that visibly does nothing, which is worse than not offering it.

**One place Preview disappears by our own choice.** The split-button caret passes `omitDefault` ([open-with-menu.tsx](../../apps/studio/src/client/components/open-with-menu.tsx)), so on a stock Mac a PNG's dropdown lists everything _except_ Preview, because Preview is the default. Finder by contrast keeps the default in its list and tags it. That is a deliberate product call for a split button whose primary half already launches the default, not the same issue as the above.

## What would actually help

Quick Look, not Preview.app. It handles Office documents, Markdown, source, and CSV, which is precisely the set Preview cannot open, plus everything Preview can. `BrowserWindow.previewFile(path, displayName)` and `closeFilePreview()` are macOS-only Electron APIs, present in the pinned version, and unused in this repo today. One main-process call, no Launch Services work, no icon pipeline. The natural binding is Space in the file grid, alongside the existing path scoping in [utils.ts](../../apps/studio/src/electron-main/rpc/routes/utils.ts).

Caveat: macOS-only, with no Windows or Linux equivalent, so it would be another platform-gated affordance like `showOpenWith` already is.

## Related

- [file-open-cache-is-sized-for-a-vanished-cost.md](./file-open-cache-is-sized-for-a-vanished-cost.md): the other open question in this subsystem
