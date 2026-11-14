import { NEW_TAB_HREF } from "@/client/atoms/window";
import { GroupRow } from "@/client/components/window/group-sidebar";
import { type PageLoad } from "@/client/components/window/row-lines";
import { type TabGroup } from "@/client/components/window/tab-groups";
import {
  chatOfTab,
  type WindowTabs,
} from "@/client/components/window/tab-model";
import { newChatHref } from "@/client/components/window/window-href";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type Draft } from "@/shared/drafts";
import { noop } from "radashi";
import { Fragment, type ReactNode } from "react";

import {
  CAST,
  chat,
  group,
  PRICING_CHATS,
  pricingSite,
  type RowSpec,
  screen,
  windowOf,
} from "./fixtures";
import {
  CastSources,
  Frame,
  Picture,
  SidebarPicture,
  useRows,
} from "./picture";

/**
 * The sidebar's rows as the rows wireframe draws them, from its pricing
 * week: every kind of tab alone and as half of a split at 320 and 200,
 * closing half a split, and the sidebar with its Active list.
 */

type Loose = ReturnType<typeof screen>;

const HOME = "/Users/mac-user/Documents";
const DRAFT: Draft = {
  createdAt: 0,
  id: "two-sides-draft",
  updatedAt: 0,
  words: "Line up Intercom's seat prices against ours",
};
const DRAFTS = [DRAFT];

/** One kind of tab: its label, what its line says, and the tab, by an id prefix. */
interface Kind {
  label: string;
  note: string;
  tab: (id: string) => Loose;
  /** How its page's load stands, for a page. */
  load?: PageLoad;
}

const KINDS_CHATS: (Kind | "rule")[] = [
  {
    label: "A chat",
    note: "its title, then its latest line",
    tab: (id) => chat(id, "pricing"),
  },
  {
    label: "A chat at work",
    note: "what it's doing now, in green",
    tab: (id) => chat(id, "research"),
  },
  {
    label: "A chat asking you",
    note: "its title in bold, then its question",
    tab: (id) => chat(id, "renewals"),
  },
  {
    label: "A reply you haven't read",
    note: "its title in bold, then the reply",
    tab: (id) => chat(id, "soc"),
  },
  {
    label: "A chat that stopped",
    note: "what went wrong, in red",
    tab: (id) => chat(id, "faq"),
  },
  "rule",
  {
    label: "A web page",
    note: "the page's title, then its site",
    tab: (id) => pricingSite(id, "zendesk"),
  },
  {
    label: "A web page loading",
    note: "its favicon stays; the line says it's loading",
    load: "loading",
    tab: (id) => pricingSite(id, "freshdesk"),
  },
  {
    label: "A web page that failed",
    note: "what went wrong, in red",
    load: "failed",
    tab: (id) => pricingSite(id, "intercom"),
  },
];

const KINDS_PLACES: (Kind | "rule")[] = [
  {
    label: "A file",
    note: "its name, then its folder",
    tab: (id) => screen(id, fileHref(`${HOME}/Board/q3-board-update.md`)),
  },
  {
    label: "A folder",
    note: "its name, then where it is",
    tab: (id) => screen(id, folderHref(`${HOME}/Pricing`)),
  },
  "rule",
  {
    label: "Settings",
    note: "the part that's open",
    tab: (id) => screen(id, "/settings/permissions"),
  },
  {
    label: "Memory",
    note: "where the page starts",
    tab: (id) => screen(id, "/memory"),
  },
  {
    label: "Skills",
    note: "where the page starts",
    tab: (id) => screen(id, "/skills"),
  },
  {
    label: "History",
    note: "where the page starts",
    tab: (id) => screen(id, "/history"),
  },
  {
    label: "Activity",
    note: "the kind of row it shows",
    tab: (id) => screen(id, "/activity?show=chats"),
  },
  { label: "Apps", note: "your apps", tab: (id) => screen(id, "/apps") },
  {
    label: "An app's page",
    note: "the app's icon and name, then its site",
    tab: (id) => screen(id, "/apps/hubspot"),
  },
  "rule",
  {
    label: "New Tab",
    note: "nothing open yet",
    tab: (id) => screen(id, NEW_TAB_HREF),
  },
  {
    label: "New Tab with words typed",
    note: "what you've typed so far",
    tab: (id) => screen(id, newChatHref(DRAFT.id)),
  },
];

/** A row's entry: how a row draws is read off the window's tabs, so the entry only names the group. */
function entryOf(key: string): TabGroup {
  return { group: key, kind: "tabs", pinned: false, title: "Tab group" };
}

/** A tab's quiet partner in a split: Zendesk's plans beside a chat, the pricing chat beside the rest. */
function partnerOf(kind: Kind, id: string): Loose {
  const tab = kind.tab("x");
  return chatOfTab(tab) === undefined
    ? chat(id, "pricing")
    : pricingSite(id, "zendesk");
}

const SHEET_WIDTHS = [320, 320, 200, 200] as const;
const LABEL_WIDTH = 220;

/** Each kind alone and as a split's left half, a group for each, at both widths. */
function sheetOf(kinds: readonly (Kind | "rule")[], prefix: string) {
  const groups: WindowTabs[] = [];
  const loads = new Map<string, PageLoad>();
  const lines = kinds.map((kind, index) => {
    if (kind === "rule") {
      return "rule" as const;
    }
    const keys = SHEET_WIDTHS.map(
      (_, column) => `${prefix}${String(index)}-${String(column)}`,
    );
    for (const [column, key] of keys.entries()) {
      const own = kind.tab(`${key}-t`);
      if (kind.load) {
        loads.set(own.id, kind.load);
      }
      groups.push(
        group(
          key,
          column % 2 === 0 ? [[own]] : [[own], [partnerOf(kind, `${key}-p`)]],
        ),
      );
    }
    return { keys, kind };
  });
  return { lines, loads, tabs: windowOf(...groups) };
}

const CHAT_SHEET = sheetOf(KINDS_CHATS, "kc");
const PLACE_SHEET = sheetOf(KINDS_PLACES, "kp");

/** A sheet of rows, each labeled at the left, in columns of the sidebar's ground. */
function Sheet({
  heads,
  lines,
  widths,
}: {
  heads: readonly string[];
  lines: readonly (
    | "rule"
    | { cells: ReactNode[]; label: string; note: string }
  )[];
  widths: readonly number[];
}) {
  return (
    <div className="flex size-full flex-col justify-center bg-white px-6 text-foreground dark:bg-background">
      <div className="flex items-end gap-6 pb-1.5">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        {heads.map((head, column) => (
          <div
            className="shrink-0 px-2 text-[12px] font-medium text-muted-foreground"
            key={head}
            style={{ width: widths[column] }}
          >
            {head}
          </div>
        ))}
      </div>
      {lines.map((line, index) =>
        line === "rule" ? (
          <div className="h-3" key={`rule-${String(index)}`} />
        ) : (
          <div className="flex items-stretch gap-6" key={line.label}>
            <div
              className="flex shrink-0 flex-col items-end justify-center pr-1 text-right"
              style={{ width: LABEL_WIDTH }}
            >
              <span className="text-[12px] leading-4 font-medium text-foreground/80">
                {line.label}
              </span>
              {line.note && (
                <span className="text-[11px] leading-4 text-muted-foreground">
                  {line.note}
                </span>
              )}
            </div>
            {line.cells.map((cell, column) => (
              <div
                className="shrink-0 bg-ground px-2 py-1"
                key={`${line.label}-${String(column)}`}
                style={{ width: widths[column] }}
              >
                {cell}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function row(key: string, options: { isCloseShown?: boolean } = {}) {
  return (
    <GroupRow
      chatTitles={TITLES}
      entry={entryOf(key)}
      isUp={false}
      onClose={noop}
      onCloseTab={noop}
      {...options}
    />
  );
}

const TITLES = new Map(
  Object.values(CAST).map((each) => [each.id, each.title]),
);

function KindsSheet({
  caption,
  height,
  note,
  sheet,
  width,
}: {
  caption: string;
  height: number;
  note: string;
  sheet: ReturnType<typeof sheetOf>;
  width: 200 | 320;
}) {
  // The sheet's columns at this width: alone, then half of a split.
  const columns = SHEET_WIDTHS.flatMap((each, column) =>
    each === width ? [column] : [],
  );
  return (
    <Frame
      caption={`${caption} at ${String(width)}`}
      height={height}
      note={note}
      width={LABEL_WIDTH + 96 + width * 2}
    >
      <CastSources
        chats={PRICING_CHATS}
        drafts={DRAFTS}
        pageLoads={sheet.loads}
      >
        <Picture tabs={sheet.tabs}>
          <Sheet
            heads={["Alone", "Half of a split"]}
            lines={sheet.lines.map((line) =>
              line === "rule"
                ? line
                : {
                    cells: columns.map((column) => {
                      const key = line.keys[column] ?? "";
                      return <Fragment key={key}>{row(key)}</Fragment>;
                    }),
                    label: line.kind.label,
                    note: line.kind.note,
                  },
            )}
            widths={[width, width]}
          />
        </Picture>
      </CastSources>
    </Frame>
  );
}

// Closing half a split ------------------------------------------------------

const CLOSE_TABS = windowOf(
  ...[0, 1].flatMap((column) => [
    group(`cl-rest-${String(column)}`, [
      [chat(`cl-rest-${String(column)}-c`, "pricing")],
      [pricingSite(`cl-rest-${String(column)}-z`, "zendesk")],
    ]),
    group(`cl-hover-${String(column)}`, [
      [chat(`cl-hover-${String(column)}-c`, "pricing")],
      [pricingSite(`cl-hover-${String(column)}-z`, "zendesk")],
    ]),
    group(`cl-closed-${String(column)}`, [
      [chat(`cl-closed-${String(column)}-c`, "pricing")],
    ]),
    group(`cl-whole-${String(column)}`, [
      [
        chat(`cl-whole-${String(column)}-c`, "renewals"),
        pricingSite(`cl-whole-${String(column)}-g`, "gmail"),
        pricingSite(`cl-whole-${String(column)}-h`, "hubspot"),
        pricingSite(`cl-whole-${String(column)}-s`, "sheets"),
      ],
    ]),
  ]),
);

function CloseSheet() {
  const both = (key: string, options: { isCloseShown?: boolean } = {}) =>
    [0, 1].map((column) => (
      <Fragment key={column}>
        {row(`${key}-${String(column)}`, options)}
      </Fragment>
    ));
  return (
    <Frame
      caption="Closing half a split"
      height={400}
      note="Under the pointer, each half of a split has its own X, which closes that half's tab, and the other half takes the whole row. A row of one side has one X, which closes the group."
      width={860}
    >
      <CastSources chats={PRICING_CHATS}>
        <Picture tabs={CLOSE_TABS}>
          <Sheet
            heads={["320 wide", "200 wide"]}
            lines={[
              { cells: both("cl-rest"), label: "At rest", note: "" },
              {
                cells: both("cl-hover", { isCloseShown: true }),
                label: "Under the pointer",
                note: "each half shows its own X",
              },
              {
                cells: both("cl-closed"),
                label: "Zendesk closed",
                note: "the chat takes the whole row",
              },
              "rule",
              {
                cells: both("cl-whole", { isCloseShown: true }),
                label: "A whole row under the pointer",
                note: "one X, at the end of its title",
              },
            ]}
            widths={[320, 200]}
          />
        </Picture>
      </CastSources>
    </Frame>
  );
}

// The sidebar ---------------------------------------------------------------

const PRICING_TABS = windowOf(
  group("board", [
    [screen("board-f", fileHref(`${HOME}/Board/q3-board-update.md`))],
    [chat("board-c", "soc")],
  ]),
  group("queue", [
    [pricingSite("queue-s", "slack")],
    [pricingSite("queue-t", "tickets")],
  ]),
  group("pricing", [
    [chat("pricing-c", "pricing")],
    [pricingSite("pricing-z", "zendesk")],
  ]),
  group("research", [
    [
      chat("research-c", "research"),
      screen("research-f", fileHref(`${HOME}/Pricing/competitor-prices.csv`)),
    ],
    [
      pricingSite("research-fd", "freshdesk"),
      pricingSite("research-i", "intercom"),
      pricingSite("research-g", "g2"),
    ],
  ]),
  group("renewals", [
    [
      chat("renewals-c", "renewals"),
      pricingSite("renewals-g", "gmail"),
      pricingSite("renewals-h", "hubspot"),
      pricingSite("renewals-s", "sheets"),
    ],
  ]),
  group("soc", [
    [chat("soc-c", "soc")],
    [screen("soc-f", fileHref(`${HOME}/Security/soc2-audit-quotes.csv`))],
  ]),
  group("faq", [[chat("faq-c", "faq")]]),
  group("intercom", [[pricingSite("intercom-p", "intercom")]]),
  group("files", [
    [screen("files-d", folderHref(`${HOME}/Pricing`))],
    [screen("files-f", fileHref(`${HOME}/Pricing/pricing-page-faq.md`))],
  ]),
  group("settings", [[screen("settings-p", "/settings/permissions")]]),
  group("newtab", [[screen("newtab-n", NEW_TAB_HREF)]]),
);

const PRICING_LOADS = new Map<string, PageLoad>([
  ["research-fd", "loading"],
  ["intercom-p", "failed"],
]);

const PRICING_ROWS: readonly RowSpec[] = [
  { group: "board", pinned: true, title: "q3-board-update.md" },
  { group: "queue", pinned: true, title: "#support" },
  { chat: "pricing", group: "pricing" },
  { chat: "research", group: "research" },
  { chat: "renewals", group: "renewals" },
  { chat: "soc", group: "soc" },
  { chat: "faq", group: "faq" },
  { group: "intercom", title: "Pricing" },
  { group: "files", title: "Pricing" },
  { group: "settings", title: "Settings" },
  { group: "newtab", title: "New Tab" },
];

function PricingSidebar({ width }: { width: number }) {
  const rows = useRows(PRICING_ROWS);
  return (
    <Frame
      caption={`Sidebar at ${String(width)}`}
      height={800}
      note="The pricing week the rows wireframe draws. The Active list names Pricing page headlines and Weekly churn report, which have no tab, and leaves out Rewrite the pricing FAQ, which stopped."
      width={width}
    >
      <Picture tabs={PRICING_TABS}>
        <div className="size-full bg-ground">
          <SidebarPicture groupUp="pricing" rows={rows} />
        </div>
      </Picture>
    </Frame>
  );
}

/** Every frame of the rows. */
export function RowFrames() {
  return (
    <>
      <div className="flex flex-wrap items-start gap-6">
        <CastSources chats={PRICING_CHATS} pageLoads={PRICING_LOADS}>
          <PricingSidebar width={320} />
          <PricingSidebar width={200} />
        </CastSources>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <KindsSheet
          caption="Chats and web pages"
          height={640}
          note="A chat's mark is always the bubble. Its state is in its words: green while it works, its title bold while it asks or has a reply, red when it stops."
          sheet={CHAT_SHEET}
          width={320}
        />
        <KindsSheet
          caption="Chats and web pages"
          height={640}
          note="A chat's mark is always the bubble. Its state is in its words: green while it works, its title bold while it asks or has a reply, red when it stops."
          sheet={CHAT_SHEET}
          width={200}
        />
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <KindsSheet
          caption="Files, folders and Instrument's pages"
          height={860}
          note="Every page keeps the mark its tab wears, and the second line says where it is or which part is open."
          sheet={PLACE_SHEET}
          width={320}
        />
        <KindsSheet
          caption="Files, folders and Instrument's pages"
          height={860}
          note="Every page keeps the mark its tab wears, and the second line says where it is or which part is open."
          sheet={PLACE_SHEET}
          width={200}
        />
      </div>
      <CloseSheet />
    </>
  );
}
