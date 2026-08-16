import { Toaster } from "@/client/components/ui/sonner";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/overlay")({
  component: OverlayRoute,
});

// No sidebar, no tab strip, no chrome of any kind: the panel is the window.
function OverlayRoute() {
  // The window is transparent so the panel can round its own corners, and
  // anything painting a background behind it fills those corners back in as
  // squares. The document itself is the last thing that does, and it is styled
  // for the app rather than for this, so it gets cleared here.
  useEffect(() => {
    const { body, documentElement } = document;
    documentElement.style.background = "transparent";
    body.style.background = "transparent";
    return () => {
      documentElement.style.background = "";
      body.style.background = "";
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <Outlet />
      <Toaster position="top-center" />
    </div>
  );
}
