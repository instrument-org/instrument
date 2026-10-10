import { FilesScreen } from "@/client/components/window/files-screen";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/_app/files")({
  component: ComputerRoute,
  validateSearch: z.object({
    /** A file open in a tab beside the folder, by where it is on the computer. */
    file: z.string().optional(),
    /** The folder open under the root, as a prefix: `Documents/Instrument/`. */
    path: z.string().default(""),
    /** Where the browser is rooted: `~` for the home folder, or a folder's own path. */
    root: z.string().default("~"),
    /** What the folder opens with selected, as a path under the root: `report.pdf`. */
    select: z.string().optional(),
    /** A page's file shown as its text rather than as the page: view source. */
    source: z.boolean().optional(),
    /** The folder a file tab's own tree is rooted at: where the Finder stood when the file was opened. */
    tree: z.string().optional(),
    /**
     * The layout this step of the tab's history shows the folder in, so back
     * and forward show each folder the way it looked. Absent on an address
     * that arrives at a folder directly (a place, a new tab, a typed path),
     * which opens in the folder's own layout and is then written here.
     */
    view: z.enum(["columns", "gallery", "icons", "list"]).optional(),
  }),
});

function ComputerRoute() {
  const { file, path, root, select, source, tree, view } = Route.useSearch();
  return (
    <FilesScreen
      file={file}
      path={path}
      root={root}
      select={select}
      source={source ?? false}
      tree={tree}
      view={view}
    />
  );
}
