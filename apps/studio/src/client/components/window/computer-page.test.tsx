import { ORPCError } from "@orpc/client";
import type { ExternalToast } from "sonner";
import { expect, it, vi } from "vitest";

const shown: { title: unknown; data: ExternalToast | undefined }[] = [];
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: Object.assign(vi.fn(), {
    error: (title: unknown, data?: ExternalToast) => {
      shown.push({ data, title });
      return 1;
    },
  }),
}));

const { setToastDeveloperMode } = await import("@/client/lib/toast");
const { fileActionFailed, rowPress } = await import("./computer-page");
const { listingCommandOf } = await import("../extend/file-system-keys");

// With Quick Look up, the arrows are handed to the listing's selected row.
it.each([
  { held: "metaKey", os: "mac" },
  { held: "altKey", os: "windows" },
  { held: "altKey", os: "linux" },
] as const)(
  "keeps $held on ↑ handed on from Quick Look, so it goes up a folder on $os",
  ({ held, os }) => {
    const press = new KeyboardEvent("keydown", {
      [held]: true,
      key: "ArrowUp",
    });
    expect(listingCommandOf(rowPress(press), os)).toEqual({ type: "parent" });
  },
);

// Without Full Disk Access the app cannot find what it moved to the Trash, so
// the move is journaled with nowhere to put it back from, and ⌘Z refuses it.
it("says why ⌘Z cannot put something back, outside developer mode", () => {
  setToastDeveloperMode(false);
  fileActionFailed(
    "Couldn't undo that",
    new ORPCError("CANNOT_UNDO", {
      message: "Put “notes.txt” back from the Trash in the Finder.",
    }),
  );
  expect(shown).toEqual([
    {
      data: expect.objectContaining({
        description: "Put “notes.txt” back from the Trash in the Finder.",
      }),
      title: "Couldn't undo that",
    },
  ]);
});
