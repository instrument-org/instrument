# Single source of truth

Reviewed: snapshot at `f2cbfb724`

One lens over the whole tree: a fact the code holds in more than one place, kept equal by hand, where nothing in the repo (a shared constant, a type, a derivation, a test that reads both) makes the copies agree. Five readers each took an area (the Electron main process, the renderer, the workspace package, the seams between packages and the build config, and prose that restates a fact the code holds) and every quoted line was read again before it went in here. Two findings reverse a recorded contract and say so. Settled ground from the 2026-10-28 review's duplicated-state pass (the Files tab's place, wakes, "the chat settled") was left alone.

Letters go to the finding; a `plus N similar` names siblings with the same root cause, which a fix should take with it.

## Findings

### A. The Windows publisher names are typed once for the build and once for the installed app's check

- Status: fixed
- Where: [constants.ts:154](/packages/shared/src/constants.ts#L154), [electron-builder.ts:407](/apps/studio/electron-builder.ts#L407)
- What: `WINDOWS_PUBLISHER_NAMES` is what the app's own signature verdict accepts on a downloaded Setup (`update-bridge.ts:235`, `update-velopack.ts:90`, `velopack-pack.ts:201`); `publisherName` in the builder is what lands in `app-update.yml` for electron-updater's check. The same four strings, and the builder file already imports from `@instrument-org/shared` without this one. The contract on `d1e890460` ("a publisher name ships in `WINDOWS_PUBLISHER_NAMES` and `publisherName` at least one release before any certificate is issued under it") names both places and nothing holds them equal, so the next certificate rename added to one list leaves one update path refusing a correctly signed build as unsigned.

### B. The packaged resource folders are named in the builder and again in the code that reads them

- Status: fixed
- Where: [electron-builder.ts:165](/apps/studio/electron-builder.ts#L165), [registry-dir.ts:7](/apps/studio/src/electron-main/lib/registry-dir.ts#L7), [create-workspace-actor.ts:107](/apps/studio/src/electron-main/lib/create-workspace-actor.ts#L107), [directory-icon.ts:16](/packages/workspace/src/lib/apps/directory-icon.ts#L16), [mac-native.ts:46](/apps/studio/src/electron-main/lib/mac-native.ts#L46)
- What: `registry/skills`, `system-skills`, `directory-icons` and `bin/instrument-mac`, `bin/instrument-mac.node`, `bin/instrument-seatbelt` are each a `to:` string in the builder and a separate literal where the app reads them. `DIRECTORY_ICONS_DIR_NAME` exists and the builder ignores it. Rename one in either place and `pnpm dev` keeps working (it reads the unpackaged path) while the packaged app has no system skills, no directory icons or no Mac bridge, with nothing failing at build.

### C. A record file's name is parsed by three hand-written patterns beside the workspace's parser, and one already names a file nothing writes

- Status: fixed
- Where: [file-names.ts:72](/packages/workspace/src/lib/records/file-names.ts#L72), [tested-before.ts:56](/apps/studio/src/electron-main/lib/tested-before.ts#L56), [problem-reports.ts:509](/apps/studio/src/electron-main/lib/problem-reports.ts#L509), [store-id.ts:14](/packages/workspace/src/schemas/store-id.ts#L14)
- What: `parseRecordFileName` is not reachable from the package's `exports`, so Studio main respells the session log name twice (`/^ses_[0-9A-HJKMNP-TV-Z]{26}\..+\.jsonl$/` and `/^(ses_[0-9A-Za-z]+)\..+\.jsonl$/`), and the settings pattern beside it matches `settings|marks` though `15aeb74f5` stopped writing `marks.<device>.jsonl`. Inside the workspace the session id's alphabet is typed once in `ULID_REGEX` (case-insensitive) and again in `LOG_NAME` (uppercase only), so a lowercase id that validates names a log the fold never reads. Change the session id shape or add a per-device file (`state.<device>.json` already exists beside `settings.<device>.jsonl`) and problem reports silently omit it and "tested before" reads no log header.

### D. The converter lists by hand which record kinds count as a restatement

- Status: fixed
- Where: [convert-chat.ts:365](/packages/workspace/src/lib/records/convert/convert-chat.ts#L365), [record.ts:46](/packages/workspace/src/lib/records/record.ts#L46)
- What: `RESTATED = new Set(["rollover", "session", "set", "sites", "stop"])` decides in `restatesOnly` whether a device's files may be removed and rewritten from `chat.db`; a file holding any other kind is "history" and the database stays. The converter writes exactly those kinds today (`:550-588`, `:624`), and nothing derives the set from what it emits or from the record union. One more header-level kind written by the converter and every chat still on its `chat.db` is judged history at the next launch, never converted, and listed unavailable from then on, the failure the comment at `:405-411` describes for another cause.

### E. Which data parts are "state" is derived from `CADENCE` in one file and retyped by hand in the developer notes

- Status: open
- Where: [developer-notes.ts:96](/packages/workspace/src/lib/transcript/developer-notes.ts#L96), [message-data-part.ts:90](/packages/workspace/src/schemas/session/message-data-part.ts#L90), [state-notes.ts:34](/packages/workspace/src/lib/state-notes.ts#L34)
- What: `state-notes.ts` derives `StateName` from `CADENCE` and its table is typed so a part declared `state` without a note does not compile. `developer-notes.ts` keeps its own `STATE_PARTS` set of four literals and uses it at `:706` to suppress the generic JSON note for a picture the model was not told. A fifth `state` part compiles everywhere and then carries a raw JSON note card on every message, `wasSent: false`, on every turn.

### F. Two lists of "what the person sees in the chat" already disagree

- Status: open
- Where: [views.ts:40](/packages/workspace/src/lib/records/views.ts#L40), [chat-markdown.ts:61](/packages/workspace/src/lib/chat-folders/chat-markdown.ts#L61)
- What: `CONVERSATION_PARTS` ("Parts the chat view draws for everyone") has `data-branchedFrom`, `data-chatChanges`, `data-fileChanges`, `data-folderChanges`, `data-fromChat`, `data-maxSteps`, `data-ratingCard`, `data-viewContext` and the feedback tool; `VISIBLE` ("Parts of a message the person sees in the chat") lacks all of those and adds `data-questionAnswer`, `data-taskEvent` and `file`. The renderer is the third copy. Whichever is right, `CHAT.md` either omits task events and question answers the person saw or includes rows the chat never draws, and the steps view keeps blobs for parts nobody shows.

### G. The chat's shown title is derived twice, with the same three lines

- Status: open
- Where: [chat-info.ts:130](/packages/workspace/src/lib/chat-info.ts#L130), [chat-markdown.ts:193](/packages/workspace/src/lib/chat-folders/chat-markdown.ts#L193)
- What: `shownTitle` exists "so the chat list and the chat's folder read the same", and each caller picks the root message itself before calling it. Change the pick in one (first user message with text, skipping a dictated placeholder) and the chat list row and the `Chats/<title>/` folder name diverge. Plus 1 similar: "the chat's own session" is found by `!session.parent` at `chat-info.ts:106`, `chat-markdown.ts:203` and `convert-chat-settings.ts:112` while the index answers it through `chatSessionIn` (`record-folders.ts:316`); they agree only because the fold sorts sessions by id.

### H. The task command's word and its handle shape are typed by hand beside `TASK_COMMAND`

- Status: open
- Where: [task-command.ts:10](/packages/workspace/src/model-text/commands/task-command.ts#L10), [stop.ts:94](/packages/workspace/src/lib/capabilities/task/stop.ts#L94), [stop.ts:175](/packages/workspace/src/lib/capabilities/task/stop.ts#L175), [children.ts:15](/packages/workspace/src/lib/capabilities/task/children.ts#L15), [system-prompt.ts:110](/packages/workspace/src/model-text/system-prompt.ts#L110)
- What: `stop.ts:114` builds its line from `TASK_COMMAND.name` while `:175`, `:198`, `:199` and four copies of "a task id (t1) is required. See `instrument task list`." write the command as a literal, and `view-context-model-text.ts:243` does too. The handle pattern is `/^t(\d+)$/` in `chat/children.ts:52` and `/^t\d+$/i` in `stop.ts:94`. The system prompt's usage line `stop <t id>... [<bg id> | --all]` allows `stop t1 t2 bg_1`, which `stop.ts:69-70` reads as three tasks. Rename the word or prefix and the model is still told to run `instrument task list`, and `stop` treats the new handle as a process id and answers "no process".

### I. Front matter is split four ways, against a contract that there is one splitter

- Status: open
- Where: [parse-message.ts:161](/packages/workspace/src/lib/parse-message.ts#L161), [computer-titles.ts:110](/packages/workspace/src/lib/chat/computer-titles.ts#L110), [front-matter.ts:6](/apps/studio/src/client/components/markdown-editor/front-matter.ts#L6), [front-matter.ts:33](/packages/shared/src/front-matter.ts#L33)
- What: `1fa84d947` committed to "front matter is split only by `splitFrontMatter` from `@instrument-org/shared`" and touched `parse-message.ts`, where `splitHeaders` still requires `---\n` exactly and a `---` closer, while `isMessageDocument` two functions above uses the shared splitter (BOM, trailing blanks, `...` closer). The markdown editor calls both on one text (`markdown-editor.tsx:487-488`): a draft saved with a BOM is a message to one and plain text to the other, so the card shows `---` and the YAML as the body with no recipient. `computer-titles.ts` and the editor's `FENCES` are two more grammars; the Files list misses a `title:` under a BOM and lists the heading instead.

### J. Home folder shortening is implemented three times, and the shared one says it drifted once already

- Status: open
- Where: [folder-paths.ts:4](/packages/shared/src/folder-paths.ts#L4), [computer.ts:484](/packages/workspace/src/lib/chat/computer.ts#L484), [host-path.ts:36](/apps/studio/src/client/components/window/host-path.ts#L36)
- What: shared's `shortenHomePath` and `typedHostPath` tolerate a trailing separator and either slash, by the header's own account of a past drift. The workspace's local `displayHostPath` (shadowing shared's exported name with other semantics) and the renderer's `homeRelative` are the plain `startsWith(home + "/")` again. A home with a trailing slash (`HOME=/home/sam/`, which `os.homedir()` passes through) shortens in one surface and prints whole in two.

### K. Which extensions are what is kept in seven tables with no reader of two

- Status: open
- Where: [file-type-glyphs.ts:231](/apps/studio/src/client/components/extend/file-type-glyphs.ts#L231), [get-file-type.ts:421](/apps/studio/src/client/lib/get-file-type.ts#L421), [get-file-type.ts:611](/apps/studio/src/client/lib/get-file-type.ts#L611), [rendered-kinds.ts:22](/apps/studio/src/electron-main/lib/rendered-kinds.ts#L22), [work-card.tsx:45](/apps/studio/src/client/components/transcript/work-card.tsx#L45), [computer-titles.ts:50](/packages/workspace/src/lib/chat/computer-titles.ts#L50), [computer-page.tsx:4423](/apps/studio/src/client/components/window/computer-page.tsx#L4423), [file-extension-to-language.ts:1](/apps/studio/src/client/lib/file-extension-to-language.ts#L1), [file-extensions.ts:17](/packages/shared/src/file-extensions.ts#L17)
- What: the glyph a row wears and what opens on double-click come from unrelated lists: `.qt` and `.mid` wear a video and an audio glyph and open as a download card; `.mts` plays as video with no video glyph; `.key` wears a presentation glyph and is `iwork`. Markdown is `md, mdx` in shared, five spellings in `get-file-type`, three in `rendered-kinds`, `work-card` and `computer-titles`, so `notes.mdown` opens in the Markdown viewer with a type icon and no title in Files. The renderer's `THUMBNAIL_EXTENSIONS` hand-copies main's rendered-kinds tables; add `svelte` to one side and either main draws what the grid never asks for or the grid asks for "a blank page", as its own comment warns. The code language map and shared's mime table differ by `csv, htm, html, svg, wasm` on one side. Checked by diffing the lists.

### L. A screen's name is derived in three places, one of them typed `Record<string, string>`

- Status: open
- Where: [screen-presentation.tsx:111](/apps/studio/src/client/components/window/screen-presentation.tsx#L111), [capture-store.ts:141](/apps/studio/src/client/components/captures/capture-store.ts#L141), [screen-action.ts:63](/apps/studio/src/client/components/window/screen-action.ts#L63)
- What: `screenPresentation` switches on `Screen["kind"]` exhaustively; `SCREEN_NAMES` in the capture store is `Record<string, string>` and falls back to `"Window"`; `screen-action.ts` switches again. A new screen kind is a type error in the first and a silent "Window" in a developer capture.

### M. The app page address is a template literal in eight places beside `pathOf(SCREEN_ROUTES.app)`, and the route constants are kept in four files

- Status: open
- Where: [window-href.ts:61](/apps/studio/src/client/components/window/window-href.ts#L61), [apps-home.tsx:372](/apps/studio/src/client/components/window/apps-home.tsx#L372), [omnibar.tsx:943](/apps/studio/src/client/components/window/omnibar.tsx#L943), [window.ts:229](/apps/studio/src/client/atoms/window.ts#L229), [app-tabs.ts:50](/apps/studio/src/client/components/window/app-tabs.ts#L50), [instrument-screens.ts:14](/apps/studio/src/shared/instrument-screens.ts#L14)
- What: `SCREEN_ROUTES` is checked against the route tree and `pathOf` encodes its params; `/apps/${slug}` is typed raw in `apps-home.tsx:372,627`, `omnibar.tsx:943`, `use-sign-in-landing.tsx:68`, `use-connect-from-directory.ts:32`, `app-front.tsx:260`, `hold-marks.tsx:101` and `setup-change-cards.tsx:274` (`activity-requests.tsx:121` shows the right way). `NEW_TAB_HREF`, `BROWSER_HREF`, `APPS_HREF`, `CHATS_HREF`, `INBOX_HREF` and the `SCREENS` hrefs are plain strings beside it. Move a route and `SCREEN_ROUTES` fails to compile, the literals do not, and every app link from the omnibar or a sign-in landing opens as an `unknown` screen, which `screen-presentation.tsx:100-107` draws as the new-tab page.

### N. The Files page's search defaults are declared in Zod and retyped where a tab is read back

- Status: open
- Where: [files.tsx:22](/apps/studio/src/client/routes/_app/files.tsx#L22), [window-href.ts:166](/apps/studio/src/client/components/window/window-href.ts#L166), [tab-history.ts:80](/apps/studio/src/client/components/window/tab-history.ts#L80)
- What: `root: z.string().default("~")` and `path: z.string().default("")` in the route; `search.get("root") ?? "~"` and `?? ""` in `matchScreen`; `search.get("file")` by name in tab history. `COMPUTER_ROOT` exists in `shared/computer-href.ts:21`; neither `"~"` has a name. Change the root default in the route and a tab at bare `/files` titles itself as the home folder while the page shows the computer.

### O. The sign-in account kinds are a union in two files, one of which compiles past a new kind

- Status: open
- Where: [notices.ts:69](/apps/studio/src/shared/notices.ts#L69), [plan-account-stop.ts:12](/apps/studio/src/client/lib/plan-account-stop.ts#L12), [model-choices.ts:79](/apps/studio/src/client/components/setup/model-choices.ts#L79)
- What: `SignInAccountType` is `keyof SIGN_IN_ACCOUNT_NAMES`, and `use-sign-in-again.ts` is `satisfies Record<SignInAccountType, …>`; `PlanAccountProvider` is the same three literals written again, with `isPlanAccountProvider` gating on them. A fourth account kind fails the first and compiles in the second, so its usage-limit errors come through as a generic error instead of "your plan's usage ran out, back at …". `PlanProvider` is declared at both `use-connected-plans.ts:5` and `choose-ai.tsx:51`.

### P. Byte sizes are formatted five ways and durations four

- Status: open
- Where: [file-system.tsx:805](/apps/studio/src/client/components/extend/file-system.tsx#L805), [archive-viewer.tsx:285](/apps/studio/src/client/components/document-viewers/archive-viewer.tsx#L285), [browsing-data.ts:79](/apps/studio/src/client/lib/browsing-data.ts#L79), [format-bytes.ts:1](/packages/workspace/src/lib/format-bytes.ts#L1), [activity-requests.tsx:85](/apps/studio/src/client/components/activity/activity-requests.tsx#L85), [tool-generate-image.tsx:245](/apps/studio/src/client/components/message-part/tool-generate-image.tsx#L245)
- What: only `file-system.tsx` carries the per-OS base (1000 on Mac, 1024 on Windows) its comment calls the product rule; the archive viewer, the browsing-data line, the workspace's `formatBytes` and the size grouping each pick their own. A file in a zip reads `1.4 MB` beside a Files row saying `1.5 MB`. `formatDuration` and `formatElapsed` exist in `client/lib` and are rewritten in `activity-requests.tsx`, `tool-generate-image.tsx` and `file-preview-card.tsx:349`, so one call reads `1m 30s` on its card and `90.0 s` in Activity. Nit.

### Q. A file URL's `version` key is written in one place and read by name in three

- Status: open
- Where: [computer-file-url.ts:41](/apps/studio/src/client/lib/computer-file-url.ts#L41), [file-viewer.tsx:716](/apps/studio/src/client/components/file-viewer.tsx#L716), [file-viewer.tsx:1055](/apps/studio/src/client/components/file-viewer.tsx#L1055), [file-thumbnail.tsx:208](/apps/studio/src/client/components/file-thumbnail.tsx#L208)
- What: rename or move the key and the writer alone changes; the Updated pill never fires again and thumbnails stop telling versions apart, with nothing failing.

### R. "A driven instance nobody is watching" is written out twice beside two helpers that each cover half of it

- Status: open
- Where: [billing.ts:39](/apps/studio/src/electron-main/rpc/routes/billing.ts#L39), [agent-completion-notifications.ts:241](/apps/studio/src/electron-main/lib/agent-completion-notifications.ts#L241), [on-screen.ts:12](/apps/studio/src/electron-main/windows/on-screen.ts#L12), [debug.ts:200](/apps/studio/src/electron-main/rpc/routes/debug.ts#L200)
- What: four readings of `STUDIO_DRIVE_PURPOSE` and `STUDIO_DRIVE_VISIBLE`, with two "is dev" tests (`is.dev` and `!app.isPackaged`). A change to how the drive script marks visibility reaches `isDrivenInstance` and not the two copies, and billing pages open in the person's real browser from an agent's off-screen instance while every reply notifies.

### S. Which display protocol Linux is on is computed twice from four inputs

- Status: open
- Where: [utils.ts:416](/apps/studio/src/electron-main/rpc/routes/utils.ts#L416), [tab-carry.ts:156](/apps/studio/src/electron-main/windows/tab-carry.ts#L156)
- What: the same `resolveOzonePlatform` plus `effectiveDisplayProtocol` expression over the env var, `WAYLAND_DISPLAY` and the `ozone-platform` switch, with `setup-environment.ts:239` a third reading of the env var. One site adds an input and Settings says X11 while tab drags refuse to place windows.

### T. The updater's "active unless a preview without a test feed" rule is written twice in one file

- Status: open
- Where: [update.ts:148](/apps/studio/src/electron-main/lib/update.ts#L148), [update.ts:242](/apps/studio/src/electron-main/lib/update.ts#L242)
- What: once for the electron-updater port and once for the Velopack port. A flavor rule landing in one leaves Windows previews on the shipping feed, the identity swap the comment at `:145-147` warns about.

### U. The OAuth callback's default port is derived twice

- Status: open
- Where: [server.ts:34](/apps/studio/src/electron-main/auth/server.ts#L34), [apps.ts:44](/apps/studio/src/electron-main/lib/apps.ts#L44)
- What: the server picks `PORTS.authCallback.dev` or `.prod` by `NODE_ENV`; `apps.ts` repeats the pick as the fallback for a redirect URL registered before the server has bound. Move the server to picking by `APP_FLAVOR` and a vendor's consent screen lands on a port nobody listens on.

### V. Shared constants that one side retypes

- Status: open
- Where: [apps.ts:100](/apps/studio/src/electron-main/lib/apps.ts#L100), [platform-api-server.ts:8](/apps/studio/src/shared/platform-api-server.ts#L8), [electron.vite.config.ts:40](/apps/studio/electron.vite.config.ts#L40), [billing.ts:177](/apps/studio/src/electron-main/rpc/routes/billing.ts#L177), [debug.ts:143](/apps/studio/src/electron-main/rpc/routes/debug.ts#L143)
- What: the staging API host is in `PLATFORM_API_SERVERS` (unexported) and again as `STAGING_API_BASE_URL`, the OAuth relay base for a local API, so moving staging leaves every app sign-in from a dev build dying at the redirect. The debug port is `PORTS.electronDebug` and `"48160"` in the Vite config, which the developer strip compares. `"instrument/auto"` and `"https://tryinstrument.com/download"` are retyped where `OUR_MODELS.text.id` and `MANUAL_DOWNLOAD_URL` exist. Plus 2 similar in `entitlements.mac.plist:40,45` (the bundle id, which a plist cannot import).

### W. Route inputs re-declare the preference store's enums

- Status: open
- Where: [preferences.ts:63](/apps/studio/src/electron-main/rpc/routes/preferences.ts#L63), [preferences.ts:89](/apps/studio/src/electron-main/stores/workspace/preferences.ts#L89), [preferences.ts:166](/apps/studio/src/electron-main/rpc/routes/preferences.ts#L166), [preferences.ts:33](/apps/studio/src/electron-main/stores/machine/preferences.ts#L33)
- What: `theme` and `releaseChannel` are `z.enum` in the store and `z.enum` again in the route input. A value added to the store alone type-checks (`store.set` takes the wider type), the picker offers it, the route rejects it and the choice snaps back. `WorkspacePreferencesSchema.shape.theme` is the derivation the route ignores.

### X. Leaf names in the workspace's machine folder are typed at the writer and again at the reader

- Status: open
- Where: [page-thumbnails.ts:203](/apps/studio/src/electron-main/browser-view/page-thumbnails.ts#L203), [machine-data-migration.ts:327](/apps/studio/src/electron-main/lib/machine-data-migration.ts#L327), [convert-chat-records.ts:25](/apps/studio/src/electron-main/lib/convert-chat-records.ts#L25), [tested-before.ts:53](/apps/studio/src/electron-main/lib/tested-before.ts#L53), [workspaces.ts:64](/apps/studio/src/electron-main/lib/workspaces.ts#L64), [reach-workspace-record.ts:33](/apps/studio/src/electron-main/lib/reach-workspace-record.ts#L33), [workspace-refusal.ts:75](/apps/studio/src/electron-main/lib/workspace-refusal.ts#L75)
- What: `WORKSPACE_MACHINE_ENTRIES` names the folders and `workspaceLayout()` every data-dir entry but these: `page-thumbnails` (reader and migration destination), `set-aside/chat-db` (converter and "tested before"), `workspace.json` (writer, the cloud-placeholder probe and the newer-build refusal), `bookmarks.json` (`serve-bookmarks.ts:63` and `TRAVELING_FILES`), and the kept-state files (`WINDOW_FILES` in the migration and `SHARED_KEPT_FILES` plus `keptFileName`). Rename `workspace.json` at the writer and the two guards read ENOENT and open a pinned workspace as empty, the clobber their comments guard against; rename the thumbnails leaf and the migration moves pictures into a folder nothing reads.

### Y. Two IPC channels are bare literals while `shared/constants.ts` names the rest

- Status: open
- Where: [index.ts:354](/apps/studio/src/electron-preload/index.ts#L354), [initialize.ts:103](/apps/studio/src/electron-main/rpc/initialize.ts#L103), [index.ts:277](/apps/studio/src/electron-preload/index.ts#L277), [electron-logger.ts:153](/apps/studio/src/electron-main/lib/electron-logger.ts#L153)
- What: `start-orpc-server` is the whole RPC bootstrap; a typo on either side is a window that loads and never answers a call, with only a preload `console.error`. `renderer-log` is the other. `RESOLVE_THEME_CHANNEL` and friends at `shared/constants.ts:3-23` are the pattern both skip.

### Z. The dev updater cache folder is named in `dev-app-update.yml` and closed to chats under the production name only

- Status: open
- Where: [dev-app-update.yml:2](/apps/studio/dev-app-update.yml#L2), [constants.ts:4](/packages/shared/src/constants.ts#L4), [places.ts:277](/packages/workspace/src/lib/permissions/places.ts#L277)
- What: the updater reads both names (`update-bridge.ts:356-360`); the permission rule closes `APP_UPDATER_CACHE_DIR_NAME` alone, so in dev the `-dev` folder is open to a chat with the caches folder. Dev only.

### AA. Prompts send downloads to "the chat's folder"; the code puts them in the work folder

- Status: open
- Where: [web-fetch.ts:687](/packages/workspace/src/tools/web-fetch.ts#L687), [agent-browser-guide.ts:39](/packages/workspace/src/model-text/guides/agent-browser-guide.ts#L39), [agent-browser.ts:897](/packages/workspace/src/lib/shell-commands/agent-browser.ts#L897), [system-prompt.ts:137](/packages/workspace/src/model-text/system-prompt.ts#L137)
- What: the system prompt defines "this conversation's own folder" as the one the person browses and says browser downloads land in `downloads/` under the work folder; the fetch tool and the browser guide both say "the chat's folder". An agent reading that as the person's folder `curl`s scratch PDFs into `Chats/`, against the prompt's own rule that nothing but finished work goes there.

### AB. The ffmpeg skill says to run a system copy by path; the shell's tool text says never by path

- Status: open
- Where: [SKILL.md:20](/packages/workspace/system-skills/ffmpeg/SKILL.md#L20), [create-bash-env.ts:807](/packages/workspace/src/lib/create-bash-env.ts#L807), [path-program.ts:170](/packages/workspace/src/lib/shell-commands/path-program.ts#L170)
- What: slash paths run natively, so the skill's advice works and the tool text ("invoked by bare name only, never by an absolute path") is the stale one. An agent that trusts the tool definition never reaches for `/opt/homebrew/bin/ffmpeg` when the bundled build lacks an encoder.

### AC. `read_file` on a text-only model says it cannot take images, then explains how to read them by region

- Status: open
- Where: [read-file.ts:398](/packages/workspace/src/tools/read-file.ts#L398)
- What: `describeReadableMedia(model)` is model-conditional; the two lines after it, on image sizes and `region` reads, are not. A text model is coached into region reads it cannot use. Plus 1 similar: the bash tool's "complete set of unix builtins" list (`create-bash-env.ts:803`) is drawn from `getCommandNames()` and leaves out `curl`, which comes from `getNetworkCommandNames()` (plausible; read from the snapshot, not run).

### AD. `background-processes.md` describes controls that do not exist and contradicts itself on who counts a chat's processes

- Status: open
- Where: [background-processes.md:157](/docs/architecture/background-processes.md#L157), [background-processes.md:163](/docs/architecture/background-processes.md#L163), [running-badge.tsx:33](/apps/studio/src/client/components/task/running-badge.tsx#L33), [chat-header.tsx:131](/apps/studio/src/client/components/window/chat-header.tsx#L131)
- What: the doc's pill says "2 jobs running" with a popover "headed Still running", a Stop all and a two-hour note; the badge says "2 commands running" and the popover is a list of rows with one stop each, no heading, no Stop all, no cap note. Line 163 says nothing outside a task's page counts its processes, while line 157 and the chat header say the chat counts them all. A reader picks up finished work as open.

### AE. `system-overview.md` names a bus call that does not exist and mis-states what `appChanged` publishes

- Status: open
- Where: [system-overview.md:53](/docs/architecture/system-overview.md#L53), [host-events.ts:85](/packages/workspace/src/lib/host-events.ts#L85), [changed.ts:33](/packages/workspace/src/lib/apps/changed.ts#L33)
- What: Studio main hears through `chatSettles`, not `sessionEnds`, and the event is per chat, not per session, which changes what a listener may assume; `app.event` goes out only when something happened, not "together" with `app.updated`.

### AF. `native-and-builtin-commands.md`'s retirement rule for the xargs route would also drop the `kill` routing

- Status: open
- Where: [native-and-builtin-commands.md:108](/docs/architecture/native-and-builtin-commands.md#L108), [native-text.ts:438](/packages/workspace/src/lib/shell-commands/native-text.ts#L438)
- What: the prose says to drop the rule once uutils runs `-P` in parallel; the rule is `xargsRunsParallel(args) || xargsRunsKill(args)`. Following the doc after an upgrade sends `xargs kill` to the sandboxed PATH `kill`, which reaches none of the agent's processes. The generated table row at line 94 is right; the prose beside it is not.

### AG. `agent-sandbox.md` cites a file that is now a folder, in a form `check:docs` cannot see

- Status: open
- Where: [agent-sandbox.md:47](/docs/architecture/agent-sandbox.md#L47), [seatbelt.ts:33](/packages/workspace/src/lib/native-sandbox/seatbelt.ts#L33), [docs.ts:79](/scripts/docs.ts#L79)
- What: `src/lib/native-sandbox.ts` is `src/lib/native-sandbox/seatbelt.ts`. The checker only reads a backticked path that starts with `apps/`, `packages/`, `scripts/`, `docs/`, `.agents/` or `.github/`, so every package-relative cite in the architecture docs is unchecked. Plus 2 similar: `just-bash-upstream.md:46` calls 20,000 "the chat's" traversal budget where that is `HOME_MAX_TRAVERSAL` and the chat's is 300,000 (`create-bash-env.ts:177`), so the patch's retirement condition names the wrong constant; `in-app-browser.md:11` names the targets stream `browser.targets` where line 17 and `browser.ts:155` say `browser.live.targets`.

### AH. Hand-typed copies that match today and read no constant

- Status: open
- Where: [rotating-log-writer.ts:4](/apps/studio/src/electron-main/lib/rotating-log-writer.ts#L4), [dev-file-logger.ts:143](/apps/studio/src/electron-main/lib/dev-file-logger.ts#L143), [bash.ts:92](/packages/workspace/src/tools/bash.ts#L92), [background-job-commands.ts:15](/packages/workspace/src/lib/shell-commands/background-job-commands.ts#L15)
- What: the log-entry cap and its truncation marker (which the dev-logs skill greps for) in both loggers; the bash yield ceiling and the `fg` wait ceiling, equal by a comment; `megabytes()` in `log-volume.ts:52` and `rpc-payloads.ts:373`; `IMMUTABLE_CACHE_SECONDS` in `app-protocol.ts:59` and `computer-files.ts:72`; `MAX_LOG_FILE_BYTES` in both loggers; the `tool-` prefix peeled by hand at eight sites beside `getToolNameByType`; three fallback titles for a chat with none ("Chat", "Untitled chat", "New chat"); `read-file.ts:751` "50KB"; `choose.ts:43` "one to four"; the skill-creator skill's "under 64 characters" against a validator that rejects only over 64; `.agents/env.md:24` omitting the two `CLOUDFLARE_*` vars in the workspace's `.env.example`; the `MAX_RUNNING_BACKGROUND_PROCESSES` comment and error saying "per task" where the count is per chat. Nits, listed so the count is known.

## Checked and consistent

The on-disk layout names (`.instrument/`, `chats/`, `Projects/`, `Drafts/`, `Apps/`, `AGENTS.md`, `DRAFT.md`, `APP.md`, `permissions.json`, `chat-folders.json`) come through `PRIVATE_FOLDER_NAME`, `workspaceLayout`, `WORKSPACE_MACHINE_ENTRIES`, `KEY_FOLDER_NAMES` and `CHAT_FOLDER_NAMES` in non-test code. Tool names go through `TOOL_NAMES`, with `TOOLS_BY_NAME` and `MARK_OF_PART` typed exhaustively. `isFreshAsk` and `splitFrontMatter` are shared. Shortcuts are one table feeding menu and labels; settings tabs and `AppPlace` maps are `satisfies` exhaustive; the page editor's host and guest messages share one type. RPC is a typed oRPC router with no string route names. The CLAUDE.md terminology paragraph holds on every file name, key and rule checked (settings fields, ask stages, the ten-minute freshness, the synced store's newest-wins order, `Topics/` to `Projects/`), as do the pins in "Key catalog versions" against `pnpm-workspace.yaml`. The three generated docs (the uutils table, the product guide reference, the records guide) are pinned by tests that pass at this snapshot, and `product-guide.test.ts` holds every `instrument://` link literal to a real id.

## Not covered

`electron-main/menus/`, `page-editor/`, most of `browser-view/` and `platform-api/`; the renderer's `markdown-editor/`, `document-viewers/` internals, `billing/`, `transcript/` and the debug routes; the workspace's `native-sandbox/`, `bash-worker/`, `apps/mcp/`, `mac-apps/`, `actions/`, `activity/` and `machines/`; `ai-gateway.md`, `releasing.md`, `mac-native-bridge.md` and `threat-model.md` beyond identifier checks; `shared/icons.ts` against the renderer's icon maps; the format hook's claims in CLAUDE.md (`@instrument-org/agent-hooks` is not in the tree).
