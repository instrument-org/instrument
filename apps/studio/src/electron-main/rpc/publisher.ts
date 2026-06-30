import { type AppUpdaterStatus } from "@/electron-main/lib/update";
import { type TabState } from "@/shared/tabs";
import { EventPublisher } from "@orpc/server";

interface PublisherEvents {
  // Fired whenever the set of agent-browser targets (entries) changes, so the
  // renderer pool can reconcile its `<webview>` guests to the desired set.
  "agent-browser.targets-changed": null;
  "app.reload": { webContentsId: number };
  "app.toggle-command-menu": { webContentsId: number };
  "auth.login-error": {
    error: {
      code?: string | undefined;
      message?: string | undefined;
      status: number;
      statusText: string;
    };
  };
  "auth.login-success": {
    success: true;
  };
  "debug.browser-view-manager.updated": null;
  "features.updated": null;
  "preferences.updated": null;
  "provider-config.updated": null;
  "server-exception": {
    message: string;
    stack?: string;
  };
  "server-exceptions.updated": null;
  "session.apiBearerToken.updated": null;
  "sidebar.updated": {
    isOpen: boolean;
    width: number;
  };
  "studio-overlay.active-changed": { isActive: boolean };
  "tabs.updated": null | TabState;
  "test-notification": null;
  "updates.status": { status: AppUpdaterStatus };
  "updates.trigger-check": null;
  "window.focus-changed": null;
}

export const publisher = new EventPublisher<PublisherEvents>({
  maxBufferedEvents: 1, // Keep no history as we only need to know the latest state
});
