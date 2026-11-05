// ---- Settings ---------------------------------------------------------------------
// The Settings modal (studio-modals/settings-modal.tsx, components/settings/), measured
// 2026-10-31 at 1280x800: a 1200x720 sheet inset 40px over the dimmed window, "Settings"
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
        <div class="flex w-[200px] shrink-0 flex-col gap-1 px-3 pt-2">
          <div class="mb-1 flex h-8 items-center gap-2 rounded-lg bg-card px-2.5 text-sm ${search ? "text-foreground ring-2 ring-foreground/15" : "text-muted-foreground"}"><i class="ph ph-magnifying-glass text-[15px] text-muted-foreground"></i>${search || "Search"}</div>
          ${[...SETTINGS_TABS, ...extra, ...(dev ? [["Developer", "wrench"]] : [])]
            .map(
              ([name, icon]) =>
                `<div class="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm ${name === on ? "bg-foreground/8 font-medium" : ""} ${name === "Developer" ? "text-blue-600" : ""}"><i class="ph ph-${icon} text-[16px] ${name === "Developer" ? "" : "text-foreground/75"}"></i>${name}</div>`,
            )
            .join("")}
        </div>
        <div class="min-w-0 flex-1 overflow-hidden pt-6 pr-9 pb-6 pl-3">${body ?? settingsGeneral()}</div>
      </div>
    </div>
  </div>`;

/** A tab's head where it has one (Memory, Permissions): its name over what it is for. */
const settingsHead = (title, line = "") =>
  `<div class="mb-6"><div class="text-base font-semibold">${title}</div>${line ? `<p class="mt-1 text-sm text-muted-foreground">${line}</p>` : ""}</div>`;

/** A section: its label (15px, muted) with `right` (buttons) at its end, over `inner` (settingsCard). */
const settingsSection = (label, inner, { right = "" } = {}) =>
  `<div class="mb-6"><div class="mb-2.5 flex min-h-8 items-center gap-2"><span class="flex-1 text-[15px] text-muted-foreground">${label}</span>${right}</div>${inner}</div>`;

/** A white card of rows, divided by hairlines when `divided`. */
const settingsCard = (rows, { divided = false } = {}) =>
  `<div class="overflow-hidden rounded-xl border border-border bg-card ${divided ? "divide-y divide-border" : "py-1"}">${rows.join("")}</div>`;

/**
 * A row in a card: an optional `icon` (a Phosphor name drawn in a 36px brand tile with
 * `tile`, else plain at 24px, or finished HTML), its `title` over its `line` (and `sub`,
 * a third quiet line), and `end` at the right (a button, a toggle, a selectBox).
 */
const settingsRow = ({ title, line = "", sub = "", icon = "", tile = false, end = "", dim = false } = {}) => {
  const ico = !icon
    ? ""
    : icon.startsWith("<")
      ? icon
      : tile
        ? `<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white"><i class="ph ph-${icon} text-[18px]"></i></span>`
        : `<span class="grid w-6 shrink-0 place-items-center text-foreground/70"><i class="ph ph-${icon} text-[22px]"></i></span>`;
  return `<div class="flex items-center gap-4 px-4 py-3 ${dim ? "opacity-50" : ""}">${ico}<div class="min-w-0 flex-1"><div class="text-sm">${title}</div>${line ? `<div class="text-[13px] text-muted-foreground">${line}</div>` : ""}${sub ? `<div class="mt-1.5 text-[13px]">${sub}</div>` : ""}</div>${end}</div>`;
};

/** The zoom stepper General draws: −, the percent, +. */
const zoomStepper = (pct = 100) =>
  `<span class="inline-flex h-9 shrink-0 items-center overflow-hidden rounded-lg border border-border bg-card text-sm shadow-xs"><span class="grid h-full w-9 place-items-center border-r border-border"><i class="ph ph-minus text-[14px]"></i></span><span class="px-2.5 tabular-nums">${pct}%</span><span class="grid h-full w-9 place-items-center border-l border-border"><i class="ph ph-plus text-[14px]"></i></span></span>`;

/** General as built: Interface, Notifications, Dictation, About. `version` names the build. */
const settingsGeneral = ({ version = "2.0.0-beta.119", notify = false, mic = false } = {}) =>
  settingsSection(
    "Interface",
    settingsCard([
      settingsRow({ title: "Theme", line: "Choose your preferred color scheme.", end: selectBox("Light", { icon: "sun" }) }),
      settingsRow({ title: "Zoom", line: "Scale the interface. Independent of web view zoom.", end: zoomStepper() }),
    ]),
  ) +
  settingsSection("Notifications", settingsCard([settingsRow({ icon: "bell", tile: true, title: "Know when it's done", line: "Get a notification when a task finishes or needs you.", end: notify ? toggle(true) : button("Allow", { tone: "brand", round: true }) })])) +
  settingsSection("Dictation", settingsCard([settingsRow({ icon: "microphone", tile: true, title: "Microphone access", line: "Needed for dictation.", end: mic ? toggle(true) : button("Allow", { tone: "brand", round: true }) })])) +
  settingsSection("About", settingsCard([settingsRow({ title: `Version ${version}`, line: "Instrument is up to date.", sub: "Release notes", end: button("Check for updates") })]));

/** Providers as built: Instrument, then the AI subscriptions, then any `keys` added (names). */
const settingsProviders = ({ signedIn = false, connected = [] } = {}) =>
  settingsSection(
    "AI providers",
    `<div class="flex flex-col gap-2.5">${[
      [brand("instrumentglyph", "size-5"), "Instrument", signedIn ? "Included with your plan." : "Sign in with Google and choose a plan.", signedIn ? button("Manage", { size: "sm" }) : button("Log in", { tone: "brand", size: "sm" }), true],
      [brand("openai", "size-5"), "ChatGPT account", "Pay for ChatGPT Plus or Pro? Use it here.", connected.includes("ChatGPT") ? badge("Connected", { tone: "brand" }) : button("Continue with ChatGPT", { size: "sm" })],
      [brand("claude", "size-5"), "Claude account", "Pay for Claude Pro or Max? Use it here.", connected.includes("Claude") ? badge("Connected", { tone: "brand" }) : button("Continue with Claude", { size: "sm" })],
      [brand("grok", "size-5"), "Grok account", "Use your eligible Grok or X subscription here.", connected.includes("Grok") ? badge("Connected", { tone: "brand" }) : button("Continue with Grok", { size: "sm" })],
    ]
      .map(
        ([m, title, line, end, lead]) =>
          `<div class="flex items-center gap-4 rounded-xl border px-5 py-4 ${lead && !signedIn ? "border-brand-500/15 bg-brand-500/8" : "border-border bg-card"}"><span class="grid w-5 place-items-center">${m}</span><div class="min-w-0 flex-1"><div class="text-[15px] font-medium">${title}</div><div class="text-[13px] text-muted-foreground">${line}</div></div>${end}</div>`,
      )
      .join("")}</div>`,
    { right: button("Add provider", { icon: "plus", size: "sm" }) },
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
        ["Photos library", "image", "mac-user/Pictures/Photos Library.photoslibrary"],
      ].map(([name, icon, path]) =>
        settingsRow({
          icon: icon === "folder" ? `<span class="grid w-6 place-items-center">${fileMark("folder", "text-[22px]")}</span>` : icon,
          title: name,
          line: path,
          end: selectBox(answers[name] || "Ask first", { w: 112 }),
        }),
      ),
      { divided: true },
    ),
    { right: button("Add folder…", { icon: "plus", size: "sm" }) + iconButton("dots-three", { ring: true }) },
  );

/** Memory with nothing in it, as built. */
const settingsMemory = () =>
  settingsHead("Memory", "What Instrument knows about you. Each memory is a file in your Memory folder, so you can open one to read or change it.") +
  settingsSection(
    "Memories",
    `<div class="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border px-6 py-10 text-center"><span class="mb-2 flex gap-1.5">${["openai", "claude", "googlegemini", "grok"].map((k) => brand(k, "size-4")).join("")}</span><span class="text-sm font-medium">Instrument hasn’t remembered anything yet</span><span class="max-w-sm text-[13px] text-muted-foreground">It remembers things as you chat. You can also bring in what ChatGPT, Claude, Gemini, or another AI already knows about you.</span><span class="mt-3">${button("Import from another AI", { tone: "outline", size: "sm" })}</span></div>`,
  );
