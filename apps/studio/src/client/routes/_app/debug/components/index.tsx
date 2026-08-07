import { createFileRoute, redirect } from "@tanstack/react-router";

import { scenarios } from "../-playback/scenarios";

export const Route = createFileRoute("/_app/debug/components/")({
  beforeLoad: () => {
    const defaultScenarioId = scenarios[0]?.id;

    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      search: defaultScenarioId ? { scenario: defaultScenarioId } : undefined,
      to: "/debug/components/playback",
    });
  },
});
