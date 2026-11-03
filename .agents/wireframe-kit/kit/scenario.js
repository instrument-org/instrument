// ---- the scenario ---------------------------------------------------------------
// The shared, invented scenario every round draws: someone at a help desk company lining
// up competitors' list prices against their own plans ("Help desk pricing against
// competitors"), with the chats, files, pages and projects around it. Keep to it so rounds
// compare, add to it rather than renaming what is here, and keep new data to work people
// do for a business. The home folder is `mac-user`.

// Sites the pricing thread's task opens. Invented pages and prices, real hosts.
const SITES = {
  zendesk: {
    title: "Suite plans · Zendesk",
    host: "zendesk.com",
    mark: (s) => letterMark("Z", "bg-[#03363d]", s),
  },
  intercom: {
    title: "Pricing · Intercom",
    host: "intercom.com",
    mark: (s) => letterMark("I", "bg-[#1f1f1f]", s),
  },
  freshdesk: {
    title: "Plans · Freshdesk",
    host: "freshworks.com",
    mark: (s) => letterMark("F", "bg-[#25c16f]", s),
  },
  g2: {
    title: "Help desk software · G2",
    host: "g2.com",
    mark: (s) => letterMark("G2", "bg-[#ff492c]", s),
  },
  wayback: {
    title: "zendesk.com/pricing · Wayback Machine",
    host: "web.archive.org",
    mark: (s) => letterMark("W", "bg-[#5c5c5c]", s),
  },
  notion: {
    title: "Pricing and packaging · Notion",
    host: "notion.so",
    mark: (s) => brand("notion", s ? s.split(" ")[0] : "size-4"),
  },
};

// Files the pricing thread's task makes, and two from the user's folder.
const FILES = {
  comparison: { title: "pricing-comparison.html", kind: "html" },
  prices: { title: "competitor-prices.csv", kind: "csv" },
  faq: { title: "pricing-page-faq.md", kind: "md" },
  board: { title: "q3-board-update.md", kind: "md" },
  quotes: { title: "soc2-audit-quotes.csv", kind: "csv" },
};

const ROWS = [
  {
    title: "Help desk pricing against competitors",
    preview:
      "It's going well: the task is reading each pricing page and noting what every tier includes.",
    step: "Reading plans on zendesk.com",
    unread: true,
    working: true,
    time: "9:41 AM",
    holds: [{ site: "zendesk" }, { site: "intercom" }, { site: "freshdesk" }],
    project: "Pricing",
  },
  {
    title: "SOC 2 audit quotes from four firms",
    preview:
      "Three of the four replied. Ridgeline is the lowest, and the only one that includes a readiness review.",
    starred: true,
    time: "Yesterday",
    holds: [{ file: "quotes" }],
    project: "Security reviews",
  },
  {
    title: "Q3 board update in the Instrument folder",
    preview: "That was q3-board-update.md, in your Instrument folder.",
    time: "Mon",
    holds: [{ file: "board" }],
  },
  {
    title: "Renewal reminders for October accounts",
    preview:
      "The 14 drafts are ready in Gmail; nothing is sent until you say so.",
    time: "Sep 26",
    holds: [{ app: "gmail" }],
  },
  {
    title: "demo-page HTML file in the Instrument folder",
    preview:
      "From its name alone, this is an HTML file called demo-page sitting in your Instrument folder.",
    time: "Sep 24",
  },
];

const PRICING_TITLE = "Help desk pricing against competitors";

/** The pricing chat's transcript. `stage` 1: running; 2: pages opened; 3: finished with files. */
const pricing = (stage = 1) =>
  [
    turnMeta(),
    you("How does our pricing compare with Zendesk, Intercom and Freshdesk?"),
    agent(
      "I'll line up each one's list prices against our plans, per agent per month and billed annually, for a 10-agent team; say the word if you'd rather compare at a different size.",
    ),
    stage >= 2
      ? agent(
          "It's going well: the task is reading each pricing page and noting what every tier includes. I'll let you know when the comparison is ready.",
        )
      : "",
    stage >= 3
      ? agent(
          "The comparison is ready: at 10 agents our Team plan is 18% under Zendesk Suite Team and 8% under Freshdesk Pro. Intercom looks cheaper per seat, but its AI agent bills per resolution.",
        )
      : "",
    stage >= 3 ? fileRow("comparison") + fileRow("prices") : "",
  ]
    .filter(Boolean)
    .join("");

/** Plausible page bodies, drawn small so they survive any width. */
const PAGES = {
  zendesk: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center gap-2 bg-[#03363d] px-4 text-[13px] font-bold text-white">zendesk<span class="flex-1"></span><span class="font-normal">USD · Billed annually</span></div>
      <div class="p-4">
        <div class="text-[15px] font-semibold">Zendesk Suite</div>
        <div class="mt-1 text-[11px] text-muted-foreground">Per agent per month</div>
        ${[
          ["Suite Team", "Ticketing, messaging, help center", "$55"],
          ["Suite Growth", "Adds SLAs and multiple brands", "$89"],
          ["Suite Professional", "Adds skills routing and HIPAA", "$115"],
        ]
          .map(
            ([n, d, p], i) =>
              `<div class="mt-2.5 flex items-center gap-3 rounded-lg border ${i === 0 ? "border-[#03363d]" : "border-border"} p-2.5 text-[12px]"><div class="min-w-0 flex-1"><div class="font-medium">${n}</div><div class="mt-0.5 truncate text-[11px] text-muted-foreground">${d}</div></div><span class="font-semibold">${p}</span></div>`,
          )
          .join("")}
      </div>
    </div>`,
  intercom: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center border-b border-border px-4 text-[13px] font-bold">intercom</div>
      <div class="p-4">
        <div class="text-[15px] font-semibold">Plans for every team</div>
        <div class="mt-3 grid grid-cols-3 gap-2">
          ${[
            ["Essential", "$29"],
            ["Advanced", "$85"],
            ["Expert", "$132"],
          ]
            .map(
              ([n, p]) =>
                `<div class="rounded-lg border border-border p-2.5 text-[12px]"><div class="font-medium">${n}</div><div class="mt-1.5 text-[16px] font-semibold">${p}</div><div class="text-[10px] text-muted-foreground">per seat / mo</div></div>`,
            )
            .join("")}
        </div>
        <div class="mt-3 rounded-lg bg-[#f4f4f1] px-3 py-2 text-[11px]">Fin AI Agent: $0.99 per resolution, on every plan</div>
      </div>
    </div>`,
  freshdesk: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center bg-[#25c16f] px-4 text-[13px] font-bold text-white">freshdesk</div>
      <div class="p-4 text-[12px]"><div class="text-[14px] font-semibold">Support desk plans</div><div class="mt-3 space-y-2">${[
        ["Growth", "$15"],
        ["Pro", "$49"],
        ["Enterprise", "$79"],
      ]
        .map(
          ([n, p]) =>
            `<div class="flex justify-between border-b border-border pb-1.5"><span>${n}</span><span class="text-muted-foreground">agent / mo, billed annually</span><span class="font-semibold">${p}</span></div>`,
        )
        .join("")}</div></div>
    </div>`,
  g2: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Best Help Desk Software</div><div class="mt-1 border-b border-border pb-2 text-[10px] text-muted-foreground">Ranked by user reviews</div>${["Zendesk", "Freshdesk", "Intercom", "Help Scout"].map((n) => `<div class="mt-3 flex items-center gap-3"><div class="size-8 shrink-0 rounded bg-[#f3e8e6]"></div><div class="min-w-0 flex-1"><div class="text-[12px] font-medium">${n}</div><div class="mt-1.5 space-y-1.5">${bars2("80%")}</div></div></div>`).join("")}</div>`,
  wayback: () =>
    `<div class="h-full bg-white"><div class="flex h-9 items-center gap-2 border-b border-border bg-[#f4f4f4] px-4 text-[11px] text-muted-foreground"><span class="font-semibold text-foreground">INTERNET ARCHIVE</span>zendesk.com/pricing · captured 12 Oct 2025</div><div class="p-4"><div class="text-[14px] font-semibold">Zendesk Suite</div><div class="mt-3 space-y-2 text-[12px]">${[
      ["Suite Team", "$55"],
      ["Suite Growth", "$89"],
      ["Suite Professional", "$115"],
    ]
      .map(
        ([n, p]) =>
          `<div class="flex justify-between border-b border-border pb-1.5"><span>${n}</span><span>${p}</span></div>`,
      )
      .join("")}</div></div></div>`,
  notion: () =>
    `<div class="h-full bg-white p-6"><div class="text-[22px] font-bold">Pricing and packaging</div><div class="mt-4 space-y-2">${bars2("60%", "44%", "52%")}</div></div>`,
  comparison: () => `
    <div class="h-full bg-white p-5">
      <div class="text-[11px] font-medium tracking-wide text-[#e8793a] uppercase">Help desk pricing · Oct 2026</div>
      <div class="mt-1 text-[18px] font-semibold">Our plans against three competitors</div>
      <div class="mt-1 text-[11px] text-muted-foreground">10 agents, per agent per month, billed annually</div>
      ${[
        ["Zendesk Suite Team", "$55", 100],
        ["Freshdesk Pro", "$49", 89],
        ["Our Team plan", "$45", 82],
        ["Intercom Essential", "$29 + AI usage", 53],
      ]
        .map(
          ([n, p, w]) =>
            `<div class="mt-3 flex items-center justify-between text-[12px] font-medium"><span>${n}</span><span>${p}</span></div><div class="mt-1.5 h-[7px] rounded-full ${n.startsWith("Our") ? "bg-[#e8793a]" : "bg-gray-300"}" style="width:${w}%"></div>`,
        )
        .join("")}
      <div class="mt-5 text-[12px] font-medium">What each tier includes</div>
      <div class="mt-1.5 space-y-1.5">${bars2("92%", "64%", "78%")}</div>
    </div>`,
  prices: () => `
    <div class="h-full bg-white p-3 font-mono text-[11px]">
      ${[
        ["vendor", "plan", "agent/mo", "10 agents/yr"],
        ["Zendesk", "Suite Team", "$55", "$6,600"],
        ["Freshdesk", "Pro", "$49", "$5,880"],
        ["Intercom", "Essential", "$29", "$3,480+"],
        ["Ours", "Team", "$45", "$5,400"],
      ]
        .map(
          (r, i) =>
            `<div class="grid grid-cols-[1fr_1fr_60px_84px] border-b border-border py-1.5 ${i ? "" : "font-semibold"}">${r.map((c) => `<span>${c}</span>`).join("")}</div>`,
        )
        .join("")}
    </div>`,
  faq: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Pricing page FAQ</div><div class="mt-3 space-y-2">${bars2("40%", "52%", "36%", "48%")}</div></div>`,
  board: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Q3 board update</div><div class="mt-3 space-y-2">${bars2("50%", "62%", "44%")}</div></div>`,
  newtab: () => `
    <div class="h-full bg-card p-6">
      <div class="text-[13px] font-medium text-muted-foreground">This Mac</div>
      <div class="mt-3 grid grid-cols-2 gap-2">${["Instrument", "Desktop", "Documents", "Downloads"].map((n) => `<div class="flex items-center gap-2 rounded-lg border border-border p-2.5 text-[12px]">${fileMark("folder", "text-[18px]")}${n}</div>`).join("")}</div>
      <div class="mt-5 text-[13px] font-medium text-muted-foreground">Recent files</div>
      <div class="mt-2 space-y-2">${bars2("55%", "40%")}</div>
    </div>`,
};

const page = (t) =>
  t.site ? PAGES[t.site]() : t.file ? PAGES[t.file]() : PAGES.newtab();


// The Apps directory's first rows, as the API seeds it. [mark, name, line]; a mark is a brands.js key or a letter mark.
const APP_ROWS = [
  [
    letterMark("D", "bg-[#1fa463]", "size-9 text-[15px]"),
    "Google Drive",
    "Files, Docs, Sheets, and Slides.",
  ],
  [
    letterMark("S", "bg-[#23a566]", "size-9 text-[15px]"),
    "Google Sheets",
    "Spreadsheets, tabs, and cells.",
  ],
  [brand("gmail", "size-9"), "Gmail", "Mail, threads, labels, and drafts."],
  [
    letterMark("31", "bg-[#4285f4]", "size-9 text-[13px]"),
    "Google Calendar",
    "Events, invites, and availability.",
  ],
  [
    letterMark("#", "bg-[#4a154b]", "size-9 text-[15px]"),
    "Slack",
    "Read, search, and send messages where your team talks.",
  ],
  [
    letterMark("C", "bg-[#7d2ae8]", "size-9 text-[15px]"),
    "Canva",
    "Designs, brand kits, and exports.",
  ],
  [
    letterMark("H", "bg-[#ff7a59]", "size-9 text-[15px]"),
    "HubSpot",
    "Contacts, companies, deals, and tickets.",
  ],
  [brand("notion", "size-9"), "Notion", "Pages, databases, and comments."],
  [
    brand("figma", "size-9"),
    "Figma",
    "Design files, components, and variables.",
  ],
  [
    letterMark("A", "bg-[#f06a6a]", "size-9 text-[15px]"),
    "Asana",
    "Tasks, projects, and goals across the work.",
  ],
];

/** The projects the scenario files chats under, as the picker lists them (projects.list). */
const PROJECTS = [
  { emoji: "💼", name: "Pricing", color: "#ebaf86", count: 3, instructions: "Compare list prices per agent per month, billed annually, for a 10-agent team. Name the plan and the tier, and link the page each price came from." },
  { emoji: "🛡️", name: "Security reviews", color: "#82c7f0", count: 1, instructions: "" },
];

/** The Instrument folder's files with what Files says about each: [kind, name, modified, size, title]. `title` is what List shows over the name (a page's title, a note's heading). */
const FOLDER_ROWS = [
  ["folder", "ai-spend", "Oct 8, 2026 at 9:10 AM", "--", ""],
  ["folder", "cat-word-doc", "Oct 5, 2026 at 12:25 PM", "--", ""],
  ["md", "claude-usage-report.md", "Oct 6, 2026 at 11:20 AM", "26 KB", "Claude usage report"],
  ["html", "comparison-index.html", "Oct 7, 2026 at 10:15 AM", "19 KB", "Comparison index"],
  ["csv", "competitor-prices.csv", "Today at 9:52 AM", "4 KB", ""],
  ["html", "demo-page.html", "Oct 5, 2026 at 9:50 AM", "68 KB", "Demo"],
  ["html", "pricing-comparison.html", "Today at 9:58 AM", "40 KB", "Our plans against three competitors"],
  ["md", "pricing-page-faq.md", "Today at 10:06 AM", "54 KB", "Pricing page FAQ"],
  ["md", "q3-board-update.md", "Oct 6, 2026 at 12:45 PM", "61 KB", "Q3 board update"],
];

/** The release notes the kit's What's new shows, newest first: { version, date, summary, points, folded }. */
const RELEASES = [
  { version: "2.0 beta 119", date: "Oct 31", summary: "Files can show a folder as a list of titles, and search can narrow it to one kind of file.", points: ["Pick List in Files to see each page's title over its file name.", "Search a folder and choose Show only to see just its spreadsheets, notes or pages."] },
  { version: "2.0 beta 118", date: "Oct 29", summary: "Send feedback from the rail, and read everything that goes with it before you send.", points: ["Feedback sits in the rail, above Settings.", "Pick anything in the list to read it first, and uncheck what you'd rather keep to yourself."] },
  { version: "2.0 beta 117", date: "Oct 28", summary: "Release notes open on what changed since your last version.", folded: true },
  { version: "2.0 beta 116", date: "Oct 27", summary: "A chat's tasks show where its work stands, under its title.", folded: true },
];
