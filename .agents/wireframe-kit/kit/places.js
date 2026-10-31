// ---- New tab and Apps ------------------------------------------------------------

/** A command row in the New tab page's list: icon, words, and the shortcut at the right. */
const cmdRow = (icon, label, keys = "", { on = false } = {}) =>
  `<div class="flex h-8 items-center gap-2.5 rounded-lg px-3 text-sm ${on ? "bg-foreground/8" : ""}"><i class="ph ph-${icon} text-[15px] text-muted-foreground"></i><span class="flex-1">${label}</span><span class="text-[11px] text-muted-foreground">${keys}</span></div>`;

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

/** Apps filling the card with nothing open: the serif title and its line, the search, then Popular as two columns of rows with Connect. `connected` names rows that show Open instead. */
const appsPlace = ({ connected = [] } = {}) => `
  <div class="min-w-0 flex-1 overflow-hidden px-[126px] pt-14">
    <h1 class="font-serif text-[32px] text-brand-700">Apps</h1>
    <p class="mt-2 max-w-[570px] text-[15px] leading-[26px] text-muted-foreground">Connect the services you already use. Instrument does the setup, then works in them from your chats.</p>
    <div class="mt-12 flex h-11 items-center gap-2.5 rounded-xl border border-border bg-card px-4 text-[15px] text-muted-foreground"><i class="ph ph-magnifying-glass text-[16px]"></i>Search apps, or name any service</div>
    <div class="mt-8 flex items-center gap-3 text-sm text-muted-foreground">Popular<span class="h-px flex-1 bg-border"></span></div>
    <div class="mt-4 grid grid-cols-2 gap-3">
      ${APP_ROWS.map(
        ([mark, name, line]) => `
        <div class="flex h-[72px] items-center gap-3 rounded-2xl border border-border bg-card px-5">
          ${mark}
          <div class="min-w-0 flex-1"><div class="text-[15px] font-medium">${name}</div><div class="truncate text-[13px] text-muted-foreground">${line}</div></div>
          <span class="flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 text-[13px] font-medium ring-1 ring-border">${brand("instrumentglyph", "size-3.5")}${connected.includes(name) ? "Open" : "Connect"}</span>
        </div>`,
      ).join("")}
    </div>
  </div>`;
