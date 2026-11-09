// ---- Settings ---------------------------------------------------------------------
// The Settings modal (studio-modals/settings-modal.tsx, components/settings/), measured
// 2026-10-31 at 1280x800, its sections re-measured 2026-11-07: a 1200x720 sheet inset 40px over the dimmed window, "Settings"
// centered over it and its × ringed in the corner; a 176px column of the search and the
// tabs, then the open tab across the rest, its sections labeled over white cards of rows.

/** The tabs in the sidebar's order (use-settings-tabs.ts): [name, icon]. Developer shows in developer mode. */
const SETTINGS_TABS = [
  ["General", "faders-horizontal"],
  ["Account", "user-circle"],
  ["Providers", "cpu"],
  ["Memory", "fingerprint"],
  ["Permissions", "lock-key"],
  ["Skills", "cube"],
  ["Storage", "hard-drives"],
  ["Activity", "pulse"],
];

/**
 * Settings open over the window (pass it as appWindow's `over`): `on` is the tab shown,
 * `body` what it shows (settingsGeneral() and the others below, or sections of your
 * own), `dev` adds Developer in its blue, `search` types into the search, `extra` adds
 * tabs a proposal brings as [name, icon].
 */
const settingsSheet = ({ on = "General", body, dev = false, search = "", extra = [] } = {}) =>
  `<div class="absolute inset-0 z-40 bg-black/25">
    <div class="absolute inset-10 flex flex-col overflow-hidden rounded-3xl bg-[light-dark(#fafaf9,#1c1a18)] shadow-2xl ring-1 ring-black/5">
      <div class="relative flex h-11 shrink-0 items-center justify-center text-[15px] font-medium">Settings<span class="absolute top-3 right-4 grid size-10 place-items-center rounded-xl bg-card text-foreground/70 shadow-xs ring-1 ring-border"><i class="ph ph-x text-[16px]"></i></span></div>
      <div class="flex min-h-0 flex-1">
        <div class="flex w-[200px] shrink-0 flex-col gap-1 px-3">
          <div class="mb-1 flex h-8 items-center gap-2 rounded-lg bg-card px-2.5 text-sm ${search ? "text-foreground ring-2 ring-foreground/15" : "text-muted-foreground"}"><i class="ph ph-magnifying-glass text-[15px] text-muted-foreground"></i>${search || "Search"}</div>
          ${[...SETTINGS_TABS, ...extra, ...(dev ? [["Developer", "wrench"]] : [])]
            .map(
              ([name, icon]) =>
                `<div class="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm ${name === on ? "bg-foreground/8 font-medium" : ""} ${name === "Developer" ? "text-blue-600" : ""}"><i class="ph ph-${icon} text-[16px] ${name === "Developer" ? "" : "text-foreground/75"}"></i>${name}</div>`,
            )
            .join("")}
        </div>
        <div class="min-w-0 flex-1 overflow-hidden pt-5 pr-9 pb-6 pl-3">${body ?? settingsGeneral()}</div>
      </div>
    </div>
  </div>`;

/** A tab's head where it has one (Memory, Permissions): its name over what it is for. */
const settingsHead = (title, line = "") =>
  `<div class="mb-6"><div class="text-base font-semibold">${title}</div>${line ? `<p class="mt-1 text-sm text-muted-foreground">${line}</p>` : ""}</div>`;

/** A section (SettingsSection): its label (14px medium, muted) with `right` (buttons) at its end, over `inner` (settingsCard). */
const settingsSection = (label, inner, { right = "" } = {}) =>
  `<div class="mb-4"><div class="mb-3 flex min-h-8 items-center gap-2"><span class="flex-1 text-sm font-medium text-muted-foreground">${label}</span>${right}</div>${inner}</div>`;

/** A white card of rows, divided by hairlines when `divided`. */
const settingsCard = (rows, { divided = false } = {}) =>
  `<div class="overflow-hidden rounded-xl border border-border bg-card ${divided ? "divide-y divide-border" : "py-1"}">${rows.join("")}</div>`;

/**
 * A row in a card: an optional `icon` (a Phosphor name drawn in a 36px brand tile with
 * `tile`, else on a 28px muted tile as Permissions' places are, or finished HTML), its `title` over its `line` (and `sub`,
 * a third quiet line), and `end` at the right (a button, a toggle, a selectBox).
 */
const settingsRow = ({ title, line = "", sub = "", icon = "", tile = false, end = "", dim = false } = {}) => {
  const ico = !icon
    ? ""
    : icon.startsWith("<")
      ? icon
      : tile
        ? `<span class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-white"><i class="ph ph-${icon} text-[20px]"></i></span>`
        : `<span class="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><i class="ph ph-${icon} text-[16px]"></i></span>`;
  return `<div class="flex items-center gap-3.5 px-4 py-3 ${dim ? "opacity-50" : ""}">${ico}<div class="min-w-0 flex-1 space-y-0.5"><div class="text-sm font-medium">${title}</div>${line ? `<div class="text-xs text-muted-foreground">${line}</div>` : ""}${sub ? `<div class="mt-1.5 text-xs">${sub}</div>` : ""}</div>${end}</div>`;
};

/** The zoom stepper General draws: −, the percent, +. */
const zoomStepper = (pct = 100) =>
  `<span class="inline-flex h-9 shrink-0 items-center overflow-hidden rounded-lg border border-border bg-card text-sm shadow-xs"><span class="grid h-full w-9 place-items-center border-r border-border"><i class="ph ph-minus text-[14px]"></i></span><span class="px-2.5 tabular-nums">${pct}%</span><span class="grid h-full w-9 place-items-center border-l border-border"><i class="ph ph-plus text-[14px]"></i></span></span>`;

/** General as built: Interface, Notifications, Dictation, About. `version` names the build. */
const settingsGeneral = ({ version = "2.0.0-beta.134", notify = false, mic = false } = {}) =>
  settingsSection(
    "Interface",
    settingsCard([
      settingsRow({ title: "Theme", line: "Choose your preferred color scheme.", end: selectBox("Light", { icon: "sun" }) }),
      settingsRow({ title: "Zoom", line: "Scale the interface. Independent of web view zoom.", end: zoomStepper() }),
    ]),
  ) +
  settingsSection("Notifications", settingsCard([settingsRow({ icon: "bell", tile: true, title: "Know when it's done", line: "Get a notification when a task finishes or needs you.", end: notify ? toggle(true) : button("Allow", { tone: "brand", size: "sm", round: true, cls: "px-5" }) })])) +
  settingsSection("Dictation", settingsCard([settingsRow({ icon: "microphone", tile: true, title: "Microphone access", line: "Needed for dictation.", end: mic ? toggle(true) : button("Allow", { tone: "brand", size: "sm", round: true, cls: "px-5" }) })])) +
  settingsSection(
    "About",
    settingsCard([settingsRow({ title: `Version ${version}`, line: "Instrument is up to date.", sub: "Release notes", end: button("Check for updates", { tone: "outline" }) })]) +
      `<div class="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 p-4"><div class="space-y-1"><div class="text-sm font-medium">Open source</div><p class="text-xs text-muted-foreground">Instrument is open source and free to use. View the source on GitHub, or tell us about something that isn't working. It also comes with programs from other projects, and you can read their licenses here.</p></div><div class="flex flex-wrap gap-2">${button("View source on GitHub", { tone: "outline", size: "sm" })}${button("Send feedback", { tone: "outline", size: "sm" })}${button("Third-party licenses", { tone: "outline", size: "sm" })}</div></div>`,
  );

/**
 * Providers as built: Instrument first, then the AI subscriptions. Signed out, Instrument
 * offers what the server's offer says (a trial here, on the brand's tint); `signedIn`
 * names the account, its plan and email, with Account. `connected` names the
 * subscriptions already in use.
 */
const settingsProviders = ({ signedIn = false, connected = [], plan = "Pro", email = "mac-user@example.com" } = {}) =>
  settingsSection(
    "AI providers",
    `<div class="flex flex-col gap-3">${[
      [brand("instrumentglyph", "size-5"), signedIn ? `Instrument account ${badge(plan)}` : "Try Instrument free", signedIn ? email : "Sign in with Google for 7 days free. No card needed.", signedIn ? button("Account", { tone: "outline" }) : button("Start free trial", { tone: "brand" }), true],
      [brand("openai", "size-5"), "ChatGPT account", "Pay for ChatGPT Plus or Pro? Use it here.", connected.includes("ChatGPT") ? badge("Connected", { tone: "brand" }) : button("Continue with ChatGPT")],
      [brand("claude", "size-5 grayscale brightness-0"), "Claude account", "Pay for a Claude plan? Use it here.", connected.includes("Claude") ? badge("Connected", { tone: "brand" }) : button("Continue with Claude")],
      [brand("grok", "size-5"), "Grok account", "Use your eligible Grok or X subscription here.", connected.includes("Grok") ? badge("Connected", { tone: "brand" }) : button("Continue with Grok")],
    ]
      .map(
        ([m, title, line, end, lead]) =>
          `<div class="flex items-start gap-4 rounded-xl p-4 shadow-sm ${lead && !signedIn ? "border border-brand-200 bg-brand-50" : "bg-card"}"><span class="flex min-w-0 flex-1 items-start gap-3"><span class="grid size-8 shrink-0 place-items-center">${m}</span><span class="min-w-0 flex-1 space-y-1"><span class="flex items-center gap-2 font-medium">${title}</span><span class="block truncate text-sm text-muted-foreground">${line}</span></span></span>${end}</div>`,
      )
      .join("")}</div>`,
    { right: button("Add provider", { icon: "plus" }) },
  );

/** Permissions as built: the head, then Folders, each with its path and how it is answered. `answers` sets a folder's answer by name. */
const settingsPermissions = ({ answers = {} } = {}) =>
  settingsHead("Permissions", "Instrument asks you in a chat the first time it needs a folder or an app. You can change your answer here anytime.") +
  settingsSection(
    "Folders",
    settingsCard(
      [
        ["Desktop", "folder", "mac-user › Desktop"],
        ["Documents", "folder", "mac-user › Documents"],
        ["Downloads", "folder", "mac-user › Downloads"],
        ["iCloud Drive", "cloud", ""],
        ["Drives you plug in", "hard-drive", "/Volumes"],
        ["Other apps’ files", "folders", "mac-user/Library"],
        ["Photos library", "images", "mac-user/Pictures/Photos Library.photoslibrary"],
        ["Music and TV libraries", "music-notes", "mac-user/Music/Music, mac-user/Music/iTunes, mac-user/Movies/TV"],
        ["Passwords and keys", "key", "Folders like .ssh ask first. Your browsers and Keychain stay closed."],
      ].map(([name, icon, path]) =>
        settingsRow({
          icon: icon === "folder" ? `<span class="grid size-7 place-items-center">${fileMark("folder", "text-[22px]")}</span>` : icon === "folders" ? `<span class="grid size-7 place-items-center">${fileMark("folder", "text-[22px]")}</span>` : icon,
          title: name,
          line: path,
          end: selectBox(answers[name] || "Ask first", { w: 112 }),
        }),
      ),
      { divided: true },
    ),
    { right: button("Add folder…", { icon: "plus", size: "sm", tone: "outline" }) + `<span class="grid size-8 shrink-0 place-items-center rounded-lg border border-[light-dark(#0000000d,#ffffff1a)] text-muted-foreground"><i class="ph ph-dots-three text-[16px]"></i></span>` },
  );

/** Memory with nothing in it, as built. */
const settingsMemory = () =>
  settingsHead("Memory", "What Instrument knows about you. Each memory is a file in your Memory folder, so you can open one to read or change it.") +
  settingsSection(
    `<span class="text-foreground">Memories</span>`,
    `<div class="flex flex-col items-center gap-1 rounded-xl border border-border px-6 py-10 text-center"><span class="mb-2 flex gap-1.5">${["openai", "claude", "googlegemini", "grok"].map((k) => brand(k, "size-4")).join("")}</span><span class="text-sm font-medium">Instrument hasn’t remembered anything yet</span><span class="max-w-sm text-[13px] text-muted-foreground">It remembers things as you chat. You can also bring in what ChatGPT, Claude, Gemini, or another AI already knows about you.</span><span class="mt-3">${button("Import from another AI", { tone: "outline", size: "sm" })}</span></div>`,
  );
