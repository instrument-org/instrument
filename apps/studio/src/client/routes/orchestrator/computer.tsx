import { ComputerPage } from "@/client/components/orchestrator/computer-page";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/orchestrator/computer")({
  component: ComputerRoute,
  validateSearch: z.object({
    /** The folder open under the root, as a prefix: `Documents/Instrument/`. */
    path: z.string().default(""),
    /**
     * Where the browser is rooted: `~` for the home folder, `instrument` for
     * the folder Instrument keeps its outcomes in, or a folder's own path.
     */
    root: z.string().default("~"),
  }),
});

function ComputerRoute() {
  const { path, root } = Route.useSearch();
  return <ComputerPage path={path} root={root} />;
}
