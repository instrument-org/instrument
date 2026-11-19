import { ContactErrorAlert } from "@/client/components/contact-error-alert";
import { toast } from "@/client/lib/toast";

import { DebugState } from "../-shell";

export function Alerts() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
      <p className="text-sm text-muted-foreground">
        Alerts that only show up when something goes wrong with an account,
        which is hard to set up in a real session.
      </p>
      <DebugState className="flex flex-col gap-3" id="contact-error-retry">
        <div>
          <h2 className="text-sm font-medium">Contact error alert</h2>
          <p className="text-xs text-muted-foreground">
            Settings shows this under your account when it can&apos;t reach the
            server to load it.
          </p>
        </div>
        <ContactErrorAlert
          onRetry={() => toast.info("onRetry")}
          title="Connection error"
        >
          Could not connect to the workspace server.
        </ContactErrorAlert>
      </DebugState>
    </div>
  );
}
