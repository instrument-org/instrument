import { cn } from "@/client/lib/utils";

/**
 * A mark's ink, the parts drawn in the page's text color rather than a brand
 * color: `currentColor`, and the white some colored marks hard-code for a
 * dark tile they assume (Kimi's K). Both follow the theme once inlined, which
 * an `<img>` cannot do, since it neither inherits a color nor knows the ground.
 */
const INK = /fill="(?:currentColor|#fff|#FFF|#ffffff|#FFFFFF)"/g;

const prepared = new Map<string, string>();
function markup(svg: string, ink: boolean): string {
  const key = `${ink ? "1" : "0"}${svg}`;
  let result = prepared.get(key);
  if (result === undefined) {
    result = (ink ? svg.replace(INK, 'fill="currentColor"') : svg)
      .replace(/ (?:width|height)="1em"/g, "")
      .replace(/ style="[^"]*"/, "")
      // The text beside the mark names it; a title would say it twice.
      .replace(/<title>[^<]*<\/title>/, "");
    prepared.set(key, result);
  }
  return result;
}

/**
 * Another company's mark from a pinned icon package's SVG, inlined so its ink follows
 * the theme: it takes the text color it sits in, like any icon. `ink: false` keeps a white the mark draws on purpose, such as a
 * tile it sits on, rather than turning it into the text color.
 */
export function VendorMark({
  className = "size-4",
  ink = true,
  svg,
}: {
  className?: string;
  ink?: boolean;
  svg: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 [&>svg]:size-full", className)}
      // Markup from a pinned package's own SVG files, not from anything a
      // user or a provider supplies.
      dangerouslySetInnerHTML={{ __html: markup(svg, ink) }}
    />
  );
}
