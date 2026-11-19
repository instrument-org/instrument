import { type WindowTab } from "@/client/atoms/window";
import { chatListOptions } from "@/client/components/window/chat-list-query";
import { dragPoint } from "@/client/components/window/drag/session";
import { PageFavicon } from "@/client/components/favicon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { ScreenMark } from "@/client/components/window/pane-tabs";
import { useShell } from "@/client/components/window/shell-context";
import { chatHref } from "@/client/components/window/window-href";
import { TabStrip } from "@/client/components/window/tab-strip";
import { type WindowTabs } from "@/client/components/window/tab-model";
import { fileHref, folderHref } from "@/shared/computer-href";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";
import { type ReactNode, useLayoutEffect } from "react";

import { getDebugPage } from "../-debug-routes";
import {
  Freeze,
  HELD_FILES,
  bookmarkAlong,
  heldTab,
  inStrip,
  nowhere,
  onBar,
  overNewTab,
  overRow,
  overSide,
  rowHeld,
  type Scene,
} from "../-two-sides/drags";
import {
  CAST,
  chat,
  group,
  newChat,
  type RowSpec,
  screen,
  site,
  SITES,
  sitesAsTabs,
  windowOf,
} from "../-two-sides/fixtures";
import {
  CastProvider,
  Frame,
  Picture,
  SidebarPicture,
  useRows,
  WindowPicture,
} from "../-two-sides/picture";
import { RowFrames } from "../-two-sides/rows";

export const Route = createFileRoute("/debug/components/two-sides")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugPage("two-sides").label }],
  }),
});

/** A window this wide shows its group at a side's full width with the sidebar beside it; the frames leave the sidebar out. */
const GROUP_FRAME = { height: 620, width: 976 };
const WINDOW_FRAME = { height: 720, width: 1296 };
const DRAG_FRAME = { height: 600, width: 1296 };

const TEXT_FILE =
  /\.(?:txt|py|ts|tsx|js|json|csv|log|sh|toml|ya?ml|html|css)$/i;
const MARKDOWN_FILE = /\.md$/i;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|heic)$/i;

/**
 * The files the file frames show: ones the workspace's chats made, where
 * they made one of that kind, else a stand-in under a made-up path.
 */
function useFiles() {
  const { data: chats = [] } = useQuery(chatListOptions());
  const made = [...new Set(chats.flatMap((each) => each.holds.files))];
  const pick = (kind: RegExp, standIn: string) =>
    made.find((path) => kind.test(path)) ?? standIn;
  const text = pick(TEXT_FILE, "/Users/mac-user/Documents/cheapest.py");
  const markdown = pick(MARKDOWN_FILE, "/Users/mac-user/Documents/Lisbon.md");
  const image = pick(IMAGE_FILE, "/Users/mac-user/Pictures/Roof.png");
  const real = [image, text, markdown].find((path) => made.includes(path));
  return {
    folder: real?.slice(0, real.lastIndexOf("/")),
    image,
    markdown,
    standIns: new Set(
      [text, markdown, image].filter((path) => !made.includes(path)),
    ),
    text,
  };
}

function RouteComponent() {
  const files = useFiles();
  // A tab standing in a frame's strip stands at a point on screen, measured
  // from the pointer, which a still drag leaves at the window's corner.
  useLayoutEffect(() => {
    dragPoint.x = 0;
    dragPoint.y = 0;
  }, []);
  return (
    <div className="size-full overflow-y-auto">
      <div className="flex w-full flex-col gap-12 p-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Two sides</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Tab groups of one side or two, drawn at their real size with the
            app's own strip, toolbar, bookmarks bar, sidebar rows and drag
            layer. A page that needs a live page or a chat this workspace does
            not have shows a stand-in, marked in its corner. Nothing here takes
            a click. The frames follow the app's theme, which the developer
            strip switches.
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SECTIONS.map((section) => (
              <button
                className="text-muted-foreground hover:text-foreground"
                key={section.id}
                onClick={() => {
                  document.getElementById(section.id)?.scrollIntoView();
                }}
                type="button"
              >
                {section.title}
              </button>
            ))}
          </nav>
        </header>
        <CastProvider standInFiles={files.standIns}>
          <PageTypes files={files} />
          <Layouts />
          <Amounts />
          <Sidebars />
          <Rows />
          <DragStates />
        </CastProvider>
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: "page-types", title: "Page types" },
  { id: "layouts", title: "Layouts" },
  { id: "amounts", title: "Amounts of content" },
  { id: "sidebar", title: "Sidebar" },
  { id: "rows", title: "Sidebar rows" },
  { id: "drags", title: "Drags" },
] as const;

function Section({
  children,
  description,
  id,
}: {
  children: ReactNode;
  description: string;
  id: (typeof SECTIONS)[number]["id"];
}) {
  const title = SECTIONS.find((section) => section.id === id)?.title ?? id;
  return (
    <section className="flex flex-col gap-6" id={id}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** A frame of one group, the sidebar left out. */
function GroupShot({
  caption,
  height = GROUP_FRAME.height,
  note,
  share,
  tabs,
  width = GROUP_FRAME.width,
}: {
  caption: string;
  height?: number;
  note?: ReactNode;
  share?: number;
  tabs: WindowTabs;
  width?: number;
}) {
  const key = tabs.tabs[0]?.group ?? "";
  return (
    <Frame caption={caption} height={height} note={note} width={width}>
      <Picture tabs={tabs}>
        <WindowPicture
          group={key}
          sidebar="left out"
          {...(share === undefined ? {} : { share })}
        />
      </Picture>
    </Frame>
  );
}

// Page types ----------------------------------------------------------------

function PageTypes({ files }: { files: ReturnType<typeof useFiles> }) {
  const types: {
    name: string;
    note?: string;
    tab: (id: string) => WindowTab;
  }[] = [
    {
      name: "A chat",
      note: "The workspace's latest chat, where it has one.",
      tab: (id) => chat(id, "roof"),
    },
    { name: "A new chat", tab: (id) => newChat(id) },
    { name: "A web page", tab: (id) => site(id, "wiki") },
    {
      name: "A text file",
      note: files.text,
      tab: (id) => screen(id, fileHref(files.text)),
    },
    {
      name: "A Markdown file",
      note: files.markdown,
      tab: (id) => screen(id, fileHref(files.markdown)),
    },
    {
      name: "An image",
      note: files.image,
      tab: (id) => screen(id, fileHref(files.image)),
    },
    {
      name: "Files, at a folder",
      note: files.folder ?? "The home folder",
      tab: (id) =>
        screen(id, files.folder ? folderHref(files.folder) : "/files"),
    },
    { name: "Settings", tab: (id) => screen(id, "/settings/general") },
    { name: "Memory", tab: (id) => screen(id, "/memory") },
    { name: "Skills", tab: (id) => screen(id, "/skills") },
    { name: "Chats", tab: (id) => screen(id, "/chat-list") },
    { name: "Activity", tab: (id) => screen(id, "/activity") },
    { name: "Apps", tab: (id) => screen(id, "/apps") },
  ];
  return (
    <Section
      description="Each kind of page up in a side: alone in its group at a side's full width, and at half width beside a chat (beside a page, for the chat), where a built-in page narrower than 640px folds what it keeps beside its content."
      id="page-types"
    >
      {types.map((type, index) => {
        const key = `type-${String(index)}`;
        const isChat = index === 0;
        return (
          <div className="flex flex-col gap-4" key={key}>
            <GroupShot
              caption={`${type.name}, full width`}
              {...(type.note ? { note: type.note } : {})}
              tabs={group(`${key}-full`, [
                [
                  type.tab(`${key}-up`),
                  site(`${key}-a`, "airbnb"),
                  chat(`${key}-b`, "lisbon"),
                ],
              ])}
            />
            <GroupShot
              caption={`${type.name}, half width`}
              tabs={group(`${key}-half`, [
                [type.tab(`${key}-up`)],
                [
                  isChat
                    ? site(`${key}-c`, "coastline")
                    : chat(`${key}-c`, "roof"),
                ],
              ])}
            />
          </div>
        );
      })}
    </Section>
  );
}

// Layouts -------------------------------------------------------------------

const MAIN = "main";

/** Groups beside the main one, for the sidebar's rows and their marks. */
const OTHERS = windowOf(
  group("g-lisbon", [
    [
      chat("gl-chat", "lisbon"),
      site("gl-airbnb", "airbnb"),
      site("gl-maps", "maps"),
      site("gl-wiki", "wiki"),
    ],
  ]),
  group("g-numbers", [[chat("gn-chat", "numbers"), site("gn-docs", "docs")]]),
  group("g-reading", [
    [site("gr-hn", "hn"), site("gr-nyt", "nyt"), site("gr-gh", "github")],
  ]),
  group("g-garden", [[chat("gg-chat", "garden")]]),
  group("g-hiring", [[chat("gh-chat", "hiring")], [site("gh-gh", "github")]]),
);

const ROWS: readonly RowSpec[] = [
  { chat: "roof", group: MAIN },
  { chat: "lisbon", group: "g-lisbon" },
  { chat: "numbers", group: "g-numbers" },
  { group: "g-reading", title: "Reading" },
  { chat: "garden", group: "g-garden" },
  { chat: "hiring", group: "g-hiring" },
];

/** A frame of a whole window: the sidebar's rows, and the main group. */
function WindowShot({
  caption,
  height = WINDOW_FRAME.height,
  main,
  note,
  rows = ROWS,
  scene,
  share,
  sidebar = "shown",
  width = WINDOW_FRAME.width,
}: {
  caption: string;
  height?: number;
  main: WindowTabs;
  note?: ReactNode;
  rows?: readonly RowSpec[];
  scene?: Scene;
  share?: number;
  sidebar?: "closed" | "shown";
  width?: number;
}) {
  const listed = useRows(rows);
  return (
    <Frame caption={caption} height={height} note={note} width={width}>
      <Picture tabs={windowOf(main, OTHERS)}>
        <WindowPicture
          group={MAIN}
          sidebar={sidebar === "shown" ? { rows: listed } : "closed"}
          {...(share === undefined ? {} : { share })}
        />
        {scene && <Freeze scene={scene} />}
      </Picture>
    </Frame>
  );
}

const roofPages = (prefix: string) => [
  site(`${prefix}coast`, "coastline"),
  site(`${prefix}reviews`, "reviews"),
  site(`${prefix}yt`, "youtube"),
];

function Layouts() {
  return (
    <Section
      description="One group in a window with the sidebar beside it. Two sides share the row, neither narrower than 440px; a window too narrow for both scrolls sideways, showing the side with the keyboard."
      id="layouts"
    >
      <WindowShot
        caption="One side"
        main={group(MAIN, [[chat("m-chat", "roof"), ...roofPages("m-")]])}
      />
      <WindowShot
        caption="Two sides, an even split"
        main={group(MAIN, [[chat("m-chat", "roof")], roofPages("m-")])}
      />
      <WindowShot
        caption="Two chats side by side"
        main={group(MAIN, [
          [chat("m-chat", "roof"), site("m-coast", "coastline")],
          [chat("m-chat2", "lisbon"), site("m-airbnb", "airbnb")],
        ])}
      />
      <WindowShot
        caption="One side at its 440px floor"
        main={group(MAIN, [[chat("m-chat", "roof")], roofPages("m-")])}
        note="The left side's share is three quarters; the right side stops at its narrowest."
        share={0.8}
      />
      <WindowShot
        caption="A narrow window, scrolled to the side with the keyboard"
        main={group(MAIN, [[chat("m-chat", "roof")], roofPages("m-")], {
          focused: 1,
        })}
        note="Too narrow for two sides of 440px beside the sidebar, so the group scrolls sideways."
        width={1060}
      />
      <WindowShot
        caption="A narrow window with the sidebar closed"
        main={group(MAIN, [[chat("m-chat", "roof")], roofPages("m-")])}
        sidebar="closed"
        width={820}
      />
    </Section>
  );
}

// Amounts of content --------------------------------------------------------

/** A side's tabs of a given count: a chat first, then sites. */
const tabsOf = (prefix: string, count: number) => [
  chat(`${prefix}chat`, "roof"),
  ...sitesAsTabs(prefix, Math.max(count - 1, 0)),
];

const STRIP_HEIGHT = 200;

function Amounts() {
  const counts = [1, 3, 8, 15];
  return (
    <Section
      description="Strips with few tabs and many, long titles, and tabs an agent is working in. A strip squeezes its tabs toward icons, and past that scrolls them with the tab up still named."
      id="amounts"
    >
      {counts.map((count) => (
        <div className="flex flex-col gap-4" key={count}>
          <GroupShot
            caption={`${String(count)} ${count === 1 ? "tab" : "tabs"}, full width`}
            height={STRIP_HEIGHT}
            tabs={group(`count-${String(count)}`, [
              tabsOf(`c${String(count)}-`, count),
            ])}
          />
          <GroupShot
            caption={`${String(count)} ${count === 1 ? "tab" : "tabs"} on the left, half width`}
            height={STRIP_HEIGHT}
            tabs={group(`count-half-${String(count)}`, [
              tabsOf(`h${String(count)}-`, count),
              [site(`h${String(count)}-right`, "coastline")],
            ])}
          />
        </div>
      ))}
      <GroupShot
        caption="Long titles, full width"
        height={STRIP_HEIGHT}
        tabs={group("long", [
          [
            site("l-long", "long"),
            site("l-nyt", "nyt"),
            site("l-coast", "coastline"),
            chat("l-chat", "wedding"),
          ],
        ])}
      />
      <GroupShot
        caption="Long titles, half width"
        height={STRIP_HEIGHT}
        tabs={group("long-half", [
          [site("lh-long", "long"), chat("lh-chat", "wedding")],
          [site("lh-nyt", "nyt"), site("lh-coast", "coastline")],
        ])}
      />
      <GroupShot
        caption="Many tabs on both sides"
        height={STRIP_HEIGHT}
        tabs={group("both", [tabsOf("bl-", 12), sitesAsTabs("br-", 10)])}
      />
      <WorkingStrips />
      <WindowShot
        caption="A chat beside the pages it opened"
        main={group(MAIN, [
          [chat("m-chat", "roof")],
          [...roofPages("m-"), site("m-long", "long")],
        ])}
      />
      <WindowShot
        caption="A chat followed by the pages it opened, on one side"
        main={group(MAIN, [
          [chat("m-chat", "roof"), ...roofPages("m-"), site("m-long", "long")],
        ])}
        note="Pages a chat's agent opens go right after the chat's tab, behind it."
      />
    </Section>
  );
}

/**
 * Tabs an agent is working in, on the strip itself (`TabStrip`): which
 * ones are is the agent's live activity, so here it is set by hand.
 */
function WorkingStrips() {
  const appsBySlug = useAppsBySlug();
  const { chatTitles } = useShell();
  const tabs = [
    { key: "w-chat", title: "Quarterly numbers", url: "" },
    { key: "w-docs", ...SITES.docs, isWorking: true },
    { key: "w-gh", ...SITES.github, isWorking: true },
    { key: "w-hn", ...SITES.hn },
  ].map((tab) => ({
    icon: tab.url ? (
      <PageFavicon className="size-3.5" hasTooltip={false} url={tab.url} />
    ) : (
      <ScreenMark
        appsBySlug={appsBySlug}
        chatId={undefined}
        chatTitles={chatTitles}
        href={chatHref(CAST.numbers.id)}
      />
    ),
    isWorking: "isWorking" in tab,
    key: tab.key,
    title: tab.title,
  }));
  return (
    <div className="flex flex-col gap-4">
      {[GROUP_FRAME.width - 16, 460].map((width) => (
        <Frame
          caption={`Pages an agent is working in, ${width > 600 ? "full" : "half"} width`}
          height={56}
          key={width}
          note="The strip alone. Which tabs an agent works in comes from its live activity, so these are set by hand."
          width={width}
        >
          <div className="flex size-full items-center bg-ground p-2 [--background:var(--pane)]">
            <div className="flex h-10 w-full items-center rounded-[18px] bg-background pr-1.5 [--tab-selected:var(--card)]">
              <TabStrip
                className="min-w-0 flex-1 pr-0 pl-1.5"
                onClose={noop}
                onSelect={noop}
                overflow="squeeze"
                selectedKey="w-chat"
                tabs={tabs}
              />
            </div>
          </div>
        </Frame>
      ))}
    </div>
  );
}

// Sidebar -------------------------------------------------------------------

function Rows() {
  return (
    <Section
      description="Each row draws the tabs that are up: one side across the row, two in equal halves with a hairline between. A tab's mark leads its title, and its second line says where it is, or for a chat, what it's doing."
      id="rows"
    >
      <RowFrames />
    </Section>
  );
}

/** Groups with more and more tabs, for how many marks a row shows. */
const MARKS = windowOf(
  group("k-1", [[chat("k1-chat", "garden")]]),
  group("k-3", [
    [chat("k3-chat", "lisbon"), site("k3-a", "airbnb"), site("k3-m", "maps")],
  ]),
  group("k-8", [tabsOf("k8-", 8)]),
  group("k-15", [[chat("k15-chat", "numbers"), ...sitesAsTabs("k15-", 14)]]),
  group("k-two", [
    [chat("k2-chat", "hiring"), site("k2-gh", "github")],
    [site("k2-docs", "docs"), site("k2-hn", "hn"), site("k2-nyt", "nyt")],
  ]),
  group("k-sites", [sitesAsTabs("ks-", 6)]),
);

const MARK_ROWS: readonly RowSpec[] = [
  { chat: "garden", group: "k-1" },
  { chat: "lisbon", group: "k-3" },
  { chat: "roof", group: "k-8" },
  { chat: "numbers", group: "k-15" },
  { chat: "hiring", group: "k-two" },
  { group: "k-sites", title: "Reading" },
  { group: "k-none", title: "Nothing yet" },
];

const CAST_ORDER = [
  "roof",
  "lisbon",
  "numbers",
  "hiring",
  "garden",
  "taxes",
  "wedding",
  "bike",
  "recipes",
  "newsletter",
  "move",
  "podcast",
] as const;

/** Two dozen groups, a few pinned and one named. */
const MANY_ROWS: readonly RowSpec[] = Array.from({ length: 24 }, (_, index) => {
  const key = `n-${String(index)}`;
  const castChat = CAST_ORDER[index % CAST_ORDER.length] ?? "roof";
  const pinned = index < 3;
  if (index % 5 === 4) {
    return { group: key, pinned, title: "Reading" };
  }
  return {
    chat: castChat,
    group: key,
    pinned,
    ...(index === 6 ? { name: "Our wedding" } : {}),
  };
});

const MANY = windowOf(
  ...MANY_ROWS.map((row, index) =>
    group(row.group, [
      "chat" in row
        ? [
            chat(`${row.group}-c`, row.chat),
            ...sitesAsTabs(`${row.group}-`, index % 4),
          ]
        : sitesAsTabs(`${row.group}-`, 3),
    ]),
  ),
);

function SidebarShot({
  caption,
  note,
  rows,
  tabs,
}: {
  caption: string;
  note?: string;
  rows: readonly RowSpec[];
  tabs: WindowTabs;
}) {
  const listed = useRows(rows);
  return (
    <Frame caption={caption} height={720} note={note} width={320}>
      <Picture tabs={tabs}>
        <div className="size-full bg-ground">
          <SidebarPicture groupUp={rows[0]?.group} rows={listed} />
        </div>
      </Picture>
    </Frame>
  );
}

function Sidebars() {
  return (
    <Section
      description="The sidebar with the cast's groups. Pinned groups stand above the line."
      id="sidebar"
    >
      <div className="flex flex-wrap gap-6">
        <SidebarShot
          caption="A few groups, one pinned"
          rows={[{ chat: "roof", group: MAIN, pinned: true }, ...ROWS.slice(1)]}
          tabs={windowOf(
            group(MAIN, [[chat("s-chat", "roof"), ...roofPages("s-")]]),
            OTHERS,
          )}
        />
        <SidebarShot
          caption="Rows with few marks and many"
          note="1, 3, 8 and 15 tabs, two sides, sites only, and none."
          rows={MARK_ROWS}
          tabs={MARKS}
        />
        <SidebarShot
          caption="Two dozen groups, three pinned"
          rows={MANY_ROWS}
          tabs={MANY}
        />
      </div>
    </Section>
  );
}

// Drags ---------------------------------------------------------------------

const ONE_SIDE = group(
  MAIN,
  [[chat("d-chat", "roof"), ...roofPages("d-"), site("d-long", "long")]],
  { up: ["d-coast"] },
);
const ONE_SIDE_AT_CHAT = group(
  MAIN,
  [[chat("d-chat", "roof"), ...roofPages("d-"), site("d-long", "long")]],
  { up: ["d-chat"] },
);
const TWO_SIDES = group(
  MAIN,
  [
    [chat("d-chat", "roof"), site("d-reviews", "reviews")],
    [chat("d-lisbon", "lisbon"), site("d-coast", "coastline")],
  ],
  { up: ["d-reviews", "d-lisbon"] },
);
const NEW_TAB = group(
  MAIN,
  [[site("d-coast", "coastline"), newChat("d-new")]],
  { up: ["d-new"] },
);

const HELD = heldTab(MAIN, "d-reviews");

const DRAGS: {
  caption: string;
  main: WindowTabs;
  note?: string;
  scene: Scene;
}[] = [
  {
    caption: "A tab moved along its strip",
    main: ONE_SIDE,
    scene: inStrip({ group: MAIN, held: HELD, index: 3, side: 0 }),
  },
  {
    caption: "A tab from the other side standing in the strip",
    main: TWO_SIDES,
    scene: inStrip({
      group: MAIN,
      held: heldTab(MAIN, "d-coast", 1),
      index: 1,
      side: 0,
    }),
  },
  {
    caption: "Files dragged in from outside, standing in a strip",
    main: ONE_SIDE,
    scene: inStrip({
      group: MAIN,
      held: HELD_FILES,
      index: 2,
      input: "native",
      side: 0,
    }),
  },
  {
    caption: "A tab held over its own lone side's middle",
    main: ONE_SIDE,
    note: "Nothing shows: a page takes no tab, and only its outer edge splits.",
    scene: overSide({
      across: 0.5,
      group: MAIN,
      held: HELD,
      heldIn: { isAlone: false, side: 0 },
      side: 0,
    }),
  },
  {
    caption: "A lone side's right half lit for a split",
    main: ONE_SIDE,
    note: "Once the pointer is at the page's outer edge, with a line down it.",
    scene: overSide({
      across: 0.995,
      group: MAIN,
      held: HELD,
      heldIn: { isAlone: false, side: 0 },
      side: 0,
    }),
  },
  {
    caption: "A lone chat's right half lit for a split",
    main: ONE_SIDE_AT_CHAT,
    scene: overSide({
      across: 0.995,
      group: MAIN,
      held: HELD,
      heldIn: { isAlone: false, side: 0 },
      side: 0,
    }),
  },
  {
    caption: "A lone side's left half lit for a split",
    main: ONE_SIDE,
    scene: overSide({
      across: 0.005,
      group: MAIN,
      held: HELD,
      heldIn: { isAlone: false, side: 0 },
      side: 0,
    }),
  },
  {
    caption: "Files from another app over a lone side's middle",
    main: ONE_SIDE,
    note: "They open in a new tab of the side.",
    scene: overSide({
      across: 0.5,
      group: MAIN,
      held: HELD_FILES,
      input: "native",
      side: 0,
    }),
  },
  {
    caption: "The other side's chat lit to take a tab at its edge",
    main: TWO_SIDES,
    scene: overSide({
      across: 0.995,
      group: MAIN,
      held: HELD,
      heldIn: { isAlone: false, side: 0 },
      side: 1,
    }),
  },
  {
    caption: "Files over a lone chat's edge",
    main: ONE_SIDE_AT_CHAT,
    scene: overSide({
      across: 0.995,
      group: MAIN,
      held: HELD_FILES,
      input: "native",
      side: 0,
    }),
  },
  {
    caption: "Files over a new chat, which turns into them",
    main: NEW_TAB,
    scene: overNewTab({ group: MAIN, tab: "d-new" }),
  },
  {
    caption: "A sidebar row ringed to take a tab",
    main: ONE_SIDE,
    scene: overRow({ held: HELD, how: "into", row: "g-reading" }),
  },
  {
    caption: "The line between rows where a tab becomes a group",
    main: ONE_SIDE,
    scene: overRow({ held: HELD, how: "between", row: "g-garden" }),
  },
  {
    caption: "A whole group carried down the list",
    main: ONE_SIDE,
    note: "The row held over the list stands where the window's own sidebar's list is, which matches this frame's while that sidebar is open at its narrowest.",
    scene: rowHeld({ group: "g-lisbon", over: "g-hiring" }),
  },
  {
    caption: "A tab kept on the bookmarks bar",
    main: ONE_SIDE,
    note: "Every bar of the group shows it, as the window's do.",
    scene: onBar({ held: HELD, index: 1 }),
  },
  {
    caption: "A bookmark moved along the bar",
    main: ONE_SIDE,
    note: "The workspace's first bookmark on the bar, or a made-up one where it keeps none.",
    scene: bookmarkAlong(2),
  },
  {
    caption: "A bookmark held off the bar, which letting go removes",
    main: ONE_SIDE,
    scene: nowhere({ at: { x: 0.62, y: 0.6 }, held: "bar bookmark" }),
  },
  {
    caption: "A tab held where nothing takes it",
    main: ONE_SIDE,
    note: "Over the sidebar's foot: the strip closes up behind it.",
    scene: nowhere({ at: { x: 0.1, y: 0.95 }, held: HELD }),
  },
  {
    caption: "A tab carried off the window",
    main: ONE_SIDE,
    note: "Main draws the window's picture at the pointer; nothing is drawn here but the strip closed up.",
    scene: nowhere({ at: { x: 0.5, y: 0.5 }, held: HELD, isOff: true }),
  },
];

function DragStates() {
  return (
    <Section
      description="Drags held still: what each place that takes a drop shows as something held is over it, in the lit places' one tone, and a lone side's ends shown faintly from a drag's start."
      id="drags"
    >
      {DRAGS.map((drag) => (
        <WindowShot
          caption={drag.caption}
          height={DRAG_FRAME.height}
          key={drag.caption}
          main={drag.main}
          {...(drag.note ? { note: drag.note } : {})}
          scene={drag.scene}
          width={DRAG_FRAME.width}
        />
      ))}
    </Section>
  );
}
