import { PageFavicon } from "@/client/components/favicon";

/** A page tab's mark, the size a tab draws it. */
export function TabIcon({
  favicon,
  url,
}: {
  favicon: string | undefined;
  url: string | undefined;
}) {
  return <PageFavicon className="size-3.5" favicon={favicon} url={url} />;
}
