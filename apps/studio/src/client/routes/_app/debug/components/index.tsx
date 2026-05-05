import { createFileRoute, redirect } from "@tanstack/react-router";

import { presetSessions } from "../-sessions";

export const Route = createFileRoute("/_app/debug/components/")({
  beforeLoad: () => {
    const defaultSessionId = presetSessions[0]?.id;

    throw redirect({
      search: defaultSessionId ? { session: defaultSessionId } : undefined,
      to: "/debug/components/session-stream",
    });
  },
});
