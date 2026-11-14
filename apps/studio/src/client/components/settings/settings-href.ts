import { type SettingsRequest } from "@/client/atoms/settings-modal";
import { z } from "zod";

import { settingsTargetOf } from "./settings-index";

/**
 * What a Settings, Memory or Skills address asks of the page once, as it
 * arrives: a row to light, the account's usage to open, the diagnostic log
 * to show, a memory a link named. The page takes them and drops them from
 * its address, so going back to it, or the same ask again, is not a second
 * one of these but a fresh one.
 */
export const ARRIVING_SEARCH = {
  log: z.literal(true).optional().catch(undefined),
  memory: z.coerce.string().optional().catch(undefined),
  setting: z.coerce.string().optional().catch(undefined),
  usage: z.literal("claude-account").optional().catch(undefined),
};

export type ArrivingAsk = {
  log?: true | undefined;
  memory?: string | undefined;
  setting?: string | undefined;
  usage?: "claude-account" | undefined;
};

/**
 * The address a Settings request opens at: a part of Settings by its own
 * name (`/settings/providers`), or Memory's or Skills' own page, with a row a
 * link named to light, or the words it named searched for. A request that
 * names no part is Settings wherever it stands (`/settings`), which a new tab
 * opens at General.
 */
export function settingsHrefOf({
  diagnosticLog,
  memory,
  providerUsage,
  setting,
  tab,
}: SettingsRequest): string {
  const target = setting === undefined ? undefined : settingsTargetOf(setting);
  const page =
    tab ??
    (target === undefined || target.kind === "search" ? undefined : target.tab);
  const search: (readonly [string, string])[] = [
    ...(target?.kind === "row" ? [["setting", target.mark] as const] : []),
    ...(target?.kind === "search" ? [["q", target.search] as const] : []),
    ...(providerUsage ? [["usage", providerUsage] as const] : []),
    ...(diagnosticLog ? [["log", "true"] as const] : []),
    ...(memory === undefined ? [] : [["memory", memory] as const]),
  ];
  const path =
    page === "Memory"
      ? "/memory"
      : page === "Skills"
        ? "/skills"
        : page === undefined
          ? target?.kind === "search"
            ? "/settings/general"
            : "/settings"
          : `/settings/${page.toLowerCase()}`;
  const query = search
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}
