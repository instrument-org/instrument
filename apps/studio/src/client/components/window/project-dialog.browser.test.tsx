import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { ProjectDialog } from "./project-dialog";

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
      storage: {
        location: {
          queryOptions: () => ({
            queryFn: () => ({ rootDir: "/Users/me/Instrument" }),
            queryKey: ["storage-location"],
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
vi.mock("@/client/hooks/use-billing-status", () => ({
  useBillingStatus: () => ({ isSignedOut: false }),
}));
vi.mock(import("./use-project-backfill"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjectBackfill: () => [],
}));
// A folder's icon asks the computer what kind of place it is.
vi.mock("@/client/components/window/folder-mark", () => ({
  FolderMark: () => null,
}));

const DEEP = `/Users/me/${"a-folder-with-a-long-name/".repeat(8)}Garden`;

function nameField() {
  const field = document.querySelector<HTMLInputElement>(
    "[placeholder='Name it']",
  );
  if (!field) {
    throw new Error("the dialog did not render its name field");
  }
  return field;
}

/** The dialog as the window holds it: the project it makes joins the names in use as it closes. */
function MakingAProject({ onMade }: { onMade?: () => void }) {
  const [open, setOpen] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  return (
    <ProjectDialog
      mode="create"
      onCreate={(project) => {
        onMade?.();
        setNames([project.name]);
      }}
      onOpenChange={setOpen}
      open={open}
      otherNames={names}
    />
  );
}

it("never calls a project it just made a name in use as it closes", async () => {
  await renderInBrowser(<MakingAProject />);
  await userEvent.fill(nameField(), "Kitchen remodel");
  const create = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Create",
  );
  if (!create) {
    throw new Error("the dialog did not render Create");
  }
  // Whatever was put on screen from the press until the dialog has gone,
  // its closing animation included.
  const shown: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        shown.push(node.textContent ?? "");
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await userEvent.click(create);
  await expect.poll(() => document.querySelector("[role=dialog]")).toBeNull();
  observer.disconnect();

  expect(shown.filter((text) => text.includes("already a project"))).toEqual(
    [],
  );
});

it("makes a project once when Enter is pressed again as it closes", async () => {
  const made = vi.fn();
  await renderInBrowser(<MakingAProject onMade={made} />);
  await userEvent.fill(nameField(), "Kitchen remodel");
  await userEvent.keyboard("{Enter}{Enter}");
  await expect.poll(() => document.querySelector("[role=dialog]")).toBeNull();

  expect(made).toHaveBeenCalledOnce();
});

it("keeps a folder with a long path inside the dialog", async () => {
  await renderInBrowser(
    <ProjectDialog
      mode="edit"
      onChange={vi.fn()}
      onDelete={vi.fn()}
      onOpenChange={vi.fn()}
      open
      otherNames={[]}
      project={{ folders: [{ path: DEEP }], id: "top_1", name: "Garden" }}
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

/** A project being changed, with what its Save hands back and whether it closed. */
async function editingInstructions() {
  const onChange = vi.fn();
  const onOpenChange = vi.fn();
  await renderInBrowser(
    <ProjectDialog
      mode="edit"
      onChange={onChange}
      onDelete={vi.fn()}
      onOpenChange={onOpenChange}
      open
      otherNames={[]}
      project={{
        color: "#3b6ef6",
        id: "top_1",
        instructions: "Answer in metric.",
        name: "Garden",
      }}
    />,
  );
  const find = () =>
    document.querySelector<HTMLElement>(
      "[role=dialog] .ProseMirror[aria-label='Instructions']",
    );
  await expect.poll(find).toBeTruthy();
  const editor = find();
  if (!editor) {
    throw new Error("the dialog did not render the instructions editor");
  }
  return { editor, onChange, onOpenChange };
}

function dialogButton(label: string) {
  const found = [...document.querySelectorAll("[role=dialog] button")].find(
    (each) => each.textContent === label,
  );
  if (!(found instanceof HTMLElement)) {
    throw new Error(`the dialog did not render ${label}`);
  }
  return found;
}

it("draws a heading as it is typed and saves the instructions as Markdown", async () => {
  const { editor, onChange } = await editingInstructions();
  await userEvent.click(editor);
  // To the end of the text, by whichever system's chord does it.
  await userEvent.keyboard(
    "{Control>}{End}{/Control}{Meta>}{ArrowDown}{/Meta}",
  );
  await userEvent.keyboard("{Enter}# Units{Enter}Grams, not ounces.");

  await expect
    .poll(() => editor.querySelector("h1")?.textContent)
    .toBe("Units");
  await userEvent.click(dialogButton("Save"));

  expect(onChange).toHaveBeenCalledWith({
    instructions: expect.stringMatching(
      /^Answer in metric\.\n\n# Units\n\nGrams, not ounces\.\n?$/,
    ),
  });
});

it("throws the instructions' edits away on Cancel", async () => {
  const { editor, onChange, onOpenChange } = await editingInstructions();
  await userEvent.click(editor);
  await userEvent.keyboard(" Always.");
  await userEvent.click(dialogButton("Cancel"));

  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps the instructions as written when Save follows no edit", async () => {
  const { onChange } = await editingInstructions();
  await userEvent.click(dialogButton("Save"));

  expect(onChange).toHaveBeenCalledWith({});
});
