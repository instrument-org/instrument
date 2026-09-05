import { ComputerPage } from "@/client/components/orchestrator/computer-page";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/orchestrator/computer")({
  component: ComputerRoute,
  validateSearch: z.object({
    /**
     * The folder open under This Mac, as a prefix whose first segment is a
     * place or a volume: `Documents/Instrument/`.
     */
    path: z.string().default(""),
  }),
});

function ComputerRoute() {
  const { path } = Route.useSearch();
  return <ComputerPage path={path} />;
}
