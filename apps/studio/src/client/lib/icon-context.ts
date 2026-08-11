import { type IconProps } from "@phosphor-icons/react";

/**
 * What every Phosphor icon in the app is rendered with.
 *
 * `aria-hidden` is the part worth explaining. Phosphor renders a bare `<svg>`,
 * which the accessibility tree exposes as an unnamed `img` node beside whatever
 * it decorates -- once per icon, and there are hundreds. Almost none of them
 * carry meaning on their own: the control they sit in is what gets named, and
 * an icon repeating that name only says it twice. So they are hidden by
 * default, the way other icon sets ship, and an icon that really is the only
 * thing conveying something overrides it at the call site.
 *
 * It lives here rather than in a root because there are three of them -- both
 * window roots and the browser tests' render helper -- and an icon set that is
 * decorative in one of them and not in another is a difference nobody would go
 * looking for.
 */
export const ICON_CONTEXT_VALUE: IconProps = {
  "aria-hidden": true,
  weight: "bold",
};
