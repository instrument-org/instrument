import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  ZoomLevelMenu,
  ZoomStepperControl,
} from "@/client/components/zoom-controls";
import { openPageFind } from "@/client/hooks/use-browser-find";
import { getGuest } from "@/client/lib/browser-pool";
import {
  EMULATED_DEVICES,
  emulatedDevicesAtom,
} from "@/client/lib/emulated-devices";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { BROWSER_ZOOM_MAX, BROWSER_ZOOM_MIN } from "@/shared/browser";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { steppedZoom } from "@/shared/zoom";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { DeviceMobileIcon } from "@phosphor-icons/react/DeviceMobile";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PrinterIcon } from "@phosphor-icons/react/Printer";
import { TerminalWindowIcon } from "@phosphor-icons/react/TerminalWindow";
import { useAtom } from "jotai";
import { omit } from "radashi";
import { useState } from "react";

/** The page's zoom as a row of its menu: a stepper, and the level as a menu of its own. */
export function PageZoomRow({
  onZoom,
  zoom,
}: {
  onZoom: (factor: number) => void;
  zoom: number;
}) {
  const step = (direction: "in" | "out") => {
    onZoom(
      steppedZoom({
        direction,
        factor: zoom,
        max: BROWSER_ZOOM_MAX,
        min: BROWSER_ZOOM_MIN,
      }),
    );
  };
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm">Zoom</span>
      <ZoomStepperControl
        canZoomIn={zoom < BROWSER_ZOOM_MAX}
        canZoomOut={zoom > BROWSER_ZOOM_MIN}
        onZoomIn={() => {
          step("in");
        }}
        onZoomOut={() => {
          step("out");
        }}
        readout={
          <ZoomLevelMenu
            max={BROWSER_ZOOM_MAX}
            min={BROWSER_ZOOM_MIN}
            nested
            onSelect={onZoom}
            zoom={zoom}
          />
        }
      />
    </div>
  );
}

/** View as, the device sizes a page can be laid out at, as a submenu. */
export function PageViewAsMenu({
  disabled,
  targetId,
}: {
  disabled: boolean;
  targetId: BrowserTargetId;
}) {
  const [devices, setDevices] = useAtom(emulatedDevicesAtom);
  const device = devices[targetId];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <DeviceMobileIcon className="size-4" />
        View as
        {device && (
          <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
            {device.label}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            const chosen = EMULATED_DEVICES.find((each) => each.id === value);
            setDevices((current) => {
              const rest = omit(current, [targetId]);
              return chosen ? { ...rest, [targetId]: chosen } : rest;
            });
          }}
          value={device?.id ?? "actual-size"}
        >
          <DropdownMenuRadioItem value="actual-size">
            Actual size
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {EMULATED_DEVICES.map((each) => (
            <DropdownMenuRadioItem key={each.id} value={each.id}>
              {each.label}
              <span className="ml-auto text-xs text-muted-foreground">
                {each.width}×{each.height}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * What a page's own menu offers that a file's has no word for, for the menu
 * of a page's file drawn as its page: its zoom, Print, Find in page, View as,
 * Hard reload and Developer tools. Mounted while the menu is open.
 */
export function PageMenuItems({ targetId }: { targetId: BrowserTargetId }) {
  const guest = getGuest(targetId);
  const [zoom, setZoom] = useState(() => guest?.zoom() ?? 1);
  const disabled = !guest;
  return (
    <>
      {guest && (
        <PageZoomRow
          onZoom={(factor) => {
            guest.setZoom(factor);
            setZoom(factor);
          }}
          zoom={zoom}
        />
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => {
          getGuest(targetId)?.print();
        }}
      >
        <PrinterIcon className="size-4" />
        Print…
        <DropdownMenuShortcut>
          {formatAcceleratorText(WINDOW_SHORTCUTS.printPage.accelerator)}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => {
          openPageFind(targetId);
        }}
      >
        <MagnifyingGlassIcon className="size-4" />
        Find in page
        <DropdownMenuShortcut>
          {formatAcceleratorText(WINDOW_SHORTCUTS.findInPage.accelerator)}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <PageViewAsMenu disabled={disabled} targetId={targetId} />
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => {
          getGuest(targetId)?.reload({ ignoreCache: true });
        }}
      >
        <ArrowCounterClockwiseIcon className="size-4" />
        Hard reload
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => {
          getGuest(targetId)?.openDevTools();
        }}
      >
        <TerminalWindowIcon className="size-4" />
        Developer tools
      </DropdownMenuItem>
    </>
  );
}
