import {
  useFileManagerApp,
  useFileOpenCandidates,
} from "@/client/hooks/use-file-open-target";
import {
  type OpenInAppTarget,
  useOpenInApp,
} from "@/client/hooks/use-open-in-app";
import { hasFilesView } from "@/client/lib/show-in-files";
import { cn, isMacOS } from "@/client/lib/utils";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { useState } from "react";

import { IconWithFallback } from "./icon-with-fallback";
import { OpenInMenu, OpenWithDropdown } from "./open-with-menu";
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
 *
 * Where other apps open the file too (macOS), a caret leads the grown pill
 * and lists them. It goes at the far end from the icon because the icon is
 * pinned to the field's end: on the icon's side it would either move the icon
 * when it arrived or need room held for it at rest.
 */
export function OpenInAppButton({
  className,
  target,
}: {
  className?: string;
  target: OpenInAppTarget;
}) {
  const app = useOpenInApp(target);
  const file = "hostPath" in target ? target : undefined;
  const { apps } = useFileOpenCandidates(file, {
    enabled: file != null && isMacOS(),
  });
  const fileManager = useFileManagerApp();
  const [isMenuOpen, setMenuOpen] = useState(false);
  // The same apps the list shows: everything but the default, and but the
  // file manager where the list has a row of its own for it.
  const isFileManager = (appPath: string) =>
    hasFilesView() && appPath === fileManager?.appPath;
  const hasOthers = apps.some(
    (candidate) => !candidate.isDefault && !isFileManager(candidate.appPath),
  );
  const defaultIsFileManager = apps.some(
    (candidate) => candidate.isDefault && isFileManager(candidate.appPath),
  );
  // Held grown while its list is open, so the caret the list hangs from stays
  // where it was pressed.
  const grown =
    "group-hover/openin:max-w-[min(15rem,45cqw)] group-hover/openin:opacity-100 group-has-focus-visible/openin:max-w-[min(15rem,45cqw)] group-has-focus-visible/openin:opacity-100 group-data-open/openin:max-w-[min(15rem,45cqw)] group-data-open/openin:opacity-100";
  return (
    <span className={cn("relative size-5.5 shrink-0", className)}>
      {app.isPending ? null : (
        <span
          className="group/openin absolute top-0 right-0 z-10 flex h-5.5 items-center rounded-full bg-card"
          data-open={isMenuOpen ? "" : undefined}
        >
          <span className="pointer-events-none absolute inset-0 rounded-full group-hover/openin:bg-foreground/8 group-has-focus-visible/openin:bg-foreground/8 group-data-open/openin:bg-foreground/8" />
          {file && hasOthers ? (
            <OpenWithDropdown
              align="start"
              file={file}
              onOpenChange={setMenuOpen}
              withFileManager={!defaultIsFileManager}
            >
              <button
                aria-label="Open with"
                className={cn(
                  "relative max-w-0 shrink-0 cursor-default overflow-hidden rounded-l-full opacity-0 transition-[max-width,opacity] duration-150 ease-out outline-none hover:bg-foreground/8 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-foreground/8",
                  grown,
                )}
                type="button"
              >
                <span className="grid h-5.5 w-5.5 place-items-center pl-0.5">
                  <CaretDownIcon className="size-3 text-muted-foreground" />
                </span>
              </button>
            </OpenWithDropdown>
          ) : null}
          <button
            aria-label={app.label}
            className="relative flex h-5.5 cursor-default items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={app.open}
            type="button"
          >
            {/* Bounded by the row rather than by the field, which it is drawn
                over: a narrow row keeps most of the path readable. */}
            <span
              className={cn(
                "relative max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 ease-out",
                grown,
              )}
            >
              <span
                className={cn(
                  "block truncate pr-1 text-xs whitespace-nowrap text-foreground",
                  file && hasOthers ? "pl-1" : "pl-2.5",
                )}
              >
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
        </span>
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
