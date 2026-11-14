import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/window";
import { type WindowTabs } from "@/client/components/window/tab-model";
import { chatHref } from "@/client/components/window/window-href";
import { type ChatId, ChatIdSchema } from "@instrument-org/workspace/client";

/**
 * The tabs, groups and chats the two-sides page draws its frames from. Each
 * frame is a window of its own, so ids only need to be unique within one;
 * they are written out so a frame reads the same on every load.
 */

/** A chat as a frame casts it: the first two stand for the workspace's latest chats where it has them. */
export interface CastChat {
  /** What the person asked, as a stand-in for the chat shows it. */
  asked: string;
  id: ChatId;
  /** The chat's latest line, as its row says it. */
  latest: string;
  status?: "failed" | "idle" | "waiting" | "working";
  /** The step a working chat is on. */
  step?: string;
  title: string;
  unread?: boolean;
}

const chatId = (id: string) => ChatIdSchema.parse(`two-sides-${id}`);

export const CAST = {
  roof: {
    asked:
      "Can you compare the three roof quotes and tell me which is the best value?",
    id: chatId("roof"),
    latest:
      "Coastline is the cheapest of the three at $14,200, with a 20-year warranty.",
    title: "Roof quotes",
  },
  lisbon: {
    asked:
      "Find me a flat in Alfama for four nights in March, under €120 a night.",
    id: chatId("lisbon"),
    latest: "Four flats near Alfama come in under €120 a night in March.",
    title: "Lisbon in March",
  },
  numbers: {
    asked: "Pull the quarter's numbers from the budget and tell me how we did.",
    id: chatId("numbers"),
    latest: "Revenue is up 12% on the quarter.",
    status: "working",
    step: "Reading Q3 budget.xlsx",
    title: "Quarterly numbers",
  },
  hiring: {
    asked: "Go through the portfolios that came in for the designer role.",
    id: chatId("hiring"),
    latest: "Which of the three portfolios should I write back to first?",
    status: "waiting",
    title: "Hiring a designer",
  },
  garden: {
    asked: "When should I plant tomatoes and peppers this spring?",
    id: chatId("garden"),
    latest: "Tomatoes go in after the last frost, around the middle of May.",
    title: "Garden plan for spring",
    unread: true,
  },
  taxes: {
    asked: "How much should my fourth-quarter estimated payment be?",
    id: chatId("taxes"),
    latest: "Your estimated payment for the fourth quarter is due January 15.",
    title: "Estimated taxes",
  },
  wedding: {
    asked:
      "Seat everyone on the guest list at the reception, keeping families together.",
    id: chatId("wedding"),
    latest: "The venue holds 140 seated, so the list has room for twelve more.",
    title: "Wedding guest list and seating for the reception",
  },
  bike: {
    asked: "What frame size fits me? I'm 5 foot 10 with a 32 inch inseam.",
    id: chatId("bike"),
    latest: "A 54cm frame fits your height and inseam best.",
    title: "Road bike sizing",
  },
  recipes: {
    asked: "Plan five dinners I can cook on Sunday that keep all week.",
    id: chatId("recipes"),
    latest: "Here are five dinners that keep for three days in the fridge.",
    title: "Meal prep for the week",
  },
  newsletter: {
    asked: "Draft the November newsletter from my notes.",
    id: chatId("newsletter"),
    latest: "I drafted the November issue in your voice; it runs 640 words.",
    title: "November newsletter",
  },
  move: {
    asked: "Get me quotes from three movers for the 14th.",
    id: chatId("move"),
    latest:
      "Three movers can do the 14th; Atlas is the only one with insurance included.",
    title: "Moving quotes",
  },
  podcast: {
    asked: "Write show notes for this week's episode.",
    id: chatId("podcast"),
    latest: "Stopped on an error",
    status: "failed",
    title: "Podcast show notes",
  },
  // The pricing week the sidebar rows' wireframe draws.
  pricing: {
    asked: "Line up Zendesk's plans against ours.",
    id: chatId("pricing"),
    latest: "Zendesk's Suite Team is $55 an agent, so we're $16 under it.",
    title: "Help desk pricing",
  },
  research: {
    asked: "Find out what every help desk charges a seat.",
    id: chatId("research"),
    latest: "Intercom's cheapest seat is $39.",
    status: "working",
    step: "Reading plans on freshworks.com",
    title: "Competitor research",
  },
  renewals: {
    asked: "Draft a renewal reminder for every account due in October.",
    id: chatId("renewals"),
    latest: "Send the 14 drafts now?",
    status: "waiting",
    title: "Renewal reminders",
  },
  soc: {
    asked: "Which auditor quoted the least for SOC 2?",
    id: chatId("soc"),
    latest: "Ridgeline came in lowest at $18,400.",
    title: "SOC 2 audit quotes",
    unread: true,
  },
  faq: {
    asked: "Rewrite the pricing FAQ for the new plans.",
    id: chatId("faq"),
    latest: "Stopped on an error",
    status: "failed",
    title: "Rewrite the pricing FAQ",
  },
  headlines: {
    asked: "Write five headlines for the pricing page that lead with the $39 plan.",
    id: chatId("headlines"),
    latest: "Here are five headlines that lead with the $39 plan.",
    title: "Pricing page headlines",
    unread: true,
  },
  churn: {
    asked: "Write up this week's churn.",
    id: chatId("churn"),
    latest: "Churn was 2.1% last week.",
    status: "working",
    step: "Reading October cancellations",
    title: "Weekly churn report",
  },
} satisfies Record<string, CastChat>;

/** The pricing week's chats, in the order the Active list would see them. */
export const PRICING_CHATS = [
  "pricing",
  "renewals",
  "soc",
  "headlines",
  "research",
  "churn",
  "faq",
] as const satisfies readonly CastKey[];

export type CastKey = keyof typeof CAST;

/** The cast chat at an id, if the id is one of the cast's. */
export function castAt(id: ChatId): CastChat | undefined {
  return Object.values(CAST).find((each) => each.id === id);
}

/** The chats that stand for the workspace's own latest, in order, where it has them: what is up in a side is one of these. */
export const REAL_FIRST: readonly CastKey[] = ["roof", "lisbon"];

/** Sites the frames open, by what a person would recognize. */
export const SITES = {
  airbnb: {
    title: "Alfama, Lisbon · Stays · Airbnb",
    url: "https://www.airbnb.com/s/Alfama--Lisbon/homes",
  },
  coastline: {
    title: "Roof Replacement Quote Request | Coastline Roofing",
    url: "https://www.coastlineroofing.com/quote",
  },
  docs: {
    title: "Q3 budget - Google Sheets",
    url: "https://docs.google.com/spreadsheets/d/1q3budget/edit",
  },
  github: {
    title: "Pull requests · GitHub",
    url: "https://github.com/pulls",
  },
  hn: { title: "Hacker News", url: "https://news.ycombinator.com/" },
  long: {
    title:
      "The Complete Guide to Choosing Roofing Materials for Coastal Homes: Asphalt, Metal, Tile, Slate and Everything Between",
    url: "https://www.thisoldhouse.com/roofing/coastal-roofing-materials-guide",
  },
  maps: {
    title: "Alfama – Google Maps",
    url: "https://www.google.com/maps/place/Alfama,+Lisbon",
  },
  nyt: {
    title: "The New York Times - Breaking News, US News, World News",
    url: "https://www.nytimes.com/",
  },
  reviews: {
    title: "Coastline Roofing Reviews | Read Customer Service Reviews",
    url: "https://www.trustpilot.com/review/coastlineroofing.com",
  },
  weather: {
    title: "Lisbon, Portugal 10-Day Weather Forecast",
    url: "https://weather.com/weather/tenday/l/Lisbon+Portugal",
  },
  wiki: {
    title: "Alfama - Wikipedia",
    url: "https://en.wikipedia.org/wiki/Alfama",
  },
  youtube: {
    title: "How to Inspect a Roof Yourself - YouTube",
    url: "https://www.youtube.com/watch?v=roof-inspection",
  },
  zendesk: {
    title: "Zendesk pricing | Plans for every team",
    url: "https://www.zendesk.com/pricing/",
  },
} satisfies Record<string, { title: string; url: string }>;

export type SiteKey = keyof typeof SITES;

/** The pricing week's sites, apart from `SITES`, which other frames cycle through. */
export const PRICING_SITES = {
  freshdesk: {
    title: "Plans",
    url: "https://www.freshworks.com/freshdesk/pricing/",
  },
  g2: {
    title: "Help desk software",
    url: "https://www.g2.com/categories/help-desk",
  },
  gmail: {
    title: "Drafts (14)",
    url: "https://mail.google.com/mail/u/0/#drafts",
  },
  hubspot: {
    title: "Renewals pipeline",
    url: "https://app.hubspot.com/contacts/deals/renewals",
  },
  intercom: { title: "Pricing", url: "https://www.intercom.com/pricing" },
  sheets: {
    title: "October renewals",
    url: "https://docs.google.com/spreadsheets/d/1Rk4",
  },
  slack: { title: "#support", url: "https://app.slack.com/client/T02/support" },
  tickets: {
    title: "Unsolved tickets",
    url: "https://acme.zendesk.com/agent/filters/unsolved",
  },
  zendesk: { title: "Suite plans", url: "https://www.zendesk.com/pricing/" },
} satisfies Record<string, { title: string; url: string }>;

export function pricingSite(
  id: string,
  key: keyof typeof PRICING_SITES,
): Loose {
  const { title, url } = PRICING_SITES[key];
  return { id, kind: "page", openedAt: 0, openedUrl: url, title, url };
}

/** A tab before it is placed in a group. */
type Loose = WindowTab;

export function site(id: string, key: SiteKey): Loose {
  const { title, url } = SITES[key];
  return { id, kind: "page", openedAt: 0, openedUrl: url, title, url };
}

export function screen(id: string, href: string): Loose {
  return { href, id, kind: "screen" };
}

export function chat(id: string, key: CastKey): Loose {
  return screen(id, chatHref(CAST[key].id));
}

export function newChat(id: string): Loose {
  return screen(id, NEW_TAB_HREF);
}

/**
 * One group's tabs, a list per side, left first, placed in it: `up` names
 * the tab up on each side, and `focused` the side with the keyboard.
 */
export function group(
  key: string,
  sides: readonly (readonly Loose[])[],
  { focused = 0, up = [] }: { focused?: 0 | 1; up?: readonly string[] } = {},
): WindowTabs {
  const tabs = sides.flatMap((tabsOfSide, index) =>
    tabsOfSide.map(
      (tab): WindowTab => ({
        ...tab,
        group: key,
        ...(index === 1 ? { side: 1 as const } : {}),
      }),
    ),
  );
  const upOn = (side: number) => up[side] ?? sides[side]?.[0]?.id ?? undefined;
  const active = upOn(focused);
  const beside = sides.length === 2 ? upOn(focused === 0 ? 1 : 0) : undefined;
  return {
    activeByGroup: active === undefined ? {} : { [key]: active },
    besideByGroup: beside === undefined ? {} : { [key]: beside },
    tabs,
  };
}

/** Several groups' tabs as one window's. */
export function windowOf(...groups: WindowTabs[]): WindowTabs {
  return {
    activeByGroup: Object.fromEntries(
      groups.flatMap((each) => Object.entries(each.activeByGroup)),
    ),
    besideByGroup: Object.fromEntries(
      groups.flatMap((each) => Object.entries(each.besideByGroup ?? {})),
    ),
    tabs: groups.flatMap((each) => each.tabs),
  };
}

/** A sidebar row: a chat's group by its cast chat, or a group with no chat by its tabs. */
export type RowSpec = {
  group: string;
  name?: string;
  pinned?: boolean;
} & ({ chat: CastKey } | { title: string });

/** Every site, in order, as tabs of one side. */
export function sitesAsTabs(prefix: string, count: number): Loose[] {
  const keys = Object.keys(SITES).filter(isSiteKey);
  return Array.from({ length: count }, (_, index) =>
    site(`${prefix}${String(index)}`, keys[index % keys.length] ?? "wiki"),
  );
}

function isSiteKey(key: string): key is SiteKey {
  return key in SITES;
}
