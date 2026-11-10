import {
  requestCapture,
  openCaptureEditor,
  useCaptures,
} from "@/client/components/captures/capture-store";
import { CapturesGrid } from "@/client/components/captures/captures-grid";
import { Popover, PopoverTrigger } from "@/client/components/ui/popover";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { SHORTCUTS } from "@/shared/shortcuts";
import { CameraIcon } from "@phosphor-icons/react/Camera";

import { useState } from "react";

import { StripHeading, StripPopover } from "./strip-popover";

/** The capture button with its shortcut, and the count of captures that opens them. */
export function StripCaptures({ cellClass }: { cellClass: string }) {
  const [open, setOpen] = useState(false);
  const captures = useCaptures();
  const { showInFileManager } = osConventions();
  const shortcut = formatAcceleratorText(SHORTCUTS.captureWindow.accelerator);
  return (
    <>
      <button
        className={`${cellClass} text-white/75 hover:text-white`}
        onClick={() => {
          requestCapture();
        }}
        aria-label="Capture the window"
        title="Capture the window"
        type="button"
      >
        <CameraIcon className="size-3.25" />
        capture
        <span className="text-white/45">{shortcut}</span>
      </button>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={`Captures, ${captures.length}`}
            className={cellClass}
            type="button"
          >
            <span className="text-white/50">captures</span>
            {captures.length}
          </button>
        </PopoverTrigger>
        <StripPopover align="end" className="w-[34rem]">
          <StripHeading
            end={
              <button
                className="hover:text-foreground"
                onClick={() => {
                  void rpcClient.captures.show.call({});
                }}
                type="button"
              >
                {showInFileManager}
              </button>
            }
          >
            captures
          </StripHeading>
          <div className="max-h-[28rem] overflow-y-auto p-3 font-sans">
            {captures.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Press {shortcut} to capture the window.
              </p>
            ) : (
              <CapturesGrid
                captures={captures}
                onPick={(capture) => {
                  setOpen(false);
                  openCaptureEditor(capture);
                }}
              />
            )}
          </div>
        </StripPopover>
      </Popover>
    </>
  );
}
