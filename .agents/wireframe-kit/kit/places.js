// ---- New tab, Apps, release notes -------------------------------------------------
// The places a window tab can stand on besides Chat, Files and Browser: the New tab page
// (new-tab-page.tsx, the command menu's list in place), Apps (apps-home.tsx) and the
// release notes (routes/_app/release-notes.tsx). Re-measured 2026-10-31; Apps re-measured
// 2026-11-07.

/** A command row in the New tab page's list: icon, words, and the shortcut at the right. */
const cmdRow = (icon, label, keys = "", { on = false, h = 8 } = {}) =>
  `<div class="flex ${h === 9 ? "h-9" : "h-8"} items-center gap-2.5 rounded-lg px-3 text-sm ${on ? "bg-foreground/8" : ""}"><i class="ph ph-${icon} text-[15px] text-muted-foreground"></i><span class="flex-1">${label}</span><span class="text-[11px] text-muted-foreground">${keys}</span></div>`;

/** What a new window tab opens on (new-tab-page.tsx): the greeting over the command menu's list, open, with the ⌘K hint under it. `recent` names the recent chats. */
const newTabPage = ({
  greeting = "Good morning",
  recent = [PRICING_TITLE],
} = {}) => `
  <div class="flex min-w-0 flex-1 flex-col items-center pt-[134px]">
    <h1 class="mb-6 text-[22px] font-medium">${greeting}</h1>
    <div class="w-[640px] overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div class="flex h-12 items-center gap-2.5 border-b border-border px-4 text-sm text-muted-foreground"><i class="ph ph-magnifying-glass text-[15px]"></i>Search or type an address</div>
      <div class="px-1 pb-1.5">
        <div class="px-3 pt-2.5 pb-1 text-[12px] text-muted-foreground">Go to</div>
        ${cmdRow("chat-circle", "Chat", "⌃⌘1 ↩", { on: true })}${cmdRow("folder-simple", "Files", "⌃⌘2")}${cmdRow("globe", "Browser", "⌃⌘3")}${cmdRow("shapes", "Apps", "⌃⌘4")}
        <div class="px-3 pt-2.5 pb-1 text-[12px] text-muted-foreground">Commands</div>
        ${cmdRow("note-pencil", "New chat", "⌘N")}${cmdRow("gear", "Settings", "⌘,")}${cmdRow("keyboard", "Keyboard shortcuts", "?")}
        <div class="px-3 pt-2.5 pb-1 text-[12px] text-muted-foreground">Recent chats</div>
        ${recent.map((r) => cmdRow("chat-circle", r)).join("")}
      </div>
    </div>
    <p class="mt-6 text-[13px] text-muted-foreground">Press <span class="rounded bg-foreground/8 px-1 text-[11px]">⌘K</span> to search from anywhere.</p>
  </div>`;

/** The product's call to action (glyph-button.tsx): a white button carrying the mark and a verb, 32px with `small`. */
const glyphButton = (label, { small = true } = {}) =>
  `<span class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card font-medium text-foreground shadow-xs ${small ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm"}">${brand("instrumentglyph", small ? "size-3.5" : "size-4")}${label}</span>`;

/**
 * Apps filling the card with nothing open (apps-home.tsx): the serif title and its line,
 * Your apps as marks when there are any (`yours`: [mark, name, dot], `dot` the
 * grey waiting dot the rail's Apps wears for a sign-in that was lost), the search, then Popular as two columns of 72px cards with
 * each service's mark and Connect. `connected` names rows that show Open instead.
 */
const appsPlace = ({ connected = [], yours = [] } = {}) => `
  <div class="min-w-0 flex-1 overflow-hidden">
    <div class="mx-auto w-full max-w-5xl space-y-12 px-10 pt-14">
      <header class="max-w-xl"><h1 class="font-serif text-3xl leading-tight tracking-tight text-brand-600">Apps</h1><p class="mt-3 text-[15px] leading-relaxed text-muted-foreground">Connect the services you already use. Instrument does the setup, then works in them from your chats.</p></header>
      ${
        yours.length
          ? `<section><div class="-my-2 flex h-10 items-center gap-3"><h2 class="text-[13px] font-medium text-muted-foreground">Your apps</h2><span class="h-px flex-1 bg-border"></span></div><div class="mt-4 -ml-4 flex flex-wrap gap-x-2 gap-y-4">${yours
              .map(([mark, name, dot]) => `<div class="flex w-24 flex-col items-center gap-1.5 py-2 text-center"><span class="relative grid size-16 place-items-center rounded-2xl bg-card shadow-xs">${mark}${dot ? `<span class="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-foreground/70 ring-2 ring-background"></span>` : ""}</span><span class="w-full truncate text-[13px] leading-4 font-medium">${name}</span></div>`)
              .join("")}</div></section>`
          : ""
      }
      <div class="space-y-10">
        <div class="relative flex h-11 items-center rounded-xl bg-card pl-11 text-[15px] text-muted-foreground shadow-xs"><i class="ph ph-magnifying-glass absolute left-4 text-[16px]"></i>Search apps, or name any service</div>
        <section><div class="-my-2 flex h-10 items-center gap-3"><h2 class="text-[13px] font-medium text-muted-foreground">Popular</h2><span class="h-px flex-1 bg-border"></span></div>
        <div class="mt-4 grid grid-cols-2 gap-3">
          ${APP_ROWS.map(
            ([mark, name, line]) => `
            <div class="flex h-18 items-center gap-3 rounded-2xl bg-card px-5 shadow-xs">
              ${mark}
              <div class="min-w-0 flex-1"><div class="truncate text-[15px] leading-snug font-medium">${name}</div><div class="truncate text-[13px] leading-snug text-muted-foreground">${line}</div></div>
              ${connected.includes(name) ? button("Open", { size: "sm", tone: "outline" }) : glyphButton("Connect")}
            </div>`,
          ).join("")}
        </div></section>
      </div>
    </div>
  </div>`;

/**
 * The release notes (What's new), as a window tab draws them: the serif title with Check
 * for updates at its right, a downloaded update's card first (`ready`: the version), then
 * each version in full on a 152px column of its name and date (the running one says
 * "Your version"), a rule saying "Before this update" when the app just updated (`fresh`),
 * and older versions folded to their first line. `versions` are { version, date, summary,
 * points: [...] , folded } (RELEASES, in scenario.js).
 */
const releaseNotes = ({ versions = RELEASES, yours = 0, ready = "", fresh = false } = {}) => `
  <div class="min-w-0 flex-1 overflow-hidden">
    <div class="mx-auto w-full max-w-3xl px-8 pt-14">
      <div class="flex items-center justify-between gap-6 pb-10"><h1 class="font-serif text-3xl leading-10">What's new</h1>${button("Check for updates", { tone: "ghost", size: "sm", cls: "text-muted-foreground" })}</div>
      ${ready ? `<div class="mb-10 flex items-start gap-3 rounded-xl bg-brand-500/7 p-5"><span class="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-700"><i class="ph ph-arrows-clockwise text-[18px]"></i></span><div class="min-w-0 flex-1"><div class="text-sm font-semibold">${ready} is ready to install</div><div class="mt-1 text-[13px] leading-5 text-foreground/80">Restart to start using it. Your chats pick up where they left off.</div></div>${button("Restart", { tone: "brand", size: "sm" })}</div>` : ""}
      ${versions
        .map((v, i) =>
          v.folded
            ? `${fresh && !versions[i - 1]?.folded ? `<div class="flex items-center gap-3 pb-4 text-xs text-muted-foreground">Before this update<span class="h-px flex-1 bg-border"></span></div>` : ""}<div class="-mx-3 grid grid-cols-[9.5rem_1fr_auto] items-baseline gap-6 rounded-lg px-3 py-2.5"><span class="flex items-baseline gap-2"><span class="text-sm font-medium whitespace-nowrap">${v.version}</span><span class="text-[13px] whitespace-nowrap text-muted-foreground">${v.date}</span></span><span class="truncate text-[13px] text-foreground/75">${v.summary}</span><i class="ph ph-caret-down text-[13px] text-muted-foreground"></i></div>`
            : `<section class="grid grid-cols-[9.5rem_1fr] gap-x-6 gap-y-2 ${i ? "border-t border-border/60 pt-6" : ""} pb-10"><div><h2 class="text-base font-semibold">${v.version}</h2><div class="text-[13px] text-muted-foreground">${v.date}${i === yours ? " · Your version" : ""}</div></div><div class="min-w-0"><p class="text-[15px] leading-6">${v.summary}</p>${v.points ? `<ul class="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground/85">${v.points.map((p) => `<li>${p}</li>`).join("")}</ul>` : ""}</div></section>`,
        )
        .join("")}
    </div>
  </div>`;
