import { arrivalViewOf } from "@/client/components/window/computer-page";
import { FilesScreen } from "@/client/components/window/files-screen";
import { settleArrival } from "@/client/components/window/files-step";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/_app/files")({
  // An address with no layout is one arriving from outside the tab. It is
  // settled here, once, into the step it stands for, so back to it shows it
  // the way it was even after the folder's own layout or the last one chosen
  // moves on.
  beforeLoad: ({ search }) => {
    if (search.view === undefined) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({
        replace: true,
        search: settleArrival(search, arrivalViewOf),
        to: "/files",
      });
    }
  },
  component: ComputerRoute,
  validateSearch: z.object({
    /** A file open in a tab beside the folder, by where it is on the computer. */
    file: z.string().optional(),
    /** The folder open under the root, as a prefix: `Documents/Instrument/`. */
    path: z.string().default(""),
    /** Where the browser is rooted: `~` for the home folder, or a folder's own path. */
    /**
     * What the folder is searched for in this step of the tab's history,
     * kept as it is typed, so back to the step finds the folder searched as
     * it was left.
     */
    query: z.string().optional().catch(undefined),
    root: z.string().default("~"),
    /**
     * What the folder opens with selected, as a path under the root:
     * `report.pdf`. Kept as the selection moves, so back to a folder finds
     * selected what was opened from it. An address written without quoting a name the router
     * reads as JSON (`2024`, `true`) arrives as that value and is read back
     * as the name; anything else it cannot be selects nothing.
     */
    select: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .transform(String)
      .optional()
      .catch(undefined),
    /** A page's file shown as its text rather than as the page: view source. */
    source: z.boolean().optional().catch(undefined),
    /** The folder a file tab's own tree is rooted at: where the Finder stood when the file was opened. */
    tree: z.string().optional(),
    /**
     * The layout this step of the tab's history shows the folder in, so back
     * and forward show each folder the way it looked. Absent on an address
     * that arrives at a folder directly (a place, a new tab, a typed path),
     * which `beforeLoad` settles. A layout this build does not know, from an
     * old bookmark or a typed address, reads as absent rather than failing
     * the route.
     */
    view: z
      .enum(["columns", "gallery", "icons", "list", "table"])
      .optional()
      .catch(undefined),
  }),
});

function ComputerRoute() {
  // Settled already by `beforeLoad`; read again so the step is typed as one.
  return <FilesScreen step={settleArrival(Route.useSearch(), arrivalViewOf)} />;
}
