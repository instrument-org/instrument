// The baseline: every surface the kit draws, as the app has it today, one frame each.
// Build it after changing window.js or mac.js and look at it before drawing a round:
//   node .agents/wireframe-kit/build.mjs .agents/wireframe-kit/baseline.js ~/wireframes/kit-baseline.html
// A proposal starts from one of these frames and changes only what it argues about.

const META = {
  title: "Kit baseline: every surface as built",
  line: "Everything the wireframe kit draws as the app ships today, from the window's places, the chat and the floating chat to onboarding and the Mac and web around the app.",
  source:
    "We drew the window frames with window.js, which we measured from the running app on the documents fixture. The desktop, menu bar, notification, Finder and website frames come from mac.js, which we drew from macOS and a generic browser without measuring.",
  slotH: 300,
};

const D = { w: DESKTOP.w, h: DESKTOP.h };

const states = [
  {
    title: "Empty chat",
    note: "The window opens here, with the rail, the inbox and an empty chat, and there's no Home page.",
    body: appWindow(),
  },
  {
    title: "Drafts",
    note: "In Drafts we light the Drafts icon and leave the Chats icon plain. Each draft is a row with a dashed circle on the left, and it says Draft where a chat would show its latest message.",
    body: appWindow({
      body:
        inboxCol({
          drafts: [
            {
              title: "Draft the email announcing our new plans",
              time: "9:12 AM",
            },
            { title: "Compare the four SOC 2 audit quotes", time: "Yesterday" },
          ],
        }) + noChatOpen(),
    }),
  },
  {
    title: "Chat running",
    note: "While the pricing chat runs, we show its newest step shimmering at the right of the header, and pressing it lists the chat's tasks.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] }),
      body:
        inboxCol({ on: 0 }) +
        thread({ working: "Reading plans on zendesk.com" }),
    }),
  },
  {
    title: "Chat with pane",
    note: "The chat's tiles sit in a row above the reply box, and we ring the one that's open in the pane. The pane sits right beside the chat, and the × at the end of its location row closes it.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] }),
      body:
        inboxCol({ on: 0, w: 280 }) +
        thread({
          body: pricing(3),
          tiles: chatTiles(
            [
              { file: "comparison" },
              { file: "prices" },
              { site: "zendesk", agent: true },
            ],
            0,
          ),
        }) +
        paneCard({ tab: { file: "comparison" } }),
    }),
  },
  {
    title: "Files",
    note: "Files opens the Finder as its first tab, under the location row.",
    body: appWindow({
      on: "files",
      bar: winBar({
        tabs: [{ chats: true }, { file: "comparison" }],
        active: 0,
      }),
      body: placeCard({
        tab: { file: "comparison" },
        body: finder({ pick: 4 }),
      }),
    }),
  },
  {
    title: "Browser",
    note: "A website opens as a window tab and fills the card.",
    body: appWindow({
      on: "browser",
      bar: winBar({ tabs: [{ chats: true }, { site: "g2" }], active: 1 }),
      body: placeCard({ tab: { site: "g2" } }),
    }),
  },
  {
    title: "Floating chat",
    note: "The floating chat sits 420 pixels wide at the bottom right, over whichever place is open.",
    body: appWindow({
      on: "files",
      bar: winBar({
        tabs: [{ chats: true }, { file: "comparison" }],
        active: 1,
      }),
      body: placeCard({ tab: { file: "comparison" } }),
      over: smallChat({
        tabs: [{ site: "zendesk", agent: true }, { file: "comparison" }],
        working: "Reading plans on zendesk.com",
      }),
    }),
  },
  {
    title: "Floating chat with tile preview",
    note: "Pressing a tile in the floating chat opens it in a card over the conversation and rings the tile. Expand makes the window bigger with the tile still open, and × closes the card.",
    body: appWindow({
      on: "files",
      bar: winBar({
        tabs: [{ chats: true }, { file: "comparison" }],
        active: 1,
      }),
      body: placeCard({ tab: { file: "comparison" } }),
      over: smallChat({
        tabs: [{ site: "zendesk", agent: true }, { file: "comparison" }],
        peek: 0,
      }),
    }),
  },
  {
    title: "Draft",
    note: "A new chat opens a compose window docked at the bottom right. The model picker and send button are in its header, and below the text we offer Browser, This Mac and Apps, plus a place to drop files.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] }),
      body: inboxCol({ on: 0 }) + thread(),
      over: composeWin(),
    }),
  },
  {
    title: "Reply box with plus menu",
    note: "When the chosen model has a problem, the open reply box leads with a notice about it, and the plus menu is where you pick another model.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] }),
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
    title: "Model picker",
    note: "The picker opens on the connection holding the chosen model. While Auto is all Instrument offers, we draw it centered with its one button.",
    w: PICKER_W,
    h: PICKER_H,
    body: pickerCrop(
      modelPicker({
        open: "instrument",
        held: "instrument",
        list: pickerAutoOnly({ on: true }),
      }),
    ),
  },
  {
    title: "Menu and sheet",
    note: "The window uses two kinds of overlay, a popover menu and a sheet over the dimmed window.",
    body: appWindow({
      bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] }),
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
    title: "Onboarding sign-in",
    note: "Onboarding runs in its own 480x600 window, and this is the sign-in step as it ships.",
    w: 480,
    h: 600,
    body: onboardWin({ body: onboardLogin() }),
  },
  {
    title: "Desktop",
    note: "We show the window at 80% on a Mac, with the menu bar and the Dock around it.",
    ...D,
    body: macDesktop({
      windows: placed(
        appWindow({
          bar: winBar({ tabs: [{ chats: true, title: PRICING_TITLE }] }),
          body: inboxCol({ on: 0 }) + thread(),
        }),
        { left: 120, top: 70 },
      ),
    }),
  },
  {
    title: "Menu bar extra",
    note: "Instrument's icon sits with the other status items in the menu bar, and its panel stays open while another app is in front.",
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
    note: "Instrument's notifications show up as a banner over whatever app is in front.",
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
        sub: PRICING_TITLE,
        body: "The comparison is ready: at 10 agents our Team plan is 18% under Zendesk Suite Team.",
      }),
    }),
  },
  {
    title: "Finder context menu",
    note: "Right-clicking one of the user's own files opens the Mac's menu, so we draw macOS here rather than Studio.",
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
    title: "Website",
    note: "This is the first thing people see before they install, in their own browser.",
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
