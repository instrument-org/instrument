import { BrowserStartControls } from "@/client/components/window/browser-start-controls";
import { useWindow } from "@/client/components/window/context";
import { ExtensionsPage } from "@/client/components/window/extensions-page";
import { createFileRoute } from "@tanstack/react-router";

/** The extensions the in-app browser runs, as a window tab of its own, under the browser's row. */
export const Route = createFileRoute("/_app/extensions")({
  component: ExtensionsRoute,
  head: () => ({
    meta: [{ title: "Extensions" }],
  }),
});

function ExtensionsRoute() {
  const { openPage } = useWindow();
  return (
    <>
      <BrowserStartControls onOpenPage={openPage} />
      <ExtensionsPage />
    </>
  );
}
