import { GROK_CONNECT_COPY } from "@/client/lib/connect-copy";
import { type SettingsTab } from "@/client/atoms/settings-modal";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { APP_NAME } from "@instrument-org/shared";
import { boundedFuzzy } from "@/client/lib/bounded-fuzzy";

/**
 * One thing Settings search can find: a page, a row of one, or something a
 * page lists (a provider, a feature flag).
 */
export type SettingsEntry = {
  /**
   * What the row is for, which the decision model reads when the words of a
   * search match no title. Words are matched against the title alone, so a
   * result is always found by text it shows.
   */
  detail?: string;
  /** A row that is drawn only in developer mode, on a page everyone sees. */
  developerOnly?: true;
  /** The row's `data-setting` mark, which a jump scrolls to and lights. */
  id: string;
  /**
   * For a button or link on a row, found by its own label: the row's mark,
   * which a jump lights in place of one of its own.
   */
  mark?: string;
  /** A whole page, which opens at its top rather than at a row. */
  page?: true;
  tab: SettingsTab;
  title: string;
};

/**
 * The rows every page draws, in the order they appear. A row a page draws
 * from data (a provider, a feature flag) is added where the search is made,
 * from the same queries the pages read.
 *
 * Each row's id here is put on it with {@link settingAnchor}, and a label
 * names its row's in `mark`. A test holds the two in step, so a row that is
 * moved or removed takes its entries with it.
 */
export const SETTINGS_INDEX = [
  {
    detail: `Who you're logged in to ${APP_NAME} as`,
    id: "account",
    tab: "Account",
    title: `${APP_NAME} account`,
  },
  {
    detail: "Choose your preferred color scheme.",
    id: "theme",
    tab: "General",
    title: "Theme",
  },
  {
    detail: "Make everything in the app larger or smaller.",
    id: "zoom",
    tab: "General",
    title: "Zoom",
  },
  {
    detail: "Show a desktop notification when a task finishes.",
    id: "notifications",
    tab: "General",
    title: "Notify when tasks finish",
  },
  {
    detail: "Pick the microphone you dictate into.",
    id: "dictation-microphone",
    tab: "General",
    title: "Dictation microphone",
  },
  {
    detail: "Pick the language you speak, or let dictation detect it.",
    id: "dictation-language",
    tab: "General",
    title: "Dictation language",
  },
  {
    detail: "A sound when dictation starts and stops.",
    id: "dictation-sounds",
    tab: "General",
    title: "Dictation sounds",
  },
  {
    detail: `Whether your computer lets ${APP_NAME} use the microphone.`,
    id: "microphone-access",
    tab: "General",
    title: "Microphone access",
  },
  {
    detail: `Which version of ${APP_NAME} you have, and updates`,
    id: "version",
    tab: "General",
    title: "Version and updates",
  },
  {
    detail: "View the source, or tell us about something that isn't working.",
    id: "open-source",
    tab: "General",
    title: "Open source",
  },
  {
    detail: "Switch which API server the app uses.",
    developerOnly: true,
    id: "api-server",
    tab: "General",
    title: "API server",
  },
  {
    detail: "Get beta versions before they ship.",
    developerOnly: true,
    id: "release-channel",
    tab: "General",
    title: "Release channel",
  },
  {
    detail: "A local record to send with a problem report",
    id: "diagnostic-log",
    tab: "General",
    title: "Diagnostic log",
  },
  {
    detail: "Your free trial or subscription, and changing your plan",
    id: "plan",
    tab: "Account",
    title: "Plan",
  },
  {
    detail: "Switch to another plan.",
    id: "change-plan",
    mark: "plan",
    tab: "Account",
    title: "Change plan",
  },
  {
    detail:
      "Your card and invoices, and canceling your subscription, in Stripe",
    id: "billing-portal",
    tab: "Account",
    title: "Payment method and invoices",
  },
  {
    detail: "Your card, invoices, and subscription, in Stripe",
    id: "manage-billing",
    mark: "billing-portal",
    tab: "Account",
    title: "Manage billing",
  },
  {
    detail: "Bring in what another AI knows about you.",
    id: "memory-import",
    tab: "Memory",
    title: "Import from another AI",
  },
  {
    detail:
      "Open the folder of your memories, where each one is a file you can read or change.",
    id: "memory-folder",
    tab: "Memory",
    title: "Memory folder",
  },
  {
    detail: "Use a model with your own key.",
    id: "add-provider",
    tab: "Providers",
    title: "Add provider",
  },
  {
    detail: "Use your ChatGPT Plus or Pro plan.",
    id: "chatgpt-account",
    tab: "Providers",
    title: "ChatGPT account",
  },
  {
    detail: "Use your Claude plan.",
    id: "claude-account",
    tab: "Providers",
    title: "Claude account",
  },
  {
    detail: GROK_CONNECT_COPY.caption,
    id: "grok-account",
    tab: "Providers",
    title: "Grok account",
  },
  {
    detail: "Use any folder that isn't marked Not allowed, without asking.",
    id: "use-folders-without-asking",
    tab: "Permissions",
    title: "Use folders without asking",
  },
  {
    detail: `Your Instrument folder, each chat's files, past chats and caches, which every chat can use because ${APP_NAME} needs them.`,
    id: "always-open",
    tab: "Permissions",
    title: "Folders every chat can use",
  },
  {
    detail: `Put every folder and app back the way they were when you installed ${APP_NAME}.`,
    id: "reset-permissions",
    tab: "Permissions",
    title: "Reset permissions",
  },
  {
    detail: "Ask for a skill that teaches a new way of working.",
    id: "new-skill",
    tab: "Skills",
    title: "New skill",
  },
  {
    detail: "Where your chats, topics, and memories are kept, and moving them",
    id: "instrument-folder",
    tab: "Storage",
    title: "Instrument folder",
  },
  {
    detail: "Chats in your Instrument folder that can’t be opened",
    id: "broken-folders",
    tab: "Storage",
    title: "Chats that can’t be opened",
  },
  {
    detail: "Whether this computer can encrypt saved keys",
    id: "secure-storage",
    tab: "Debug",
    title: "Secure storage",
  },
  {
    id: "release-notes",
    mark: "version",
    tab: "General",
    title: "Release notes",
  },
  {
    id: "check-for-updates",
    mark: "version",
    tab: "General",
    title: "Check for updates",
  },
  {
    id: "view-source",
    mark: "open-source",
    tab: "General",
    title: "View source on GitHub",
  },
  {
    id: "send-feedback",
    mark: "open-source",
    tab: "General",
    title: "Send feedback",
  },
  {
    id: "third-party-licenses",
    mark: "open-source",
    tab: "General",
    title: "Third-party licenses",
  },
  {
    id: "test-notification",
    mark: "notifications",
    tab: "General",
    title: "Send a test notification",
  },
  { id: "view-log", mark: "diagnostic-log", tab: "General", title: "View log" },
  { id: "log-out", mark: "account", tab: "Account", title: "Log out" },
] as const satisfies readonly SettingsEntry[];

/** A row's mark: the id of an entry that isn't a label on another row. */
export type SettingId = Exclude<
  (typeof SETTINGS_INDEX)[number],
  { mark: string }
>["id"];

/**
 * The mark a jump finds a row by. Put it on the row's own content rather than
 * a card around it: the flash rounds the box it lights, and a card keeps its
 * own corners.
 */
export function settingAnchor(
  id: SettingId | `${"feature" | "provider"}:${string}`,
) {
  return { "data-setting": id };
}

/**
 * Each page of Settings, in the order its sidebar lists them, with what it is
 * for and who sees it: `developerOnly` for a page only developer mode lists,
 * `shownWhen` for one the sidebar lists only while it has something to show.
 * Typed against every tab, so a page added to Settings does not build until
 * it is described here.
 */
export const SETTINGS_PAGES: Record<
  SettingsTab,
  { detail: string; developerOnly?: true; shownWhen?: string }
> = {
  General: {
    detail: `How ${APP_NAME} looks, notifications, dictation, updates, and the diagnostic log.`,
  },
  Account: {
    detail: `Who you're logged in to ${APP_NAME} as, your plan and its usage limits, and billing.`,
  },
  Providers: {
    detail: `The AI models ${APP_NAME} can use: your ChatGPT, Claude or Grok plan, or a provider you add with your own key.`,
  },
  Memory: {
    detail: `What ${APP_NAME} remembers about you, one file per memory, which you can search, open, forget, or add to from another AI.`,
  },
  Permissions: {
    detail: `Which folders and places on this computer ${APP_NAME} may use.`,
  },
  Skills: {
    detail: `The skills ${APP_NAME}'s tasks can use, and making a new one.`,
  },
  Storage: {
    detail:
      "Where your Instrument folder is, and chats in it that can’t be opened.",
  },
  Activity: {
    detail: `Everything ${APP_NAME} asked an AI model to do, which you can filter, sort, and export.`,
  },
  Features: {
    detail: "Feature flags.",
    developerOnly: true,
  },
  Debug: {
    detail: "Tools for working on the app.",
    developerOnly: true,
    shownWhen: "the app runs on Linux",
  },
};

// `Object.keys` widens the keys to `string`; they are the record's tabs.
const SETTINGS_TABS = Object.keys(SETTINGS_PAGES) as SettingsTab[];

/**
 * Where a link's name for a setting lands: a page by its name in any case
 * (`memory`), a row or a label on one by its id (`zoom`, `release-notes`), or
 * a row a page draws from data (`provider:<id>`). A name Settings has none of,
 * from a reply older or newer than this build, is searched for in its own
 * words, so it still lands near what it meant.
 */
export function settingsTargetOf(
  name: string,
):
  | { kind: "page"; tab: SettingsTab }
  | { kind: "row"; mark: string; tab: SettingsTab }
  | { kind: "search"; search: string } {
  const tab = SETTINGS_TABS.find(
    (page) => page.toLowerCase() === name.toLowerCase(),
  );
  if (tab) {
    return { kind: "page", tab };
  }
  const entry = SETTINGS_INDEX.find((row) => row.id === name);
  if (entry) {
    return {
      kind: "row",
      mark: "mark" in entry ? entry.mark : entry.id,
      tab: entry.tab,
    };
  }
  if (name.startsWith("provider:")) {
    return { kind: "row", mark: name, tab: "Providers" };
  }
  if (name.startsWith("feature:")) {
    return { kind: "row", mark: name, tab: "Features" };
  }
  return { kind: "search", search: name.replaceAll(/[-_:]+/g, " ").trim() };
}

/** Where a setting is, as a person would say the way there: `Settings › General › Zoom`. */
export function settingsPathOf(name: string): string {
  const target = settingsTargetOf(name);
  if (target.kind === "search") {
    return "Settings";
  }
  const entry = SETTINGS_INDEX.find((row) => row.id === name);
  return entry
    ? `Settings › ${target.tab} › ${entry.title}`
    : `Settings › ${target.tab}`;
}

export type SettingsMatch = {
  entry: SettingsEntry;
  /** Ranges to highlight in the page name drawn under a row's title. */
  pageRanges: null | number[];
  titleRanges: null | number[];
};

/**
 * Each word of a search has to appear as written, starting a word of what the
 * result shows: "pro" finds "Add provider" but not "Import".
 */
const fuzzy = boundedFuzzy({ interLft: 1, intraIns: 0 });

/**
 * Ranks entries against `query` by the text each result shows, its title and,
 * for a row, the page name under it, with the ranges to highlight in each. A
 * title match comes first, so "memory" opens with the Memory page and then
 * the rows on it.
 */
export function matchSettings(
  entries: SettingsEntry[],
  query: string,
): SettingsMatch[] {
  const needle = query.trim();
  if (!needle) {
    return [];
  }
  const fields = entries.map((entry) =>
    joinFuzzyFields([entry.title, entry.page ? "" : entry.tab]),
  );
  const haystack = fields.map((field) => field.haystack);
  const indexes = fuzzy.filter(haystack, needle);
  if (!indexes || indexes.length === 0) {
    return [];
  }
  const info = fuzzy.info(indexes, haystack, needle);
  const ranked = fuzzy.sort(info, haystack, needle).flatMap((orderIdx) => {
    const index = info.idx[orderIdx] ?? -1;
    const entry = entries[index];
    const field = fields[index];
    if (!entry || !field) {
      return [];
    }
    const [titleRanges = null, pageRanges = null] = field.splitRanges(
      info.ranges[orderIdx] ?? null,
    );
    return [{ entry, pageRanges, titleRanges }];
  });
  // Stable, so uFuzzy's order holds among title matches and among the rest.
  return ranked.toSorted(
    (a, b) => Number(a.titleRanges === null) - Number(b.titleRanges === null),
  );
}
