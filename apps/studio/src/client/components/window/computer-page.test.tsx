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
const { fileActionFailed } = await import("./computer-page");

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
