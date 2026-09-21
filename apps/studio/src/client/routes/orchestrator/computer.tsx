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
    /** A page's file shown as its text rather than as the page: view source. */
    source: z.boolean().optional(),
    /** The folder a file tab's own tree is rooted at: where the Finder stood when the file was opened. */
    tree: z.string().optional(),
  }),
});

function ComputerRoute() {
  const { file, path, root, source, tree } = Route.useSearch();
  return (
    <FilesScreen
      file={file}
      path={path}
      root={root}
      source={source ?? false}
      tree={tree}
    />
  );
}
