// ---- the window -----------------------------------------------------------------
// The Studio window at 1280x800 in the light theme, measured off the documents fixture
// (re-measured 2026-10-31 at 1280x800). The bar (40) and the rail (76)
// sit on the gray ground; everything else is one rounded card inset 8px from the right
// and bottom. Window tabs live in the bar (tab-strip.tsx), status pills and the bell
// at its right (window-bar.tsx).

// The ground a step lighter than gray-200, and the card (`--pane`) a hair below the
// background, so a row in the card's own white stands out from the list (globals.css).
const GROUND = "bg-[light-dark(#f2f1f0,#161312)]";
const PANE = "[--color-background:light-dark(#f7f7f6,#141210)]";
const trafficLights = `<div class="flex w-20 shrink-0 items-center gap-2 pl-3"><span class="size-3 rounded-full bg-[#ff5f57]"></span><span class="size-3 rounded-full bg-[#febc2e]"></span><span class="size-3 rounded-full bg-[#28c840]"></span></div>`;

/** A title fading out at its end rather than ending in an ellipsis (`tab-title-fade`), the way a window tab cuts a long name. */
const fadeEnd = `[mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent_calc(100%-0.75rem))]`;

/**
 * A window tab in the bar, as tab-strip.tsx draws it: 32px, growing to 240px with the
 * room the strip has, its mark and its title fading out at the end. `on` is the tab up
 * (the card's white, its ×); `hover` the one under the pointer (a grey fill, its ×).
 * `density` is how much the strip has room for: "full" (mark and title), "compact" (the
 * mark centered, 60px at least) or "icon" (32px). `sep` draws the hairline after it,
 * which the strip leaves out next to the tab up or under the pointer. A tab a task is
 * driving (`agent`) has its title in the brand's shimmer. `t` may be finished HTML.
 */
const barTab = (t, { on = false, hover = false, density = "full", sep = false } = {}) => {
  if (typeof t === "string") return t;
  const size = {
    full: "min-w-20 gap-2 px-2.5",
    compact: "min-w-15 justify-center px-1",
    icon: "min-w-8 justify-center px-1",
  }[density];
  const title =
    density === "full"
      ? `<span class="min-w-0 flex-1 overflow-hidden whitespace-nowrap ${fadeEnd} ${t.agent ? "text-brand-600" : ""}">${tabTitle(t)}</span>`
      : "";
  return `
  <div class="relative flex h-8 max-w-60 flex-1 items-center rounded-xl text-sm font-medium ${size} ${on ? "bg-background text-foreground shadow-xs" : hover ? "bg-foreground/8 text-foreground" : "text-foreground/55"}">
    <span class="flex size-4 shrink-0 items-center justify-center">${tabMark(t, "size-4 text-[8px]")}</span>${title}
    ${(on || hover) && density !== "icon" ? `<span class="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-md ${on ? "bg-background" : "bg-[light-dark(#e6e5e4,#2a2725)]"}"><i class="ph ph-x text-[12px]"></i></span>` : ""}
    ${sep ? `<span class="absolute top-1/4 -right-0.5 h-1/2 w-px bg-gray-300"></span>` : ""}
  </div>`;
};

/**
 * How much a strip of `count` tabs has room for in `room` px, as stripLayout does it:
 * every tab named while each gets 80px, else the tab up keeps its name and the rest
 * go to their marks, compact while each still fits a mark and a ×.
 */
const stripDensity = (count, room = 1000) => {
  const content = room - 4 * (count - 1);
  if (content / count >= 80) return "full";
  return (content - 80) / Math.max(1, count - 1) >= 60 ? "compact" : "icon";
};

/** The bell at the bar's end: `dot` for something new, `count` for how many, `open` pressed. */
const bell = ({ dot = false, count = 0, open = false } = {}) =>
  `<span class="relative grid size-7 shrink-0 place-items-center rounded-lg ${open ? "bg-foreground/8 text-foreground" : "text-muted-foreground/80"}"><i class="ph ph-bell text-[16px]"></i>${count ? `<span class="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">${count}</span>` : dot ? `<span class="absolute top-0.5 right-0.5 size-2 rounded-full bg-brand-600 ring-2 ring-[light-dark(#f2f1f0,#161312)]"></span>` : ""}</span>`;

/**
 * A pill in the bar's right corner (window-bar.tsx), before the bell. `kind`:
 * "update" (the green Update pill once one is downloaded), "updating", "offline"
 * ("Offline"), "unreachable" ("Can't reach Instrument"), or `label` and `icon` for
 * a pill a proposal adds, drawn quiet.
 */
const statusPill = (kind, { label = "", icon = "" } = {}) =>
  ({
    update: `<span class="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-brand-600 px-1.5 text-xs leading-none font-semibold text-white shadow-xs"><i class="ph ph-arrows-clockwise text-[13px]"></i>Update</span>`,
    updating: `<span class="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-black/5 bg-background px-1.5 text-xs leading-none font-semibold text-muted-foreground shadow-xs">${spinner("text-[12px]")}Updating</span>`,
    offline: `<span class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-warning-500/10 px-2.5 text-xs text-warning-700 ring-1 ring-warning-500/25 ring-inset"><i class="ph ph-wifi-slash text-[14px]"></i>Offline</span>`,
    unreachable: `<span class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-warning-500/10 px-2.5 text-xs text-warning-700 ring-1 ring-warning-500/25 ring-inset"><i class="ph ph-cloud-slash text-[14px]"></i>Can't reach Instrument</span>`,
  })[kind] ??
  `<span class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-foreground/6 px-2.5 text-xs text-foreground/75">${icon ? `<i class="ph ph-${icon} text-[14px]"></i>` : ""}${label}</span>`;

/**
 * The 40px window bar on the ground: the lights, back and forward, `lead` (something a
 * proposal puts before the tabs, like a workspace pill), the window's tabs with New tab
 * after them, then `right` (status pills) and the bell. `tabs` are tabs (see tabMark) or
 * finished HTML; `active` is the tab up, `hover` the one under the pointer. `density`
 * defaults to what the strip has room for (stripDensity); the tab up keeps its name.
 */
const winBar = ({
  tabs = [{ chats: true }],
  active = 0,
  hover = -1,
  density,
  lead = "",
  right = "",
  bell: bellOpts = {},
  back = true,
} = {}) => {
  const d = density ?? stripDensity(tabs.length);
  return `
  <div class="flex h-10 shrink-0 items-center gap-1.5 pr-2">
    ${trafficLights}
    <i class="ph ph-arrow-left px-1.5 text-[16px] ${back ? "text-foreground/80" : "text-foreground/35"}"></i><i class="ph ph-arrow-right px-1.5 text-[16px] text-foreground/35"></i>
    ${lead}
    <div class="flex min-w-0 flex-1 items-center gap-1 px-2">
      ${tabs
        .map((t, i) =>
          barTab(t, {
            on: i === active,
            hover: i === hover && i !== active,
            density: i === active ? "full" : d,
            sep: i < tabs.length - 1 && i !== active && i + 1 !== active && i !== hover && i + 1 !== hover,
          }),
        )
        .join("")}
      <span class="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground/70"><i class="ph ph-plus text-[16px]"></i></span>
    </div>
    <div class="flex shrink-0 items-center gap-2">${right}${bell(bellOpts)}</div>
  </div>`;
};

// The starter loads Phosphor's regular weight only, so a lit place keeps its outline
// icon and takes the brand color, where the app also swaps to the fill weight.
const RAIL = [
  ["chat", "Chat", "chat-circle"],
  ["files", "Files", "folder-simple"],
  ["browser", "Browser", "globe"],
  ["apps", "Apps", "shapes"],
];

/** One place in the rail: its icon over its word, lit (`on`) on a grey plate in the brand's ink. */
const railItem = (word, icon, { on = false, mark = "" } = {}) => `
  <div class="relative flex w-15 flex-col items-center gap-0.5 rounded-xl py-1.5 ${on ? "bg-foreground/8 text-brand-600" : "text-muted-foreground"}">
    <span class="flex h-6 items-center"><i class="ph ph-${icon} text-[24px]"></i></span>
    <span class="text-[11px] leading-4 ${on ? "font-medium" : ""}">${word}</span>
    ${mark}
  </div>`;

/**
 * The 76px rail on the ground (app-rail.tsx): New, then Chat, Files, Browser and Apps,
 * and at its foot Feedback over Settings. `on` is chat | files | browser | apps |
 * feedback | settings | "" (nothing lit). `mark` hangs a mark or annotation on a place
 * by key (new, chat, …). `extra` adds places after Apps as [key, word, icon], and
 * `user` draws the signed-in avatar in place of Settings.
 */
const rail = (on = "chat", { mark = {}, user = false, extra = [] } = {}) => `
  <nav class="flex w-[76px] shrink-0 flex-col items-center gap-3 pt-1 pb-2">
    <div class="relative flex w-15 flex-col items-center gap-0.5 py-1.5">
      <span class="grid size-11 place-items-center rounded-full bg-brand-600 text-white shadow-xs"><i class="ph ph-note-pencil text-[20px]"></i></span>
      <span class="text-[11px] leading-4 font-medium">New</span>
      ${mark.new || ""}
    </div>
    <div class="flex w-full flex-col items-center gap-1">
      ${[...RAIL, ...extra].map(([key, word, icon]) => railItem(word, icon, { on: on === key, mark: mark[key] || "" })).join("")}
    </div>
    <div class="flex-1"></div>
    <div class="flex w-full flex-col items-center gap-1">
      ${railItem("Feedback", "megaphone-simple", { on: on === "feedback", mark: mark.feedback || "" })}
      ${
        user
          ? `<div class="grid w-15 place-items-center rounded-xl p-2"><span class="grid size-11 place-items-center rounded-xl bg-brand-100 text-[15px] font-semibold text-brand-800">J</span></div>`
          : railItem("Settings", "faders-horizontal", { on: on === "settings", mark: mark.settings || "" })
      }
    </div>
  </nav>`;

/**
 * The whole window. `bar` (winBar), `on` (the lit place), `body` (what fills the card),
 * `over` (a layer over everything: menus, popovers, the floating chat, dialogs),
 * `railMark` and `railExtra` (rail's `mark` and `extra`), `user`, `dark`.
 */
const appWindow = ({
  bar = winBar(),
  on = "chat",
  body = inboxCol({ on: -1 }) + noChatOpen(),
  over = "",
  railMark = {},
  railExtra = [],
  user = false,
  dark = false,
} = {}) => `
  <div class="relative flex h-full flex-col overflow-hidden ${GROUND} text-foreground ${dark ? "[color-scheme:dark]" : "[color-scheme:light]"}">
    ${bar}
    <div class="flex min-h-0 flex-1">
      ${rail(on, { mark: railMark, user, extra: railExtra })}
      <div class="relative mr-2 mb-2 flex min-w-0 flex-1 overflow-hidden rounded-[10px] ${PANE} bg-background shadow-xs">${body}</div>
    </div>
    ${over}
  </div>`;

/** A tooltip (ui/tooltip.tsx), or a tab's hover card with `detail` under its title, placed in the window's pixels. */
const tooltip = (title, { left, top, detail = "", w } = {}) =>
  `<div class="absolute z-50 rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-black/5" style="left:${left}px;top:${top}px;${w ? `width:${w}px` : ""}">${detail ? `<div class="font-medium">${title}</div><div class="mt-0.5 text-muted-foreground">${detail}</div>` : title}</div>`;
