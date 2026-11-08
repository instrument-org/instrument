// The baseline: every surface the kit draws, as the app has it today, one frame each.
// Build it after changing the kit and look at it before drawing a round:
//   node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
// A proposal starts from one of these frames and changes only what it argues about.
// `measure` names the picture of the running app measure/ takes for the same state, so
// `node .agents/wireframe-kit/measure/measure.mjs <dir>` lays each frame beside it.

const META = {
  title: "Kit baseline: every surface as built",
  line: "Everything the wireframe kit draws as the app ships today: the chat list, window tabs, Files and its omnibar, Browser, Settings and the overlays, then the chat, setup, and the Mac and web around the app.",
  source:
    "We drew the window frames with the kit in kit/, measured from the running app on the documents fixture at 1280x800 (2026-11-07). The chats, files, pages, prices, projects and release notes are the kit's invented pricing scenario. The desktop, menu bar, notification, Finder and website frames come from mac.js, drawn from macOS and a generic browser without measuring.",
  slotH: 300,
};

const D = { w: DESKTOP.w, h: DESKTOP.h };
const chatBar = winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] });
const waitingHead = threadHead(PRICING_TITLE, { project: "Pricing" });
const running = () => inboxCol({ on: 0 }) + thread({ working: "Reading plans on zendesk.com", project: "Pricing" });

const states = [
  // ---- the chat list -------------------------------------------------------------
  {
    title: "Chats",
    note: "The window opens on Chat with a new chat waiting beside the list: the search and its places over the projects, then the chats under them.",
    measure: "chats",
    body: appWindow(),
  },
  {
    title: "Chat running",
    note: "While the pricing chat runs, its newest step shimmers on its row, an unread chat wears the green dot, and the row names its project in the project's color.",
    measure: "chat",
    body: appWindow({ bar: chatBar, body: running() }),
  },
  {
    title: "View options",
    note: "The button at the search's end picks how many lines a row shows and whether the list puts a heading over each day.",
    measure: "inbox-view-menu",
    body: appWindow({
      bar: chatBar,
      body: inboxCol({ on: 0, picking: true }) + thread({ working: "Reading plans on zendesk.com" }),
      over: viewMenu(),
    }),
  },
  {
    title: "Search marks",
    note: "Clicking into the empty search offers Unread and Starred, and a pick stands in the field as a token that narrows whatever the list shows.",
    measure: "inbox-tokens",
    body: appWindow({ bar: chatBar, body: inboxCol({ on: 0, offer: ["unread", "starred"] }) + thread({ working: "Reading plans on zendesk.com" }) }),
  },
  {
    title: "Chat list search",
    note: "Typing raises the search into a white field and puts the projects away, and we bold the words that matched in each row.",
    measure: "inbox-search",
    body: appWindow({ bar: chatBar, body: inboxCol({ on: 0, search: "pricing", rows: [ROWS[0]] }) + thread({ working: "Reading plans on zendesk.com" }) }),
  },
  {
    title: "Row under the pointer",
    note: "Under the pointer a row trades its time and star for its controls: file under a project, pop out, archive, mark unread and star. A reply waiting unsent marks the title Draft in red.",
    body: appWindow({
      bar: chatBar,
      body: inboxCol({ on: 0, hover: 3, rows: [ROWS[0], { ...ROWS[1], draft: true }, ROWS[2], ROWS[3], ROWS[4]] }) + thread({ working: "Reading plans on zendesk.com" }),
    }),
  },
  {
    title: "Two-line rows",
    note: "At two lines a row keeps its title and time, then its project, or its latest line while it works or waits, with what it holds as marks at the right.",
    body: appWindow({ bar: chatBar, body: inboxCol({ on: 0, density: "two" }) + thread({ working: "Reading plans on zendesk.com" }) }),
  },
  {
    title: "One-line rows",
    note: "At one line a row is its title, with the project just before the time, and the gutter's dot pulses while the chat works.",
    body: appWindow({ bar: chatBar, body: inboxCol({ on: 0, density: "one" }) + thread({ working: "Reading plans on zendesk.com" }) }),
  },
  {
    title: "Project",
    note: "Stepping into a project washes the list in its color under its mark, name and instructions, and puts a new chat filed under it beside the list. Inbox leads back out.",
    measure: "inbox-project",
    body: appWindow({
      bar: chatBar,
      body: inboxCol({ on: -1, project: "Pricing", rows: [ROWS[0], { title: "Intercom's AI agent pricing per resolution", preview: "Fin bills $0.99 per resolution on every plan, on top of the seat price.", time: "Tue", holds: [{ site: "intercom" }] }, { title: "Freshdesk plan limits for 10 agents", preview: "Pro covers 10 agents with custom roles; Growth stops at 5 collaborators.", time: "Oct 22", holds: [{ site: "freshdesk" }] }] }) + noChatOpen({ project: "Pricing" }),
    }),
  },
  {
    title: "Drafts",
    note: "Each draft is a row with a dashed circle where a chat shows its dot, and it says Draft where a chat shows its latest line.",
    body: appWindow({
      body:
        inboxCol({
          drafts: [
            { title: "Draft the email announcing our new plans", time: "9:12 AM", holds: [{ app: "gmail" }, { file: "faq" }] },
            { title: "Compare the four SOC 2 audit quotes", time: "Yesterday" },
          ],
        }) + noChatOpen(),
    }),
  },
  // ---- window tabs and the bar ---------------------------------------------------------
  {
    title: "Window tabs",
    note: "Tabs grow to 240 pixels and share the bar evenly, cutting a long title with a fade rather than an ellipsis, with a hairline between tabs that aren't up.",
    measure: "tabs-five",
    body: appWindow({
      on: "files",
      bar: winBar({ tabs: [{ site: "g2" }, { chats: true, title: PRICING_TITLE }, { folder: "Instrument" }, { apps: true }, { file: "comparison" }], active: 4 }),
      body: fileBeside(),
    }),
  },
  {
    title: "Window tabs crowded",
    note: "When the bar runs out of room the tab up keeps its name and the rest go to their marks, and hovering one shows its whole title and where it is.",
    measure: "tab-hover",
    body: appWindow({
      on: "",
      bar: winBar({ tabs: [{ site: "g2" }, { chats: true, title: PRICING_TITLE }, { folder: "Instrument" }, { apps: true }, { file: "comparison" }, { newtab: true }, { browser: true }, { site: "zendesk" }, { site: "intercom" }, { site: "freshdesk" }, { file: "prices" }, { notes: true }], active: 11, hover: 1, right: statusPill("update") }),
      body: releaseNotes(),
      over: tooltip(PRICING_TITLE, { left: 150, top: 42, detail: "Reading plans on zendesk.com" }),
    }),
  },
  {
    title: "Bell",
    note: "The bell lists a crash from an earlier session and what we send, each with its own button and Dismiss, and a dot on the bell says something is new.",
    measure: "bell",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }], bell: { open: true } }),
      body: running(),
      over: notificationsPop({ items: [{ icon: "warning-circle", tone: "problem", title: "Instrument quit unexpectedly", when: "9:44 AM", line: "Sending a report helps us fix what went wrong.", actions: ["Send a report"] }, { icon: "megaphone-simple", title: "Hello from the notices feed", when: "Oct 9", line: "This is the first notice, sent only to the beta channel, to check that the bell can hear from us. Dismiss it whenever you like." }] }),
    }),
  },
  {
    title: "Status pill",
    note: "A warning pill sits before the bell while Instrument can't be reached, and pressing it says what's out and what still works.",
    measure: "status-pill",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }], right: statusPill("unreachable") }),
      body: running(),
      over: statusCard("Can't reach Instrument models", "Chats on Instrument models, web search, and dictation aren't available right now. Chats on your own providers keep working."),
    }),
  },
  // ---- Files ----------------------------------------------------------------------
  {
    title: "Files",
    note: "Files opens on a folder in Table, its places down the side and one row across the top: the four views, sort, more and search, the omnibar walking the path, and Ask.",
    measure: "files-table",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ folder: "Instrument" }] }), body: finder({ pick: 6 }) }),
  },
  {
    title: "Files list",
    note: "List shows each file's picture with its title over its name, so a folder of pages reads by what they're about.",
    measure: "files-list",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ folder: "Instrument" }] }), body: finder({ view: "list" }) }),
  },
  {
    title: "Files grid",
    note: "Grid lays the folder out as pictures with their names under them.",
    measure: "files-grid",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ folder: "Instrument" }] }), body: finder({ view: "icons" }) }),
  },
  {
    title: "Files columns",
    note: "Columns walks the path a column at a time, and a picked file shows its picture and details after the last one.",
    measure: "files-columns",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ folder: "Instrument" }] }), body: finder({ view: "columns", pick: 6 }) }),
  },
  {
    title: "Files sort",
    note: "The sort menu picks the order and the grouping, and shows hidden files.",
    measure: "files-sort-menu",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ folder: "Instrument" }] }), body: finder(), over: sortMenu() }),
  },
  {
    title: "Files search",
    note: "Search opens a field in place of the views and buttons, and Show only narrows the folder to one kind of file.",
    measure: "files-search",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ folder: "Instrument" }] }), body: finder({ search: true }), over: kindMenu() }),
  },
  {
    title: "Files omnibar",
    note: "Typing into the omnibar finds files in the folder as you go, and Return opens the first.",
    measure: "files-omnibar-typing",
    body: appWindow({
      on: "files",
      bar: winBar({ tabs: [{ folder: "Instrument" }] }),
      body: finder({ omni: { typed: "pri" } }),
      over: omniMenu([[fileMark("html"), "pricing-comparison.html"], [fileMark("md"), "pricing-page-faq.md"], [fileMark("csv"), "competitor-prices.csv"]], { left: 536, top: 82, w: 660 }),
    }),
  },
  {
    title: "Files without the sidebar",
    note: "The toggle at the row's left folds the places away, and the listing and the row take the width.",
    measure: "files-no-sidebar",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ folder: "Instrument" }] }), body: finder({ side: false, pick: 6 }) }),
  },
  {
    title: "File beside its folder",
    note: "Opening a file puts it beside its folder, which narrows to a column, and the row splits at the column's edge with the file's own controls over it.",
    measure: "files-beside",
    body: appWindow({ on: "files", bar: winBar({ tabs: [{ file: "comparison" }] }), body: fileBeside() }),
  },
  // ---- Browser, New tab, Apps, release notes -----------------------------------------------
  {
    title: "Browser",
    note: "With no page open, Browser is the omnibar over Bookmarks and Recent pages.",
    measure: "browser-home",
    body: appWindow({ on: "browser", bar: winBar({ tabs: [{ browser: true }] }), body: browserHome() }),
  },
  {
    title: "Browser page",
    note: "A page fills the card under its location row, with reload framed at its left, the omnibar across the row with the host quiet, then the extensions, Ask and the page's menu, each framed the same way.",
    measure: "browser-page",
    body: appWindow({ on: "browser", bar: winBar({ tabs: [{ chats: true }, { site: "g2" }], active: 1 }), body: placeCard({ tab: { site: "g2" } }) }),
  },
  {
    title: "Browser omnibar",
    note: "Typing an address or words offers a web search first, then suggestions, in a panel as wide as the field.",
    measure: "browser-typing",
    body: appWindow({
      on: "browser",
      bar: winBar({ tabs: [{ browser: true }] }),
      body: browserHome({ omni: { typed: "zen" } }),
      over: omniMenu([[searchMark, "Search the web for “zen”"], [searchMark, "zendesk"], [searchMark, "zendesk pricing"], [searchMark, "zendesk suite team"], [SITES.zendesk.mark(), "Suite plans · Zendesk", "zendesk.com"]], { left: 86, top: 82, w: 1178 }),
    }),
  },
  {
    title: "Page menu",
    note: "The page's menu holds bookmarks, printing, finding and saving, and the developer's tools.",
    body: appWindow({ on: "browser", bar: winBar({ tabs: [{ chats: true }, { site: "zendesk" }], active: 1 }), body: placeCard({ tab: { site: "zendesk" } }), over: pageMenu() }),
  },
  {
    title: "New tab",
    note: "A new window tab opens on a greeting over the command menu's list, open in place.",
    measure: "new-tab",
    body: appWindow({ on: "", bar: winBar({ tabs: [{ chats: true }, { newtab: true }], active: 1 }), body: newTabPage() }),
  },
  {
    title: "Command menu",
    note: "⌘K brings the same list up over whatever is open.",
    measure: "command-menu",
    body: appWindow({ bar: chatBar, body: running(), over: commandMenu() }),
  },
  {
    title: "Apps",
    note: "Apps with nothing open lists the popular services in two columns, each with Connect.",
    measure: "apps",
    body: appWindow({ on: "apps", bar: winBar({ tabs: [{ chats: true }, { apps: true }], active: 1 }), body: appsPlace() }),
  },
  {
    title: "Release notes",
    note: "What's new opens on the newest version in full, with older versions folded to their first line.",
    body: appWindow({ on: "", bar: winBar({ tabs: [{ notes: true }] }), body: releaseNotes() }),
  },
  // ---- Settings, Feedback and the overlays -------------------------------------------------
  {
    title: "Settings",
    note: "Settings opens as a large sheet with the search and tabs down its left, and each tab's sections over white cards of rows.",
    measure: "settings-general",
    body: appWindow({ bar: chatBar, body: running(), over: settingsSheet() }),
  },
  {
    title: "Settings providers",
    note: "Providers leads with Instrument, then the AI subscriptions someone may already pay for.",
    measure: "settings-providers",
    body: appWindow({ bar: chatBar, body: running(), over: settingsSheet({ on: "Providers", body: settingsProviders() }) }),
  },
  {
    title: "Settings permissions",
    note: "Permissions lists each folder with how Instrument answers when a chat asks for it.",
    measure: "settings-permissions",
    body: appWindow({ bar: chatBar, body: running(), over: settingsSheet({ on: "Permissions", body: settingsPermissions() }) }),
  },
  {
    title: "Settings memory",
    note: "Memory with nothing in it offers to bring in what another AI already knows.",
    measure: "settings-memory",
    body: appWindow({ bar: chatBar, body: running(), over: settingsSheet({ on: "Memory", body: settingsMemory() }) }),
  },
  {
    title: "Send feedback",
    note: "Feedback lists everything that goes with it, and picking an item shows exactly what it holds before you send.",
    measure: "feedback",
    body: appWindow({ bar: chatBar, body: running(), over: feedbackDialog() }),
  },
  {
    title: "Dialog and toast",
    note: "A dialog asks over the dimmed window with its buttons at the foot, and a toast says what just happened at the bottom left.",
    body: appWindow({
      bar: chatBar,
      body: running(),
      over:
        dialog({ title: "Delete this chat?", line: "This chat and the tasks it started move to your Trash, where you can restore them. Files they saved to your own folders stay where they are.", buttons: button("Cancel", { tone: "outline" }) + button("Delete", { tone: "destructive" }) }) +
        toast("Archived", { action: "Undo" }),
    }),
  },
  {
    title: "Chat menu",
    note: "Right-clicking a row opens the chat's menu, which shares one shape with every menu in the window: rows with their icons, rules between groups, and a caret for a submenu.",
    body: appWindow({ bar: chatBar, body: inboxCol({ on: 0, hover: 1 }) + thread({ working: "Reading plans on zendesk.com" }), over: chatMenu({ left: 230, top: 346, starred: true }) }),
  },
  // ---- a chat -----------------------------------------------------------------------
  {
    title: "Chat with pane",
    note: "The pane beside a chat carries the chat's tabs across its head in the window's own tab strip, with + and × at the end, and the head's tabs button lights while it's up.",
    measure: "chat-pane",
    body: appWindow({
      bar: chatBar,
      body:
        inboxCol({ on: 0, w: 280 }) +
        thread({ body: pricing(3), project: "Pricing", pane: true }) +
        paneCard({ tabs: [{ file: "comparison" }, { file: "prices" }, { site: "zendesk", agent: true }], active: 0 }),
    }),
  },
  {
    title: "Task working",
    note: "A task the chat started shows as a tinted card in the transcript, with its step shimmering and its live card under it showing the page it's on.",
    body: appWindow({
      bar: chatBar,
      body:
        inboxCol({ on: 0 }) +
        thread({
          project: "Pricing",
          stick: "bottom",
          body:
            turnMeta() +
            you("How does our pricing compare with Zendesk, Intercom and Freshdesk?") +
            activityRow("Opened our plans page", { icon: "globe", sites: ["g2"] }) +
            agent("I'll line up each one's list prices against our plans, per agent per month and billed annually, for a 10-agent team.") +
            taskCard({ sites: ["zendesk"], card: liveCard({ tab: { site: "zendesk" }, meta: "0:42" }) }),
        }),
    }),
  },
  {
    title: "Turn finished",
    note: "Once a turn is done its work folds into one line above the reply, the task card goes flat with a check, and the reply's footer says how long it took and what it read.",
    body: appWindow({
      bar: chatBar,
      body:
        inboxCol({ on: 0 }) +
        thread({
          project: "Pricing",
          stick: "bottom",
          body:
            turnMeta() +
            you("How does our pricing compare with Zendesk, Intercom and Freshdesk?") +
            `<div class="flex flex-col gap-2">${workedRow("Worked for 4m", { sites: ["zendesk", "intercom", "freshdesk"] })}${taskCard({ working: false, line: "Noted every tier on three pricing pages", span: "3 min" })}${agent("The comparison is ready: at 10 agents our Team plan is 18% under Zendesk Suite Team and 8% under Freshdesk Pro. Intercom looks cheaper per seat, but its AI agent bills per resolution.")}<div class="flex flex-col gap-1">${fileLine("comparison")}${fileLine("prices")}</div>${replyFoot({ took: "4m 12s", sources: ["zendesk", "intercom", "freshdesk"] })}</div>`,
        }),
    }),
  },
  {
    title: "Permission card",
    note: "When the agent needs a folder, it asks on a card over the reply box, and the cards waiting behind it stack under it.",
    body: appWindow({ bar: chatBar, body: inboxCol({ on: 0 }) + thread({ head: waitingHead, foot: permissionCard({ more: 1 }) }) }),
  },
  {
    title: "Question card",
    note: "When the agent needs a choice, it asks on a card with the choices as radio rows and room to write your own.",
    body: appWindow({ bar: chatBar, body: inboxCol({ on: 0 }) + thread({ head: waitingHead, foot: questionCard({ steps: ["Team size", "Billing", "Competitors", "Review"] }) }) }),
  },
  {
    title: "Floating chat",
    note: "A chat popped out from its head docks 420 pixels wide at the bottom right over whichever place is open, and a draft put down waits beside it as a dark bar.",
    body: appWindow({
      on: "files",
      bar: winBar({ tabs: [{ chats: true }, { folder: "Instrument" }], active: 1 }),
      body: finder(),
      over: smallChat({ working: "Reading plans on zendesk.com", project: "Pricing" }) + composeBar("Draft the email announcing our new plans", { right: 452 }),
    }),
  },
  {
    title: "New chat",
    note: "New on the Chat screen writes a new chat beside the list, in the room a chat would have, and nothing is saved until something's written in it.",
    measure: "draft",
    body: appWindow({ bar: winBar({ tabs: [{ chats: true }] }), body: inboxCol({ on: -1 }) + newChat() }),
  },
  {
    title: "New chat with chips",
    note: "Whatever goes with the message sits as chips over the words while the pane is put away, and pressing one brings the pane up on it.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true }] }),
      body: inboxCol({ on: -1 }) + newChat({ project: "Pricing", text: "Turn the comparison into a one-page brief for the sales team", chips: composerChip({ site: "zendesk" }) + composerChip({ file: "comparison" }) }),
    }),
  },
  {
    title: "Draft",
    note: "Anywhere but Chat, New docks a draft at the bottom right: the chat's composer on a white card with the project slot and the window's buttons over it, and what's in view offered beside the plus.",
    measure: "draft-docked",
    body: appWindow({
      on: "files",
      bar: winBar({ tabs: [{ folder: "Instrument" }] }),
      body: finder({ pick: 6 }),
      over: composeWin({ offer: offerChip({ file: "comparison" }) }),
    }),
  },
  {
    title: "Draft with a page",
    note: "A page or file opened in a draft shows in a well under the composer, and its chip is raised to say it's the one showing.",
    body: appWindow({
      on: "files",
      bar: winBar({ tabs: [{ folder: "Instrument" }] }),
      body: finder(),
      over: composeWin({ project: "Pricing", words: "Check Zendesk's Suite tiers against our plans", chips: composerChip({ site: "zendesk" }, { on: true }) + composerChip({ file: "prices" }), well: { site: "zendesk" } }),
    }),
  },
  {
    title: "Reply box with plus menu",
    note: "When the chosen model has a problem, a yellow note floats over the reply box with the way to fix it, and the plus menu opens its own width from the box's left edge.",
    body: appWindow({
      bar: chatBar,
      body: inboxCol({ on: 0 }) + thread({ project: "Pricing", foot: replyNote("No models available") }),
      over: plusMenu({ left: 462, top: 396 }),
    }),
  },
  {
    title: "Model picker",
    note: "The picker opens on the connection holding the chosen model. While Auto is all Instrument offers, we draw it centered with its one button.",
    w: PICKER_W,
    h: PICKER_H,
    body: pickerCrop(modelPicker({ open: "instrument", held: "instrument", list: pickerAutoOnly({ on: true }) })),
  },
  {
    title: "Chat in the dark theme",
    note: "The window takes the dark theme from `dark`, which flips every token the kit draws with.",
    body: appWindow({ dark: true, bar: chatBar, body: running() }),
  },
  // ---- setup, and outside the window ----------------------------------------------------
  {
    title: "Setup sign-in",
    note: "Setup fills the app window at its own 1080x720, and this is the step a new person signs in on.",
    ...SETUP,
    body: setupChooseAI(),
  },
  {
    title: "Desktop",
    note: "We show the window at 80% on a Mac, with the menu bar and the Dock around it.",
    ...D,
    body: macDesktop({ windows: placed(appWindow({ bar: chatBar, body: inboxCol({ on: 0 }) + thread() }), { left: 120, top: 70 }) }),
  },
  {
    title: "Menu bar extra",
    note: "Instrument's icon sits with the other status items in the menu bar, and its panel stays open while another app is in front.",
    ...D,
    body: macDesktop({
      bar: menuBar({ app: "Mail", menus: ["File", "Edit", "View", "Mailbox", "Message"], extra: true, lit: true }),
      windows: placed(finderWindow(), { left: 140, top: 110, w: 900, h: 560, scale: 1 }),
      over: menuBarPanel(`<div class="flex h-11 items-center gap-2 border-b border-black/10 px-3 text-[13px] font-medium">${brandMark("size-5")}Instrument</div><div class="flex-1 space-y-2 p-3">${row(ROWS[0])}${row(ROWS[1])}</div><div class="p-2.5">${replyBox()}</div>`),
    }),
  },
  {
    title: "Notification",
    note: "Instrument's notifications show up as a banner over whatever app is in front.",
    ...D,
    body: macDesktop({
      bar: menuBar({ app: "Finder", menus: ["File", "Edit", "View", "Go", "Window", "Help"] }),
      windows: placed(finderWindow(), { left: 140, top: 110, w: 900, h: 560, scale: 1 }),
      over: macNotification({ sub: PRICING_TITLE, body: "The comparison is ready: at 10 agents our Team plan is 18% under Zendesk Suite Team." }),
    }),
  },
  {
    title: "Finder context menu",
    note: "Right-clicking one of the user's own files opens the Mac's menu, so we draw macOS here rather than Studio.",
    ...D,
    body: macDesktop({
      bar: menuBar({ app: "Finder", menus: ["File", "Edit", "View", "Go", "Window", "Help"] }),
      windows: placed(finderWindow({ pick: 2 }), { left: 140, top: 110, w: 900, h: 560, scale: 1 }),
      over: contextMenu(["Open", ["Open With", { sub: true }], "rule", "Move to Trash", "rule", "Get Info", "Rename", "Quick Look", "rule", ["Share…", { sub: true }], "rule", ["Quick Actions", { sub: true }]], { left: 520, top: 300 }),
    }),
  },
  {
    title: "Website",
    note: "This is the first thing people see before they install, in their own browser.",
    ...D,
    body: macDesktop({
      bar: menuBar({ app: "Safari", menus: ["File", "Edit", "View", "History", "Bookmarks", "Window", "Help"] }),
      windows: placed(
        browserWindow({
          body: `<div class="flex h-full flex-col items-center justify-center gap-5 bg-[#fcfbf8] text-center">${brandMark("size-16")}<div class="font-serif text-[40px] leading-tight font-medium tracking-tight">Instrument</div><div class="space-y-2">${bars2("420px", "360px")}</div><span class="mt-2 flex h-10 items-center gap-2 rounded-full bg-brand-600 px-5 text-[14px] font-medium text-white"><i class="ph ph-apple-logo"></i>Download for Mac</span></div>`,
        }),
        { left: 156, top: 60, w: 1200, h: 780, scale: 1 },
      ),
    }),
  },
];
