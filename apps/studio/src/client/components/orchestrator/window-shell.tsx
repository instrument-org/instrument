import {
  appPlaceAtom,
  newThreadOnArrivalAtom,
} from "@/client/atoms/orchestrator";
import { AppRail } from "@/client/components/orchestrator/app-rail";
import {
  WindowBar,
  WindowCorner,
} from "@/client/components/orchestrator/window-bar";
import { WindowFrame } from "@/client/components/orchestrator/window-frame";
import { PAGE_ROUTE } from "@/client/components/orchestrator/window-tabs";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { type ReactNode } from "react";

/**
 * The window's bar and rail around a screen that is not one of the window's
 * own (the debug pages, say), so every screen the window can land on has a
 * way back. No place is lit in the rail; choosing one, or New, goes back to
 * the window standing there.
 */
export function WindowShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const setPlace = useSetAtom(appPlaceAtom);
  const setNewOnArrival = useSetAtom(newThreadOnArrivalAtom);
  // To the address that shows nothing of its own, so the window puts up the
  // tab it stands on; any screen's address would be read as that tab
  // navigating there.
  const backToWindow = () => {
    void navigate({ to: PAGE_ROUTE });
  };
  return (
    <WindowFrame
      bar={<WindowBar tabs={null} trailing={<WindowCorner />} />}
      rail={
        <AppRail
          onChoose={(place) => {
            setPlace(place);
            backToWindow();
          }}
          onNew={() => {
            setNewOnArrival(true);
            backToWindow();
          }}
        />
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {children}
      </div>
    </WindowFrame>
  );
}
