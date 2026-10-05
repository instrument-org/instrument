import { devToolsPanelAtom } from "@/client/atoms/dev-tools";
import { Sheet, SheetContent, SheetTitle } from "@/client/components/ui/sheet";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useAtom } from "jotai";

export function DevTools() {
  const [activePanel, setActivePanel] = useAtom(devToolsPanelAtom);

  return (
    <>
      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            setActivePanel(null);
          }
        }}
        open={activePanel === "router-devtools"}
      >
        <SheetContent className="h-1/2 p-0" side="bottom">
          <SheetTitle className="sr-only">React Router Devtools</SheetTitle>
          <div className="h-full overflow-hidden text-xs">
            <TanStackRouterDevtoolsPanel
              className="h-full"
              setIsOpen={(open) => {
                if (!open) {
                  setActivePanel(null);
                }
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            setActivePanel(null);
          }
        }}
        open={activePanel === "query-devtools"}
      >
        <SheetContent className="h-1/2 p-0" side="bottom">
          <SheetTitle className="sr-only">React Query Devtools</SheetTitle>
          <div className="h-full overflow-hidden text-xs">
            <ReactQueryDevtoolsPanel
              onClose={() => {
                setActivePanel(null);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
