import { appStates } from "./-states/app-states";
import { controlsStates } from "./-states/controls";
import { iconsStates } from "./-states/icons";
import { noticesStates } from "./-states/notices";
import { questionStates } from "./-states/question";
import { trialStates } from "./-states/trial-offers";
import { type DebugStateEntry } from "./-states/types";

/** The small picture an index card draws for a page, by its kind. */
export type DebugPicture =
  | "card"
  | "chat"
  | "grid"
  | "mono"
  | "rows"
  | "swatch"
  | "tiles"
  | "type";

export const debugGroups = [
  { id: "state", label: "Try a state" },
  { id: "chat", label: "Chat" },
  { id: "look", label: "Look and feel" },
] as const;

type DebugGroupId = (typeof debugGroups)[number]["id"];

interface DebugPage {
  group: DebugGroupId;
  id: string;
  label: string;
  /** What the page is for, in a line, on its index card. */
  line: string;
  picture: DebugPicture;
  states?: readonly DebugStateEntry[];
  /** The page's tabs, each at `?tab=<id>`; the first is where it opens. */
  tabs?: readonly { id: string; label: string }[];
  to: string;
}

/**
 * Every debug page, in the order the index and the title picker list them.
 * The id is what a page's own module looks itself up by.
 */
export const debugPages = [
  {
    group: "state",
    id: "app-states",
    label: "App states",
    line: "Open a dialog, fake an update, fill the bell, or run setup again.",
    picture: "rows",
    states: appStates,
    to: "/debug/app-states",
  },
  {
    group: "state",
    id: "billing",
    label: "Billing",
    line: "Sign in as a test account and see what billing answers.",
    picture: "mono",
    to: "/debug/billing",
  },
  {
    group: "state",
    id: "trial-modes",
    label: "Trial offers",
    line: "Every plan note and card in each offer the platform can make.",
    picture: "tiles",
    states: trialStates,
    to: "/debug/trial-modes",
  },
  {
    group: "chat",
    id: "transcript",
    label: "Transcript",
    line: "Replay a scenario or one of your chats, one step at a time.",
    picture: "chat",
    to: "/debug/components/transcript",
  },
  {
    group: "look",
    id: "two-sides",
    label: "Two sides",
    line: "Tab groups, their sides and every drag, frozen mid-gesture.",
    picture: "tiles",
    to: "/debug/components/two-sides",
  },
  {
    group: "chat",
    id: "question",
    label: "Question card",
    line: "Every way a question can be asked and answered.",
    picture: "card",
    states: questionStates,
    to: "/debug/components/question",
  },
  {
    group: "chat",
    id: "notices",
    label: "Notices",
    line: "Model notices, toasts, alerts and the error card.",
    picture: "rows",
    states: noticesStates,
    tabs: [
      { id: "model-notices", label: "Model notices" },
      { id: "toasts", label: "Toasts" },
      { id: "alerts", label: "Alerts" },
      { id: "error-card", label: "Error card" },
    ],
    to: "/debug/components/notices",
  },
  {
    group: "look",
    id: "typography",
    label: "Typography",
    line: "Prose, headings, lists, code and tables as a reply renders them.",
    picture: "type",
    to: "/debug/components/typography",
  },
  {
    group: "look",
    id: "colors",
    label: "Colors",
    line: "Every color scale and token, light and dark.",
    picture: "swatch",
    to: "/debug/components/colors",
  },
  {
    group: "look",
    id: "elevation",
    label: "Elevation",
    line: "Each shadow and what uses it.",
    picture: "tiles",
    to: "/debug/components/elevation",
  },
  {
    group: "look",
    id: "controls",
    label: "Controls",
    line: "Fields, buttons, switches, tabs and the spinner.",
    picture: "rows",
    states: controlsStates,
    tabs: [
      { id: "form-elements", label: "Form elements" },
      { id: "spinner", label: "Spinner" },
    ],
    to: "/debug/components/controls",
  },
  {
    group: "look",
    id: "icons",
    label: "Icons",
    line: "App, provider and file icons on every surface that draws them.",
    picture: "grid",
    states: iconsStates,
    tabs: [
      { id: "apps", label: "Apps" },
      { id: "providers", label: "Providers" },
      { id: "files", label: "Files" },
    ],
    to: "/debug/components/icons",
  },
] as const satisfies readonly DebugPage[];

type ListedPage = (typeof debugPages)[number];
export type DebugPageId = ListedPage["id"];

export function getDebugPage(id: DebugPageId): DebugPage {
  const page = debugPages.find((each): each is ListedPage => each.id === id);
  if (!page) {
    throw new Error(`Unknown debug page: ${id}`);
  }
  return page;
}

/** The debug page a path is on, or none for the index and any other path. */
export function debugPageAt(pathname: string): ListedPage | undefined {
  const path = pathname.replace(/\/$/, "");
  return debugPages.find((page): page is ListedPage => page.to === path);
}

/** The pages about the app as a whole, which the command menu lists by name. */
export const debugNavigationRoutes = debugPages
  .filter((page) => page.group === "state")
  .map(({ id, label, to }) => ({ id, label, to }));

/** The pages of the app's pieces, which the command menu lists as components. */
export const componentPages = debugPages
  .filter((page) => page.group !== "state")
  .map(({ id, label, to }) => ({ id, label, to }));

/**
 * What a tab standing on a debug page is called, read off its path alone so
 * every place that names a tab from its address names this one too. The index
 * and a page this file does not list are "Debug pages", never an unnamed tab.
 */
export function debugPageTitle(pathname: string): string {
  return debugPageAt(pathname)?.label ?? "Debug pages";
}
