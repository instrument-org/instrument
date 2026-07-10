import { type AppUpdaterStatus } from "@/electron-main/lib/update";
import { type AppCommand } from "@/shared/app-command";
import { EventPublisher } from "@orpc/server";

interface PublisherEvents {
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
  // Fired whenever the set of browser targets (entries) changes, so the
  // renderer pool can reconcile its `<webview>` guests to the desired set.
  "browser.targets-changed": null;
  "connectors.updated": null;
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
  "test-notification": null;
  "updates.status": { status: AppUpdaterStatus };
  "updates.trigger-check": null;
  "window.focus-changed": null;
  "window.maximized-changed": null;
}

export const publisher = new EventPublisher<PublisherEvents>({
  maxBufferedEvents: 1, // Keep no history as we only need to know the latest state
});

interface CommandEvents {
  // Imperative app commands from the main process (menus, onboarding) to the
  // renderer that owns tab and view state (MainWindow).
  "app.command": AppCommand;
}

// Buffer a small burst of commands per subscriber. The buffer is per
// subscription and starts empty at subscribe time, so a reconnecting renderer
// can never replay commands from before it subscribed; the only real hazard is
// dropping a command published while the previous one's send is in flight
// (e.g. key-repeat Cmd+Plus), which a positive buffer preserves in order.
export const commandPublisher = new EventPublisher<CommandEvents>({
  maxBufferedEvents: 32,
});
