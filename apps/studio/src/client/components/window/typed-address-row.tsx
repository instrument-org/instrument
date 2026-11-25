import { targetOfAddress } from "@/client/bookmarks/address";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { PageFavicon } from "@/client/components/favicon";
import { iconHostOf } from "@/client/lib/favicon-url";
import { type TypedAddress } from "@/client/lib/typed-address";
import { GlobeIcon } from "@phosphor-icons/react/Globe";

import { AddressMark } from "./app-chip";
import { screenIdentity, type ScreenNames } from "./screen-presentation";

/**
 * What the row for a typed address calls it, in every field that offers
 * one: a page by its address as a person reads it, and one of the app's own
 * by what it opens, named as its tab would be (a chat's title, a page's
 * name).
 */
export function typedAddressName(
  address: TypedAddress,
  names: ScreenNames,
): string {
  if (address.kind === "page") {
    return address.shown;
  }
  const target = targetOfAddress(address.address);
  return target && target.kind !== "page"
    ? screenIdentity(hrefOfTarget(target), names).title
    : address.address;
}

/** What the row for a typed address says, given its name (`typedAddressName`): Return goes there. */
export function typedAddressLabel(name: string): string {
  return `Go to ${name}`;
}

/** Whether the window has been to an address's site, by the pages it knows. */
export function isKnownSite(
  url: string,
  pages: readonly { url: string }[],
): boolean {
  const host = iconHostOf(url);
  return pages.some((page) => iconHostOf(page.url) === host);
}

/**
 * The mark of a typed address's row. A site wears its own icon only once
 * the window has been there, and a globe until then: asking for the icon of
 * an address still being typed would send every host the letters spell out
 * along the way. A file's address shows the file's type and asks nobody,
 * and one of the app's own wears the mark its tab would.
 */
export function TypedAddressMark({
  address,
  className,
  isKnown,
}: {
  address: TypedAddress;
  className?: string;
  /** Whether the window has been to the site (`isKnownSite`). */
  isKnown: boolean;
}) {
  if (address.kind === "app") {
    return <AddressMark address={address.address} className={className} />;
  }
  return isKnown || /^file:/i.test(address.url) ? (
    <PageFavicon className={className} hasTooltip={false} url={address.url} />
  ) : (
    <GlobeIcon className={className} />
  );
}
