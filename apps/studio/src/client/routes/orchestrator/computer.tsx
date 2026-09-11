import { FilesScreen } from "@/client/components/orchestrator/files-screen";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/orchestrator/computer")({
  component: ComputerRoute,
  validateSearch: z.object({
    /** A file open in a tab beside the folder, by where it is on the computer. */
    file: z.string().optional(),
    /** The folder open under the root, as a prefix: `Documents/Instrument/`. */
    path: z.string().default(""),
    /** Where the browser is rooted: `~` for the home folder, or a folder's own path. */
    root: z.string().default("~"),
  }),
});

function ComputerRoute() {
  const { file, path, root } = Route.useSearch();
  return <FilesScreen file={file} path={path} root={root} />;
}
