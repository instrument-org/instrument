import { z } from "zod";

import { normalizeTaskFilePath } from "../lib/normalize-task-file-path";
import { isAddressableTaskFilePath } from "../lib/task-file-path";

/**
 * What the task's right-hand pane is showing.
 *
 * It lives beside the task rather than in the URL because both the user and the
 * agent write it. `show` is therefore a state mutation rather than an event,
 * which is what makes it need no delivery, no replay suppression, and no
 * restore path: the renderer reconciles to whatever it reads, and reopening a
 * task is a read.
 */
export namespace TaskPane {
  const FilePathSchema = z
    .string()
    .transform(normalizeTaskFilePath)
    .refine(
      isAddressableTaskFilePath,
      "Path is outside the task and its mounts",
    );

  export const TabSchema = z.discriminatedUnion("type", [
    z.object({ filePath: FilePathSchema, type: z.literal("file") }),
    // The agent browser. There is one target per session, derived from the task
    // and the selected session, so the tab carries nothing.
    z.object({ type: z.literal("browser") }),
  ]);

  export type Tab = z.output<typeof TabSchema>;

  // Element-wise rather than a plain array, so one tab this build cannot read
  // costs that tab instead of the whole pane. The state file is also the task's
  // folder list, and a parse failure here is answered with empty state that the
  // next write persists over.
  const TabsSchema = z.array(z.unknown()).transform((tabs) =>
    tabs.flatMap((tab) => {
      const parsed = TabSchema.safeParse(tab);
      return parsed.success ? [parsed.data] : [];
    }),
  );

  export const Schema = z.object({
    open: z.boolean().default(false),
    // A key rather than an index, so closing and reordering renumber nothing.
    selected: z.string().optional(),
    tabs: TabsSchema.default(() => []),
  });

  export type Type = z.output<typeof Schema>;

  export const EMPTY: Type = { open: false, tabs: [] };

  /**
   * Close one tab, focusing its neighbor.
   *
   * Closing the last one leaves the pane open rather than dismissing it: the
   * browser is a fixed tab the pane always draws, so there is something to fall
   * back to, and closing a file is not a request to close the panel.
   */
  export function closeTab(pane: Type, key: string): Type {
    const index = pane.tabs.findIndex((tab) => tabKey(tab) === key);
    if (index === -1) {
      return pane;
    }

    const tabs = pane.tabs.filter((_, i) => i !== index);
    const wasSelected = pane.selected === key;
    const neighbor = tabs[Math.min(index, tabs.length - 1)];

    return {
      open: pane.open,
      selected:
        wasSelected && neighbor ? tabKey(neighbor) : (pane.selected ?? ""),
      tabs,
    };
  }

  export function fileTab(filePath: string): Tab {
    return { filePath: normalizeTaskFilePath(filePath), type: "file" };
  }

  /**
   * Append tabs and focus the last one, opening the pane.
   *
   * Already open means focus rather than duplicate, which is what makes `show`
   * idempotent from the agent's side and what keeps clicking the same file
   * reference twice from growing the strip.
   *
   * Only files are stored. The browser is a fixed tab the pane always draws, so
   * opening it is a selection and never an insertion -- which is also what lets
   * the stored order be reordered freely, with nothing in it that has to stay
   * where it is.
   */
  export function openTabs(pane: Type, opening: Tab[]): Type {
    const last = opening.at(-1);
    if (!last) {
      return pane;
    }

    const existing = new Set(pane.tabs.map((tab) => tabKey(tab)));
    const added = opening.filter((tab) => {
      const key = tabKey(tab);
      if (tab.type !== "file" || existing.has(key)) {
        return false;
      }
      existing.add(key);
      return true;
    });

    return {
      open: true,
      selected: tabKey(last),
      tabs: [...pane.tabs, ...added],
    };
  }

  /**
   * Put the stored tabs in a new order, named by key.
   *
   * Anything the caller does not name keeps its place at the end, so an order
   * computed against a stale view drops nothing.
   */
  export function reorderTabs(pane: Type, keys: string[]): Type {
    const remaining = new Map(pane.tabs.map((tab) => [tabKey(tab), tab]));
    const ordered = keys.flatMap((key) => {
      const tab = remaining.get(key);
      if (!tab) {
        return [];
      }
      remaining.delete(key);
      return [tab];
    });

    return { ...pane, tabs: [...ordered, ...remaining.values()] };
  }

  /**
   * The tab `selected` names, or the last one when it names nothing that is
   * open. A stored selection outliving its tab is normal rather than corrupt:
   * closing the focused tab leaves one behind for a moment, and a task exported
   * with a file open can be imported where that file is gone.
   */
  export function selectedTab(pane: Type): Tab | undefined {
    const match = pane.tabs.find((tab) => tabKey(tab) === pane.selected);
    return match ?? pane.tabs.at(-1);
  }

  export function selectTab(pane: Type, key: string): Type {
    return { ...pane, open: true, selected: key };
  }

  /** A tab's stable identity, used for `selected` and for dedupe. */
  export function tabKey(tab: Tab): string {
    return tab.type === "file" ? `file:${tab.filePath}` : "browser";
  }

  /**
   * What the user did, rather than what the pane should become.
   *
   * The distinction is the whole point. A client that computes the next pane
   * from the one it last saw and sends that snapshot will erase anything that
   * landed in between -- and something does land in between, because `show`
   * writes this same field from the agent's turn. Sending the intent instead
   * lets the server replay it against whatever is current, inside the same
   * write queue `show` uses, so the two interleave instead of racing.
   */
  export const OperationSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("close") }),
    z.object({ type: z.literal("toggle") }),
    z.object({ key: z.string(), type: z.literal("closeTab") }),
    z.object({ key: z.string(), type: z.literal("selectTab") }),
    z.object({ keys: z.array(z.string()), type: z.literal("reorderTabs") }),
    z.object({
      filePaths: z.array(FilePathSchema),
      type: z.literal("openFiles"),
    }),
  ]);

  export type Operation = z.output<typeof OperationSchema>;

  export function applyOperation(pane: Type, operation: Operation): Type {
    switch (operation.type) {
      case "close": {
        return { ...pane, open: false };
      }
      case "closeTab": {
        return closeTab(pane, operation.key);
      }
      case "openFiles": {
        return openTabs(pane, operation.filePaths.map(fileTab));
      }
      case "reorderTabs": {
        return reorderTabs(pane, operation.keys);
      }
      case "selectTab": {
        return selectTab(pane, operation.key);
      }
      case "toggle": {
        return { ...pane, open: !pane.open };
      }
    }
  }
}
