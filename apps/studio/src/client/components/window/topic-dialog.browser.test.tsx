import { renderInBrowser } from "@/tests/render-browser";
import { expect, it, vi } from "vitest";

import { TopicDialog } from "./topic-dialog";

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: { showFolderPicker: { call: vi.fn() } },
    // A folder's path names the places the computer has.
    workspace: {
      computer: {
        places: {
          queryOptions: () => ({
            queryFn: () => ({ pinned: [], volumes: [] }),
            queryKey: ["places"],
          }),
        },
      },
    },
  },
}));
// The decision model is out of reach here: no mark follows the name and no
// chats are offered for filing.
vi.mock("./emoji-set", () => ({ useEmojiSet: () => [] }));
vi.mock("./emoji-suggestions", () => ({
  useEmojiSuggestions: () => ({ suggestions: [] }),
}));
// The instructions' mic asks main whether someone is signed in.
vi.mock(import("@/client/hooks/use-dictation"), async (importOriginal) => ({
  ...(await importOriginal()),
  useDictation: (await import("@/tests/idle-dictation")).idleDictation,
}));
vi.mock(import("./use-topic-backfill"), async (importOriginal) => ({
  ...(await importOriginal()),
  useTopicBackfill: () => [],
}));
// A folder's icon asks the computer what kind of place it is.
vi.mock("@/client/components/window/folder-mark", () => ({
  FolderMark: () => null,
}));

const DEEP = `/Users/me/${"a-folder-with-a-long-name/".repeat(8)}Garden`;

it("keeps a folder with a long path inside the dialog", async () => {
  await renderInBrowser(
    <TopicDialog
      mode="edit"
      onChange={vi.fn()}
      onDelete={vi.fn()}
      onOpenChange={vi.fn()}
      open
      otherNames={[]}
      topic={{ folders: [{ path: DEEP }], id: "top_1", name: "Garden" }}
    />,
  );

  const dialog = document.querySelector("[role=dialog]");
  const row = dialog?.querySelector("ul li");
  const save = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Save",
  );
  if (!dialog || !row || !save) {
    throw new Error("the dialog did not render its folder and Save");
  }
  const edge = dialog.getBoundingClientRect().right;
  expect(row.getBoundingClientRect().right).toBeLessThan(edge);
  expect(save.getBoundingClientRect().right).toBeLessThan(edge);
});
