# Plan: Word, PowerPoint and Excel files through LibreOffice, fetched on first need

Status: open. Phases 1, 2, 3 and 5 are built and checked through `run-bash` on an Apple-silicon Mac, an arm64 Ubuntu host, and arm64 and x64 Windows 11 hosts; phase 4 (skills), the packaged-app checks and the evals remain. See [What is not yet checked](#what-is-not-yet-checked).

Related: [render-a-file-to-look-at-it.md](render-a-file-to-look-at-it.md), which this plan complements and narrows (see [How this fits the render plan](#how-this-fits-the-render-plan)); [document-viewers.md](document-viewers.md) and [the pdfium decision](../decisions/2026-07-31-pdfium-is-the-pdf-engine.md), which render for the person, not the agent; [agent-sandbox.md](../architecture/agent-sandbox.md) and [programs on the PATH run natively](../decisions/2026-10-12-programs-on-path-run-natively.md), which hold whatever this adds.

## Problem

The agent writes `.docx`, `.pptx` and `.xlsx` files blind. In the eval transcripts on record it wrote 282 scripts touching `.xlsx`, 88 touching `.docx` and 76 touching `.pptx`, and for most of them nothing on the machine can show it the result or compute it:

- **Workbooks have no values.** openpyxl writes a formula with no cached result, so a workbook the agent builds holds `=SUM(B2:B9)` and nothing else until some program recalculates it. `openpyxl` with `data_only=True`, `pandas.read_excel` and any viewer that does not calculate see blanks, and the agent cannot check its own numbers. The spreadsheet skill already says "Never claim formula results were recalculated unless Excel or LibreOffice actually recalculated them", with nothing behind it.
- **Layout is unchecked.** The docx and powerpoint skills lay a file out in the agent's browser with the same renderer the app's viewers use (`preview.py`), loaded from a CDN. That covers Word and PowerPoint when the computer is online; it does nothing for a workbook, and it is not how Word or a PDF export will lay the document out.
- **No conversion.** A legacy `.doc`, `.xls` or `.ppt` the person sends cannot be opened by python-docx, openpyxl or python-pptx at all, and "send it to me as a PDF" has no road for Word or PowerPoint files. The spreadsheet skill routes `.xls` through SheetJS; nothing does the same for `.doc` and `.ppt`.

LibreOffice in headless mode does all three, on every platform we ship. Codex's desktop app reached the same conclusion: it downloads an on-demand runtime holding a headless LibreOffice 25.2 build (about 414 MB on disk), poppler, a Python with python-docx, python-pptx, openpyxl and pypdf, and a Node with docx, pptxgenjs and sharp. It puts a `soffice` wrapper first on the agent's PATH that adds a throwaway profile (`-env:UserInstallation`) to any call that lacks one, and its document skill renders with it.

## Decisions already made

- **Download, never bundle.** The stock build is about 300 MB to download and 800 MB on disk; most people never need it, and the installer stays as it is.
- **Stock builds from The Document Foundation**, pinned by version and SHA-256 per platform. No build of our own: a trimmed headless build (`--disable-gui`) is possible, but its own configure help warns against it, it has shipped with `--convert-to` broken ([a distribution bug](https://bugs.launchpad.net/ubuntu/+source/libreoffice/+bug/2039021), [mailing list](https://lists.freedesktop.org/archives/libreoffice/2019-June/082934.html)), and it would make us the signer and notarizer of 800 MB of someone else's code on three platforms. Codex's trimmed build saves about half the disk; that is not worth owning a LibreOffice build pipeline.
- **No macros.** Recalculation uses LibreOffice's own load setting, not a Basic macro in the profile, so the profile can set macro security to its highest level and no document code ever runs.
- **The deliverable stays the agent's file.** Recalculation writes values into the workbook the agent made; it does not replace it with LibreOffice's re-export (see [Recalculation](#recalculation)).
- **Same rules as every program.** `soffice` runs under the chat's Seatbelt or bubblewrap profile like `python`, and unconfined on Windows like every native program there.

## What the agent gets

One command of ours in the always-loaded command list, `office`, plus `soffice` on the PATH once installed:

```
$ office render work/report.docx
✓ work/report.pdf  6 pages
✓ work/report-pages/page-1.png … page-6.png
  read the pages with the file tool to see them

$ office recalc work/model.xlsx
✓ work/model.xlsx  412 formulas recalculated, values written
✗ 2 errors
  Summary!C7  #REF!   =Data!Z99/Data!B2
  Summary!D9  #NAME?  =SUMIFZ(A:A,"x",B:B)
! 3 cells use functions LibreOffice does not compute (PERCENTOF); Excel computes them when the file opens. Their cached values are left empty.

$ office convert inbox/old-budget.xls --to xlsx
✓ work/old-budget.xlsx
```

- `render` takes `.docx`, `.doc`, `.odt`, `.rtf`, `.pptx`, `.ppt`, `.odp`, `.xlsx`, `.xls`, `.ods`: a PDF beside the file, and with `--pages` (default all, capped) a PNG per page through `pypdfium2`, which the agent's Python is to carry preinstalled with the other document packages. For a workbook it prints each sheet's used range, which is the one render the browser path has no answer for.
- `recalc` takes `.xlsx` and `.xlsm`, and `--check` reports without writing; it exits 1 when any formula is an error. An `.ods` is LibreOffice's own format and recalculates on load, so it has no stale cache to fix.
- `convert` wraps `--convert-to` with a target the agent names by extension, into the working folder or `--out`; `csv` writes one file per sheet with computed values (the CSV filter's sheet option `-1`, [csv_params](https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html)).
- `soffice` itself is linked into the app's bin folder once installed, through a wrapper that adds a fresh profile when the call has none, the way Codex's does. That makes the powerpoint skill's `thumbnail.py`, which already looks for `soffice`, and any script a model writes from memory work as written.

What the agent is told: the bash tool's description names `office` and says its first use downloads LibreOffice. The skills change in the skills repository: the spreadsheet skill's quality gate becomes `office recalc` before delivery, and the docx and powerpoint gates offer `office render` beside the browser preview, as the road that works offline and matches a PDF export. Nothing tells the agent to render before every reply; the gates already ask it to look.

## Download on first need

- **Trigger.** The first `office` or `soffice` call with nothing installed. The app installs it, outside any chat's reach, the way `ensureManagedPython` installs Python: one install in flight per machine, a failure tried again by the next call. Nothing downloads at launch, and nothing asks first: like a large package the agent installs, it simply starts, and the install stays in the runtime folder for every later call and chat.
- **Prefer what is there.** A LibreOffice the person installed, at or above the pinned major version, is used instead of downloading (`/Applications/LibreOffice.app` or `~/Applications/LibreOffice.app` by its `Info.plist` version, the registry's install path on Windows, `soffice` on the PATH or `/usr/lib/libreoffice` on Linux by `soffice --version`). It runs with our profile, kept in `runtime/office/own-profile`, so their settings never apply. Either one is linked into the bin folder as `soffice` once found.
- **Progress.** The command prints the download's progress at each tenth, so a long first call promotes to a background job under the usual `yieldMs` rule and the agent can keep working. Measured on the Mac: the whole first need (download, hash, mount, copy, signature check, warm-up) takes 26 to 39 seconds on a fast connection, of which the copy out of the image is about 6.
- **Offline.** The command fails with one line saying LibreOffice could not be downloaded and that the browser preview still works for Word and PowerPoint, and the spreadsheet skill tells the agent to say plainly that the workbook was not recalculated.
- **Pinning and verification.** A manifest in the workspace package names one version and, per platform and architecture, the file name and SHA-256. Files come from TDF's archive (`downloadarchive.documentfoundation.org/libreoffice/old/<version>/`), which keeps every build at a stable address, unlike the `stable/` tree. The hash is checked before anything is extracted; on macOS the extracted app must also pass `codesign --verify --deep --strict` with TDF's team identifier (`7P5S3ZLCN7`). `pnpm --filter @instrument-org/workspace script:refresh-office-manifest <version>` refreshes the manifest from each artifact's size and its `.sha256` beside it in the archive (the archive's folders have no checksum listing, but every file has one).
- **Where.** `runtime/office/<version>/` (`runtimeLayout`'s `office`), extracted beside it and renamed into place when whole, like the base Python packages, with an `instrument-office.json` naming the version and where `soffice` is inside. One install runs at a time per machine, under a lock file in `runtime/office/` naming its process. `runtime/office` is read-only to chats, so no chat can change the binary another chat runs. The profile template sits in the version folder.
- **Updates.** The pin moves with app releases, on TDF's "still" branch, promptly when a point release fixes a document-parsing CVE: LibreOffice parses files the person did not write. A new pin downloads on its first need; the old version is deleted once nothing runs from it. Settings shows the install with its size and a Remove button, since 800 MB is worth being able to find.

## The sandbox profile

`soffice` needs to read its own install, the system fonts and the document, and to write its profile, `$TMPDIR` and the output folder. Measured on the stock 26.2.6 Mac build under a Seatbelt profile that denies writes anywhere in the home folder but `~/Library/Caches` and the output folder, with the profile in `$TMPDIR`: a `.docx` converts to PDF in about 2 seconds, and nothing is written to `~/Library`.

- **Profile per call.** Each call copies the template (about 8 KB: the settings file the install's warm-up start leaves) into a fresh folder under `$TMPDIR` and deletes it after. LibreOffice allows one running instance per profile and hands a second call's arguments to the first over a pipe, which is where parallel conversions go wrong; a profile per call removes the shared state, so no lock is needed. The template carries recalculation on load, macro security at its highest with macro execution off, untrusted referer links blocked, and links never updated (Calc's link mode is `1` for never, Writer's `0`). `office` runs at most two `soffice` at once per process.
- **macOS.** `runtime/office` joins the chat's read-only reach; nothing else in the Seatbelt profile changes, and `$TMPDIR` is already writable. The Seatbelt profile's denial of Apple Events and opening apps does not affect `--headless`. Every start logs two lines of noise under Seatbelt (`sandbox_extension_issue_file_to_process failed`, `Task policy set failed`), which `office` and `soffice` drop.
- **Linux.** bubblewrap already leaves the system and `/tmp` as they are. Fontconfig's cache goes to `XDG_CACHE_HOME`, which native commands already write.
- **Windows.** Unconfined, as every native program is until [the Windows sandbox](../architecture/windows-sandbox.md) lands. LibreOffice adds no reach `python` lacks there.

Cold start on an Apple-silicon Mac, stock 26.2.6: 6.6 seconds on the first launch of a fresh install, then 1.3 to 2 seconds a conversion with a new profile. Through `office` on 26.2.7, under the chat's Seatbelt profile, a call takes 1.9 to 2.8 seconds including the page PNGs, and two renders started at once each finish in under 3. Codex's trimmed build does a conversion in 0.5 to 0.7 seconds with a warm or copied profile.

## Recalculation

By default LibreOffice computes a formula cell with no cached value and keeps any cached value it finds in an Excel file ("never recalculate" for OOXML). Measured on 26.2.6: an openpyxl workbook comes out computed either way, but a workbook whose cached values are stale (any writer that edits values and leaves results in place) keeps the stale results unless the profile sets `org.openoffice.Office.Calc/Formula/Load/OOXMLRecalcMode` to `0`, always ([setting](https://admx.help/?Category=LibreOffice-from-Collabora&Policy=Collabora.Policies.LibreOffice::RecalcMode), [symptom](https://ask.libreoffice.org/t/xlsx-convert-to-pdf-with-formula-result/66868)). The template sets it and `ODFRecalcMode` the same.

`office recalc`:

1. Loads the workbook in LibreOffice with forced recalculation and exports a copy to a temporary folder.
2. Reads every formula cell's value from the copy and writes it into the original file's sheet XML as the cell's cached value (`<v>`, with `t="str"`, `"b"` or `"e"` as the value needs), and sets `fullCalcOnLoad` so Excel recalculates on open regardless. Styles, charts, validation, conditional formats and everything else in the original stay byte for byte. LibreOffice's own `.xlsx` export is not the deliverable because it rewrites the whole package.
3. Reports every error value by cell, error and formula, and separates the cells LibreOffice could not compute from the agent's mistakes. Measured on 26.2.7: `XLOOKUP`, `LET`, `TEXTJOIN`, `VSTACK` and `TEXTSPLIT` compute; `GROUPBY`, `PERCENTOF`, `REGEXTEST`, `TRIMRANGE`, `MAP` and `IMAGE` give `#NAME?`; `LAMBDA` gives `#VALUE!`. LibreOffice's export writes a function it does not know in lower case (`_xlfn.percentof(`), which is how `office recalc` tells them apart: such a cell, and an error cell whose formula reaches one, is reported as "Excel computes this when the file opens", not as an error, and keeps no cached value. A newer function written without its `_xlfn.` prefix is `#NAME?` in Excel too, and is reported as the agent's error, which it is. A reference to a missing sheet, and a literal `#REF!` openpyxl writes into a formula, both come back as `#NAME?` from LibreOffice, and are reported as errors.

The write-back reads and rewrites the package with a small ZIP reader of its own (no ZIP64, no encryption, either of which fails the call with the file untouched): every part it does not change is copied byte for byte, and on a three-sheet budget only the two sheets with formulas and `workbook.xml` change. A formula cell LibreOffice left out of its copy keeps what it had.

## Fidelity

LibreOffice is not Word, PowerPoint or Excel, and the agent is told that a render shows what LibreOffice draws.

- **Fonts.** It ships metric-compatible stand-ins for Calibri, Cambria (Carlito, Caladea) and the classic core fonts, so line and page breaks hold for those ([fonts](https://wiki.documentfoundation.org/Fonts)). Aptos, Office's current default, has no stand-in, and a document set in it reflows. The docx skill already steers toward fonts both sides have.
- **Formats.** SmartArt, some chart types, text effects and PowerPoint animation draw approximately or not at all. A PDF from LibreOffice is a good check of a document the agent made and a fair, not exact, picture of one from Word.
- **Functions.** As measured above; newer Excel functions arrive in LibreOffice a release or more behind.

## Per platform

| | Artifact (26.2.7.3) | Download | How it is unpacked |
| --- | --- | --- | --- |
| macOS arm64 | `LibreOffice_<v>_MacOS_aarch64.dmg` | 298 MB | `hdiutil attach -nobrowse -readonly -mountpoint <temp>`, `ditto` the app out to a folder named `LibreOffice` with no `.app`, detach; 801 MB on disk |
| macOS x64 | `LibreOffice_<v>_MacOS_x86-64.dmg` | 308 MB | as above |
| Windows x64 / arm64 | `LibreOffice_<v>_Win_<arch>.msi` | 373 / 360 MB | administrative install, `msiexec /a <msi> /qn TARGETDIR=<dir>`, which unpacks without installing or registering ([msiexec](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec), [parallel installs](https://wiki.documentfoundation.org/Installing_in_parallel/Windows)); about 1.5 GB on disk |
| Linux x64 / arm64 | `LibreOffice_<v>_Linux_<arch>_deb.tar.gz` | 217 / 207 MB | unpack each `.deb`'s `data.tar` without `dpkg`; runs from `opt/libreoffice<major>/program/soffice`; 751 MB on disk (arm64) |

Sizes and SHA-256s are in `packages/workspace/src/lib/office/manifest.generated.ts`, from [TDF's archive](https://downloadarchive.documentfoundation.org/libreoffice/old/).

- **macOS registration.** Started from a folder named `LibreOffice.app`, a conversion checks the app in with Launch Services: it joins every Open With menu, its two Quick Look extensions and its Spotlight importer register, and macOS shows a notice that a Spotlight importer was added. Copying it or `soffice --version` registers nothing. The same app in a folder named `LibreOffice` registers nothing on a conversion either, and still passes `codesign --verify --deep --strict`, since the signature does not cover the bundle folder's name.
- **macOS signing.** The stock app is signed with TDF's Developer ID, hardened runtime, and notarized (`spctl` accepts it). It is not covered by Instrument's signature and needs not be: a file the app writes itself carries no quarantine flag ([`LSFileQuarantineEnabled`](https://developer.apple.com/documentation/bundleresources/information-property-list/lsfilequarantineenabled)), so Gatekeeper does not assess it, and notarization holds if it ever is. Codex's build is signed but not notarized (`spctl` rejects it) and runs for exactly that reason; a stock notarized build does not lean on it.
- **Windows.** The install runs `msiexec /a <msi> /qn TARGETDIR=<dir>` and looks for `program\soffice.exe` under it. A standard user at medium integrity runs it with no elevation and no prompt. It adds no file association, Explorer handler, Start menu entry or uninstall entry; Windows Installer keeps a 20 KB `SourceHash{<product code>}` file in `C:\Windows\Installer`. The image keeps what a real install puts in Windows' own folders under folders of its own: the bundled fonts (Carlito, Caladea, Liberation, DejaVu) in `Fonts`, which the install moves to `share\fonts\truetype` so LibreOffice loads them (left in `Fonts`, a document set in Liberation Serif renders in Times New Roman), and the Visual C++ runtime (`msvcp140`, `vcruntime140`, `vcruntime140_1` and the rest, from Microsoft's merge modules, which a real install puts in `System32`) in `System` and `System64`, where `soffice.exe` does not look. The install moves the `System64` DLLs built for `soffice.exe`'s architecture into `program`, so the x64 install runs on its own runtime whether or not Windows has one (`soffice.bin` loads them from `program` even where `System32` has an older copy). The arm64 MSI's `System64` holds only the x64 runtime, because the merge module's x64 and arm64 files share names and one folder, so the arm64 install still runs on the arm64 runtime Windows has; a computer without it has not been tried. The person's own install is found by `reg query` of `HKLM\SOFTWARE\LibreOffice\UNO\InstallPath`. The bin folder gets an `soffice.cmd` wrapper that copies the template with `xcopy`; Python's `shutil.which("soffice")` finds it. A call takes 4 to 7 seconds on the arm64 host and about 13 on the x64 one, where the same calls on Linux take under 1.5; on the x64 host `soffice` alone converts in 3.9 seconds with a profile it has used and 9.5 with a new one, so most of a call there is the profile.
- **Linux.** The install takes each `.deb`'s `data.tar.*` out of its `ar` archive and extracts it with `tar`, no `dpkg`. The `.deb` builds expect a handful of system libraries a desktop has and a minimal system may not; the install starts `soffice` once before it renames into place, and a failure carries its output, which names the missing library (`soffice.bin: error while loading shared libraries: libcups.so.2: …`, exit 127). That warm-up runs under bubblewrap with `/tmp` writable: LibreOffice on Linux makes its single-instance pipe in `/tmp`, or `/var/tmp`, whatever `TMPDIR` says, and with neither writable stops with "no valid pipe path found". The binary needs NSS, cairo, X11, CUPS and D-Bus libraries even headless; Ubuntu's desktop has them all.

## License

LibreOffice is under the [MPL-2.0](https://www.libreoffice.org/about-us/licenses), and its bundled fonts under their own open licenses. Downloading the stock build from TDF at the person's request redistributes nothing. Mirroring it on `releases.tryinstrument.com` would make us a distributor, with LibreOffice's license texts to ship alongside, and MPL's source requirement is met by pointing at TDF's source for the same version.

## Alternatives weighed

- **The person's own Microsoft Office**, through AppleScript to Word and Excel on macOS or COM on Windows. Best fidelity, and worth keeping as a later "check it in Word" road for people who have it. Not the base: most people do not have it, it is not on Linux, it opens a real app window that takes focus, and on macOS it goes through `osascript`'s per-app permission.
- **The person's own LibreOffice.** Used when present (above); not something to require.
- **`textutil` and `qlmanage` on macOS.** `textutil` converts Word and RTF text with no layout and knows nothing of slides or workbooks; Quick Look returns a clipped corner of sheet one, as the render plan found. Mac only either way.
- **Pure-Python recalculation** ([formulas](https://github.com/vinci1it2000/formulas), [pycel](https://github.com/dgorissen/pycel)). Each covers a subset of Excel's functions, computes values without writing them into the file, and renders and converts nothing, so it would be a fourth engine for one of the three jobs. The XLSX viewer's engine (`@dukelib/sheets-wasm`) calculates for display in the renderer and has no road to a file.
- **Client-side rendering only**, per the render plan. Kept for what it does well, below; it cannot recalculate or convert.

## How this fits the render plan

[render-a-file-to-look-at-it.md](render-a-file-to-look-at-it.md) rejected bundling LibreOffice for its installer size, a binary per platform and notarization. Downloading on first need answers all three: the installer does not change, and TDF signs and notarizes its own build. This plan therefore supersedes that plan's Office paragraph only, and narrows the render plan to SVG, HTML and PDF through the browser, which stays its road. The client-side Office renderer it proposed exists in the docx and powerpoint skills' `preview.py`; it stays, as the view of what the person will see in Instrument's viewer, beside `office render` as the view of a print or PDF export. If the render plan's `render` command is built, an Office file passed to it runs `office render`.

## Phases

1. **Manifest and install.** The pinned manifest and its refresh script; the per-platform install in the workspace package (download, hash, unpack, signature check, version check, rename into place); detection of an installed LibreOffice; the profile template. Unit tests for the manifest, the unpackers against small fixtures and the template.
2. **`office render` and `office convert`**, the `soffice` wrapper and bin link, and the bash tool description.
3. **`office recalc`** with the write-back and the error report, tested against openpyxl workbooks, stale caches, missing sheets and unsupported functions.
4. **Skills.** The spreadsheet, docx and powerpoint quality gates in the skills repository.
5. **Settings.** The install with its size, and Remove.

## Validation

Per the `validate-changes` skill:

- **Unit tests** for each phase, as listed.
- **Sandbox shell** (`run-bash`): `office render`, `convert` and `recalc` under the real Seatbelt and bubblewrap profiles, including two renders at once.
- **Running app**, packaged, on each platform's test host: the first-need download with progress, offline failure, a second chat using the same install, and Remove.
- **Evals**, which need approval before running. Proposed cases:
  - `office-recalc-model`: build a three-sheet budget with cross-sheet formulas; pass if the delivered file has cached values for every formula and the agent reports no recalculation it did not do.
  - `office-recalc-broken`: given a workbook with a `#REF!` and an unprefixed `XLOOKUP`, fix both; pass on zero errors from `office recalc --check`.
  - `office-render-deck`: a ten-slide deck whose title overflows on one slide; pass if the agent renders, sees it and changes the slide.
  - `office-convert-legacy`: summarize an attached `.doc` and `.ppt`, and return the `.doc` as PDF.
  - `office-offline`: the same budget with the download refused; pass if the agent says the workbook was not recalculated.

## Risks

- **Download size.** About 300 MB on a first spreadsheet is a long first call on a slow connection; the progress lines and background promotion make it visible, not short.
- **Parsing untrusted files.** LibreOffice has a steady stream of document-parsing CVEs. The pin has to move, the profile keeps macros and link updates off, and on macOS and Linux the profile holds what a crafted file could reach.
- **Write-back edge cases.** Dynamic-array spill ranges and shared formulas need care in the sheet XML; `fullCalcOnLoad` makes Excel the final word either way.
- **Memory.** Each `soffice` holds a few hundred MB while it runs. A profile per call allows parallel conversions, so `office` runs at most two at once.

## What is not yet checked

- **Windows without the Visual C++ runtime**: the x64 host has it installed, so the x64 install's own copy in `program` was seen loading but not seen being needed; on arm64 nothing ships it.
- **Windows arm64 page images**: the base Python packages did not install on the arm64 host (the rename of the built folder into place failed with `EPERM`), so `office render` drew no PNGs there. On the x64 host they installed and it drew them.
- **Linux on a minimal system**: run only on a desktop install; the missing-library failure was produced by hiding `libcups.so.2`, not on a system without it.
- **The packaged app**: the first-need download with progress in a chat, the offline failure, a second chat on the same install, and Settings' Remove have not been driven in the app.
- **Evals**: none run.

## Open questions

- Whether `office render` of a Word or PowerPoint file should be the skills' first road, ahead of the browser preview, or second to it.

Settled while building: a person's own LibreOffice at or above the pinned major is used; `msiexec /a` needs no elevation; `office recalc` writes values back into the original; the install lives in the runtime folder.
