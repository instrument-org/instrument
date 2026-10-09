import { type SettingsTab } from "@/client/atoms/settings-modal";
import { APP_NAME } from "@instrument-org/shared";
import uFuzzy from "@leeoniya/ufuzzy";

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
 * Each id here is put on its row with {@link settingAnchor}, and a test holds
 * the two in step, so a row that is moved or removed takes its entry with it.
 */
export const SETTINGS_INDEX = [
  {
    detail: `Your ${APP_NAME} account and plan`,
    id: "account",
    tab: "General",
    title: "Account",
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
    detail: "Which builds this computer updates to.",
    developerOnly: true,
    id: "release-channel",
    tab: "General",
    title: "Update from",
  },
  {
    detail: `Help ${APP_NAME} improve by submitting usage metrics.`,
    id: "usage-metrics",
    tab: "General",
    title: "Usage metrics",
  },
  {
    detail: "A local record to send with a problem report",
    id: "diagnostic-log",
    tab: "General",
    title: "Diagnostic log",
  },
  {
    detail: "Bring in what another AI knows about you.",
    id: "memory-import",
    tab: "Memory",
    title: "Import from another AI",
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
    detail: "Ask for a skill that teaches a new way of working.",
    id: "new-skill",
    tab: "Skills",
    title: "New skill",
  },
  {
    detail: "Where your chats and tasks live on this computer",
    id: "workspace-location",
    tab: "Storage",
    title: "Workspace location",
  },
  {
    detail: "Chats and tasks with problems in their folders",
    id: "broken-folders",
    tab: "Storage",
    title: "Broken chats and tasks",
  },
  {
    detail: "Whether this computer can encrypt saved keys",
    id: "secure-storage",
    tab: "Debug",
    title: "Secure storage",
  },
] as const satisfies readonly SettingsEntry[];

export type SettingId = (typeof SETTINGS_INDEX)[number]["id"];

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

export type SettingsMatch = {
  entry: SettingsEntry;
  titleRanges: null | number[];
};

/**
 * Each word of a search has to appear as written, starting a word of the
 * title: "pro" finds "Add provider" but not "Import", and nothing is found
 * by a word the result doesn't show.
 */
const fuzzy = new uFuzzy({ interLft: 1, intraIns: 0 });

/** Ranks entries whose titles hold `query`, best first, with the ranges to highlight. */
export function matchSettings(
  entries: SettingsEntry[],
  query: string,
): SettingsMatch[] {
  const needle = query.trim();
  if (!needle) {
    return [];
  }
  const titles = entries.map((entry) => entry.title);
  const indexes = fuzzy.filter(titles, needle);
  if (!indexes || indexes.length === 0) {
    return [];
  }
  const info = fuzzy.info(indexes, titles, needle);
  return fuzzy.sort(info, titles, needle).flatMap((orderIdx) => {
    const entry = entries[info.idx[orderIdx] ?? -1];
    return entry ? [{ entry, titleRanges: info.ranges[orderIdx] ?? null }] : [];
  });
}
