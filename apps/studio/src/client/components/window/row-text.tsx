import { targetOfAddress } from "@/client/bookmarks/address";
import { type ReactNode } from "react";

import { folderNameOf, siteOf } from "./omnibar-match";

/**
 * A result row's words, the same in the address field's list and the command
 * menu: the name, cut short first, then one muted word for where it lives.
 */
export function RowText({
  name,
  where,
}: {
  name: ReactNode;
  where?: string | undefined;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 truncate">{name}</span>
      {where ? (
        <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
          {where}
        </span>
      ) : null}
    </span>
  );
}

/** Where what an address names lives, as a row says it: a page's site, or the folder a file or a folder is in. */
export function whereOfAddress(address: string): string | undefined {
  const target = targetOfAddress(address);
  return target?.kind === "page"
    ? siteOf(target.url)
    : target?.kind === "path"
      ? folderNameOf(target.path)
      : undefined;
}
