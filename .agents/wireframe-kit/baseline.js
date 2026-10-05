// The baseline: every surface the kit draws, as the app has it today, one frame each.
// Build it after changing window.js or mac.js and look at it before drawing a round:
//   node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
// A proposal starts from one of these frames and changes only what it argues about.

const META = {
  title: "Kit baseline: every surface as built",
  line: "What the wireframe kit draws without being asked to change anything: the window's places, the chat and its pane, the floating chat, onboarding, and the Mac and the web around the app.",
  source:
    "Window frames from window.js, measured off the running app on the documents fixture. Desktop, menu bar, notification, Finder and website frames from mac.js are drawn from macOS and a generic browser, not measured.",
  slotH: 300,
};

const D = { w: DESKTOP.w, h: DESKTOP.h };

const states = [
  {
    title: "Chat with nothing open",
    note: "Where the window lands: the rail, the inbox, and the empty state. There is no Home page.",
    body: appWindow(),
  },
  {
    title: "A chat at work",
    note: "The Lisbon thread running: its work in flight at the header's right, the newest step shimmering, pressed for the chat's tasks.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: LISBON_TITLE }] }),
      body:
        inboxCol({ on: 0 }) +
        thread({ working: "Checking fares on flytap.com" }),
    }),
  },
  {
    title: "A chat with its pane",
    note: "The chat's tiles in a row over its reply box, the one shown ringed; the pane flush beside the chat, its location row ending in the × that puts it away.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: LISBON_TITLE }] }),
      body:
        inboxCol({ on: 0, w: 280 }) +
        thread({
          body: lisbon(3),
          tiles: chatTiles(
            [
              { file: "itinerary" },
              { file: "costs" },
              { site: "tap", agent: true },
            ],
            0,
          ),
        }) +
        paneCard({ tab: { file: "itinerary" } }),
    }),
  },
  {
    title: "Files",
    note: "The Finder as Files' first tab, under its location row.",
    body: appWindow({
      on: "files",
      bar: winBar({
        tabs: [{ chats: true }, { file: "itinerary" }],
        active: 0,
      }),
      body: placeCard({
        tab: { file: "itinerary" },
        body: finder({ pick: 4 }),
      }),
    }),
  },
  {
    title: "Browser",
    note: "A website as a window tab, filling the card.",
    body: appWindow({
      on: "browser",
      bar: winBar({ tabs: [{ chats: true }, { site: "booking" }], active: 1 }),
      body: placeCard({ tab: { site: "booking" } }),
    }),
  },
  {
    title: "Floating chat",
    note: "The small view over whatever place is up, 420 wide at the bottom right.",
    body: appWindow({
      on: "files",
      bar: winBar({
        tabs: [{ chats: true }, { file: "itinerary" }],
        active: 1,
      }),
      body: placeCard({ tab: { file: "itinerary" } }),
      over: smallChat({
        tabs: [{ site: "tap", agent: true }, { file: "itinerary" }],
        working: "Checking fares on flytap.com",
      }),
    }),
  },
  {
    title: "Floating chat peeking at a tile",
    note: "A tile pressed in the small view opens in a card over the conversation, the tile ringed; Expand grows the window with it up, × puts it down.",
    body: appWindow({
      on: "files",
      bar: winBar({
        tabs: [{ chats: true }, { file: "itinerary" }],
        active: 1,
      }),
      body: placeCard({ tab: { file: "itinerary" } }),
      over: smallChat({
        tabs: [{ site: "tap", agent: true }, { file: "itinerary" }],
        peek: 0,
      }),
    }),
  },
  {
    title: "Draft",
    note: "A new chat's compose window docked at the bottom right: the model and the arrow in its head, the words, then the band with the ways in.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: LISBON_TITLE }] }),
      body: inboxCol({ on: 0 }) + thread(),
      over: composeWin(),
    }),
  },
  {
    title: "Reply box and its plus menu",
    note: "The reply box opened up with a model notice leading it, and the plus menu, where the reply box offers the model.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: LISBON_TITLE }] }),
      body:
        inboxCol({ on: 0 }) +
        thread({
          replyEl: replyBoxOpen({
            extras: modelProblem("No models available"),
          }),
        }),
      over: plusMenu({ left: 456, top: 486 }),
    }),
  },
  {
    title: "Menu and sheet",
    note: "The two overlays the window uses: a popover menu and a sheet over a dimmed window.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: LISBON_TITLE }] }),
      body: inboxCol({ on: 0 }) + thread(),
      over:
        menu(
          [
            [`<i class="ph ph-star"></i>`, "Star"],
            [`<i class="ph ph-pencil-simple"></i>`, "Rename"],
            "rule",
            [`<i class="ph ph-trash"></i>`, "Delete chat…"],
          ],
          { left: 560, top: 92 },
        ) +
        sheet(
          `<div class="p-6 text-[15px] font-semibold">A sheet</div><div class="space-y-2 px-6">${bars2("70%", "52%", "60%")}</div>`,
          { w: 520, h: 300 },
        ),
    }),
  },
  {
    title: "Onboarding: sign in",
    note: "Onboarding's own 480x600 window, the sign-in step as built.",
    w: 480,
    h: 600,
    body: onboardWin({ body: onboardLogin() }),
  },
  {
    title: "On the desktop",
    note: "The window at 80% on the Mac, with the menu bar and the Dock around it.",
    ...D,
    body: macDesktop({
      windows: placed(
        appWindow({
          bar: winBar({ tabs: [{ chats: true, title: LISBON_TITLE }] }),
          body: inboxCol({ on: 0 }) + thread(),
        }),
        { left: 120, top: 70 },
      ),
    }),
  },
  {
    title: "Menu bar extra",
    note: "Instrument's glyph among the status items, its panel open while another app is in front.",
    ...D,
    body: macDesktop({
      bar: menuBar({
        app: "Mail",
        menus: ["File", "Edit", "View", "Mailbox", "Message"],
        extra: true,
        lit: true,
      }),
      windows: placed(finderWindow(), {
        left: 140,
        top: 110,
        w: 900,
        h: 560,
        scale: 1,
      }),
      over: menuBarPanel(
        `<div class="flex h-11 items-center gap-2 border-b border-black/10 px-3 text-[13px] font-medium">${brandMark("size-5")}Instrument</div><div class="flex-1 space-y-2 p-3">${row(ROWS[0], { first: true })}${row(ROWS[1])}</div><div class="p-2.5">${replyBox()}</div>`,
      ),
    }),
  },
  {
    title: "Notification",
    note: "A banner from Instrument over another app.",
    ...D,
    body: macDesktop({
      bar: menuBar({
        app: "Finder",
        menus: ["File", "Edit", "View", "Go", "Window", "Help"],
      }),
      windows: placed(finderWindow(), {
        left: 140,
        top: 110,
        w: 900,
        h: 560,
        scale: 1,
      }),
      over: macNotification({
        sub: LISBON_TITLE,
        body: "The itinerary is ready: five days, Alfama base, Sintra on day three.",
      }),
    }),
  },
  {
    title: "Finder context menu",
    note: "A right click on the user's own file, in the Mac's menu, not Studio's.",
    ...D,
    body: macDesktop({
      bar: menuBar({
        app: "Finder",
        menus: ["File", "Edit", "View", "Go", "Window", "Help"],
      }),
      windows: placed(finderWindow({ pick: 2 }), {
        left: 140,
        top: 110,
        w: 900,
        h: 560,
        scale: 1,
      }),
      over: contextMenu(
        [
          "Open",
          ["Open With", { sub: true }],
          "rule",
          "Move to Trash",
          "rule",
          "Get Info",
          "Rename",
          "Quick Look",
          "rule",
          ["Share…", { sub: true }],
          "rule",
          ["Quick Actions", { sub: true }],
        ],
        { left: 520, top: 300 },
      ),
    }),
  },
  {
    title: "The website",
    note: "Someone else's browser, for the first thing people see before installing.",
    ...D,
    body: macDesktop({
      bar: menuBar({
        app: "Safari",
        menus: [
          "File",
          "Edit",
          "View",
          "History",
          "Bookmarks",
          "Window",
          "Help",
        ],
      }),
      windows: placed(
        browserWindow({
          body: `<div class="flex h-full flex-col items-center justify-center gap-5 bg-[#fcfbf8] text-center">${brandMark("size-16")}<div class="font-serif text-[40px] leading-tight font-medium tracking-tight">Instrument</div><div class="space-y-2">${bars2("420px", "360px")}</div><span class="mt-2 flex h-10 items-center gap-2 rounded-full bg-brand-600 px-5 text-[14px] font-medium text-white"><i class="ph ph-apple-logo"></i>Download for Mac</span></div>`,
        }),
        { left: 156, top: 60, w: 1200, h: 780, scale: 1 },
      ),
    }),
  },
];
