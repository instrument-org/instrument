import { type SettingsTab } from "@/client/atoms/settings-modal";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { APP_NAME } from "@instrument-org/shared";
import uFuzzy from "@leeoniya/ufuzzy";

/**
 * One thing Settings search can find: a row of a page, or something a page
 * lists (a provider, a memory).
 */
export type SettingsEntry = {
  /** Words someone might search by that the title and detail don't say. */
  aliases?: string;
  detail?: string;
  /** A row that is drawn only in developer mode, on a page everyone sees. */
  developerOnly?: true;
  /**
   * The row's `data-setting` mark, which a jump scrolls to and lights. A
   * memory has none: Settings opens to it by name instead.
   */
  id: string;
  /** What Settings is opened with beyond the page, for a memory. */
  open?: { memory: string };
  /** A whole page, which opens at its top rather than at a row. */
  page?: true;
  tab: SettingsTab;
  title: string;
};

/**
 * The rows every page draws, in the order they appear. A row a page draws
 * from data (a provider, a memory, a feature flag) is added where the
 * search is made, from the same queries the pages read.
 *
 * Each id here is put on its row with {@link settingAnchor}, and a test holds
 * the two in step, so a row that is moved or removed takes its entry with it.
 */
export const SETTINGS_INDEX = [
  {
    aliases: "sign in log in log out email subscription plan profile",
    detail: `Your ${APP_NAME} account and plan`,
    id: "account",
    tab: "General",
    title: "Account",
  },
  {
    aliases: "dark light mode appearance color",
    detail: "Choose your preferred color scheme.",
    id: "theme",
    tab: "General",
    title: "Theme",
  },
  {
    aliases: "text size bigger smaller scale font",
    detail: "Make everything in the app larger or smaller.",
    id: "zoom",
    tab: "General",
    title: "Zoom",
  },
  {
    aliases: "notifications alerts desktop test notification",
    detail: "Show a desktop notification when a task finishes.",
    id: "notifications",
    tab: "General",
    title: "Notify when tasks finish",
  },
  {
    aliases: "about update check for updates release notes install",
    detail: `Which version of ${APP_NAME} you have, and updates`,
    id: "version",
    tab: "General",
    title: "Version and updates",
  },
  {
    aliases: "github source code report a bug feedback",
    detail: "View the source, or tell us about something that isn't working.",
    id: "open-source",
    tab: "General",
    title: "Open source",
  },
  {
    aliases: "release channel beta stable",
    detail: "Which builds this computer updates to.",
    developerOnly: true,
    id: "release-channel",
    tab: "General",
    title: "Update from",
  },
  {
    aliases: "analytics telemetry privacy",
    detail: `Help ${APP_NAME} improve by submitting usage metrics.`,
    id: "usage-metrics",
    tab: "General",
    title: "Usage metrics",
  },
  {
    aliases: "logs support troubleshoot download problem",
    detail: "A local record to send with a problem report",
    id: "diagnostic-log",
    tab: "General",
    title: "Diagnostic log",
  },
  {
    aliases: "memories remember import chatgpt claude gemini",
    detail: "Bring in what another AI knows about you.",
    id: "memory-import",
    tab: "Memory",
    title: "Import from another AI",
  },
  {
    aliases: "ai providers api key model openrouter openai anthropic",
    detail: "Use a model with your own key.",
    id: "add-provider",
    tab: "Providers",
    title: "Add provider",
  },
  {
    aliases: "openai plus pro subscription sign in",
    detail: "Use your ChatGPT Plus or Pro plan.",
    id: "chatgpt-account",
    tab: "Providers",
    title: "ChatGPT account",
  },
  {
    aliases: "anthropic claude code pro max subscription sign in",
    detail: "Use your Claude plan.",
    id: "claude-account",
    tab: "Providers",
    title: "Claude account",
  },
  {
    aliases: "create make skill",
    detail: "Ask for a skill that teaches a new way of working.",
    id: "new-skill",
    tab: "Skills",
    title: "New skill",
  },
  {
    aliases: "folder disk path files storage where",
    detail: "Where your chats and tasks live on this computer",
    id: "workspace-location",
    tab: "Storage",
    title: "Workspace location",
  },
  {
    aliases: "unrecognized folders storage delete",
    detail: "Chats and tasks with problems in their folders",
    id: "broken-folders",
    tab: "Storage",
    title: "Broken chats and tasks",
  },
  {
    aliases: "encryption keychain safe storage",
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

const fuzzy = new uFuzzy({ intraMode: 1 });

/**
 * Ranks entries against `query`, best first, with the ranges to highlight in
 * each title. The detail, aliases, and page name are searched too, so "dark"
 * finds Theme and "providers" every provider, but only the title is drawn, so
 * an entry whose title matches comes first, then one whose detail or aliases
 * do, and last one found only by the page it is on.
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
    joinFuzzyFields([
      entry.title,
      entry.detail ?? "",
      entry.aliases ?? "",
      entry.tab,
    ]),
  );
  const haystack = fields.map((field) => field.haystack);
  const indexes = fuzzy.filter(haystack, needle);
  if (!indexes || indexes.length === 0) {
    return [];
  }
  const info = fuzzy.info(indexes, haystack, needle);
  const order = fuzzy.sort(info, haystack, needle);
  const ranked = order.flatMap((orderIdx) => {
    const index = info.idx[orderIdx] ?? -1;
    const entry = entries[index];
    const field = fields[index];
    if (!entry || !field) {
      return [];
    }
    const [titleRanges, detailRanges, aliasRanges] = field.splitRanges(
      info.ranges[orderIdx] ?? null,
    );
    const tier = titleRanges ? 0 : detailRanges || aliasRanges ? 1 : 2;
    return [{ entry, tier, titleRanges: titleRanges ?? null }];
  });
  // Stable, so uFuzzy's order holds within each tier.
  return ranked
    .toSorted((a, b) => a.tier - b.tier)
    .map(({ entry, titleRanges }) => ({ entry, titleRanges }));
}
