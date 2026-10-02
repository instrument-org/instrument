import {
  type OpenInAppTarget,
  useOpenInApp,
} from "@/client/hooks/use-open-in-app";
import { cn, isMacOS } from "@/client/lib/utils";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";

import { IconWithFallback } from "./icon-with-fallback";
import { OpenInMenu } from "./open-with-menu";
import { type MenuComponents } from "./ui/menu-components";

/**
 * The app a file or page opens in outside Instrument, as its icon at the end
 * of the address field: it says what the thing is by the app people know it
 * from, and a press opens it there.
 *
 * The icon's box never changes size or moves. Pointed at or focused, the
 * button grows leftward over the field's tail to say where it opens, and all
 * of it opens, so a quick press on the icon lands before the words arrive.
 * While the app is still being looked up the box is held empty, so the field
 * never shifts and nothing flashes in.
 */
export function OpenInAppButton({
  className,
  target,
}: {
  className?: string;
  target: OpenInAppTarget;
}) {
  const app = useOpenInApp(target);
  return (
    <span className={cn("relative size-5.5 shrink-0", className)}>
      {app.isPending ? null : (
        <button
          aria-label={app.label}
          className="group/openin absolute top-0 right-0 z-10 flex h-5.5 cursor-default items-center rounded-full bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={app.open}
          type="button"
        >
          <span className="pointer-events-none absolute inset-0 rounded-full group-hover/openin:bg-foreground/8 group-focus-visible/openin:bg-foreground/8" />
          {/* Bounded by the row rather than by the field, which it is drawn
              over: a narrow row keeps most of the path readable. */}
          <span className="relative max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 ease-out group-hover/openin:max-w-[min(15rem,45cqw)] group-hover/openin:opacity-100 group-focus-visible/openin:max-w-[min(15rem,45cqw)] group-focus-visible/openin:opacity-100">
            <span className="block truncate pr-1 pl-2.5 text-xs whitespace-nowrap text-foreground">
              {app.label}
            </span>
          </span>
          <span className="relative grid size-5.5 shrink-0 place-items-center">
            <IconWithFallback
              className="size-3.5"
              fallback={
                <ArrowSquareOutIcon className="size-3.5 text-muted-foreground group-hover/openin:text-foreground" />
              }
              src={app.iconUrl}
            />
          </span>
        </button>
      )}
    </span>
  );
}

/**
 * The same way out, in a menu. Where the system can list every app that
 * takes a file (macOS), that is one "Open in" submenu with the default app
 * first; elsewhere, and for a site, there is nothing to choose between, so it
 * is one row naming the app. `defaultRow` is for a file Studio cannot show at
 * all, where opening it elsewhere is the point: the default gets a row of its
 * own and the submenu lists the others.
 */
export function OpenInAppMenuItems({
  defaultRow = false,
  menuComponents,
  target,
}: {
  defaultRow?: boolean;
  menuComponents: MenuComponents;
  target: OpenInAppTarget;
}) {
  const { Item } = menuComponents;
  const app = useOpenInApp(target);
  const row = (
    <Item onClick={app.open}>
      <IconWithFallback
        className="size-4"
        fallback={<ArrowSquareOutIcon className="size-4" />}
        src={app.iconUrl}
      />
      <span>{app.label}</span>
    </Item>
  );
  if (!("hostPath" in target) || !isMacOS()) {
    return row;
  }
  return defaultRow ? (
    <>
      {row}
      <OpenInMenu
        file={target}
        menuComponents={menuComponents}
        onlyAlternatives
      />
    </>
  ) : (
    <OpenInMenu file={target} menuComponents={menuComponents} />
  );
}
