import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDialog } from "./project-dialog";

const { showFolderPicker, showProjectInFiles } = vi.hoisted(() => ({
  showFolderPicker: vi.fn<() => Promise<{ path: string } | null>>(),
  showProjectInFiles: vi.fn<(project: { name: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: { showFolderPicker: { call: showFolderPicker } },
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
vi.mock(import("@/client/lib/show-in-files"), async (importOriginal) => ({
  ...(await importOriginal()),
  showProjectInFiles,
}));
// The Markdown editor needs a real browser (the browser test drives it); a
// plain field stands in for it here.
vi.mock("@/client/components/markdown-editor/markdown-value-editor", () => ({
  MarkdownValueEditor: ({
    label,
    onChange,
    value,
  }: {
    label: string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label={label}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      value={value}
    />
  ),
}));
// The decision model is out of reach here: no mark follows the name and no
// chats are offered for filing.
vi.mock("./emoji-set", () => ({ useEmojiSet: () => [] }));
// A folder's icon asks the computer what kind of place it is.
vi.mock("@/client/components/window/folder-mark", () => ({
  FolderMark: () => null,
}));
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

const GARDEN = "/Users/me/Garden";

beforeEach(() => {
  showFolderPicker.mockReset();
  showFolderPicker.mockResolvedValue({ path: GARDEN });
});

function nameField() {
  return screen.getByPlaceholderText("Name it");
}

function instructionsField() {
  return screen.getByLabelText("Instructions");
}

async function addFolder() {
  fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
  await screen.findByLabelText("Users › me › Garden");
}

describe("ProjectDialog", () => {
  it("makes a project with its instructions and folders", async () => {
    const onCreate = vi.fn();
    renderWithProviders(
      <ProjectDialog
        mode="create"
        onCreate={onCreate}
        onOpenChange={vi.fn()}
        open
        otherNames={[]}
      />,
    );

    fireEvent.change(nameField(), { target: { value: "Garden" } });
    fireEvent.change(instructionsField(), {
      target: { value: "Answer in metric." },
    });
    await addFolder();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate.mock.calls[0]).toMatchObject([
      {
        folders: [{ path: GARDEN }],
        instructions: "Answer in metric.",
        name: "Garden",
      },
      [],
    ]);
  });

  it("refuses a new project the name of one in use", () => {
    renderWithProviders(
      <ProjectDialog
        mode="create"
        onCreate={vi.fn()}
        onOpenChange={vi.fn()}
        open
        otherNames={["Garden"]}
      />,
    );

    fireEvent.change(nameField(), { target: { value: "garden" } });

    expect(
      screen.getByText("There is already a project called “Garden”"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows a project's fields as they stand and hands back only what changed", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ProjectDialog
        mode="edit"
        onChange={onChange}
        onDelete={vi.fn()}
        onOpenChange={vi.fn()}
        open
        otherNames={[]}
        project={{
          color: "#3b6ef6",
          emoji: "🌱",
          id: "top_1",
          instructions: "Answer in metric.",
          name: "Garden",
        }}
      />,
    );

    expect(nameField()).toHaveProperty("value", "Garden");
    expect(instructionsField()).toHaveProperty("value", "Answer in metric.");
    expect(screen.getByText("No folders yet.")).toBeTruthy();
    await addFolder();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ folders: [{ path: GARDEN }] });
    });
    expect(screen.getByRole("button", { name: "Delete project" })).toBeTruthy();
  });

  it("swaps a project's emoji for an icon, keeping its color", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ProjectDialog
        mode="edit"
        onChange={onChange}
        onDelete={vi.fn()}
        onOpenChange={vi.fn()}
        open
        otherNames={[]}
        project={{
          color: "#3b6ef6",
          emoji: "📚",
          id: "top_1",
          name: "Reading",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose a mark" }));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Icon" }));
    const suggested = await screen.findByRole("region", {
      name: "Suggested for “Reading”",
    });
    fireEvent.click(within(suggested).getByRole("button", { name: "books" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onChange).toHaveBeenCalledWith({ emoji: "", icon: "books" });
  });

  it("opens the project's own folder in Files, closing the dialog", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ProjectDialog
        mode="edit"
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onOpenChange={onOpenChange}
        open
        otherNames={[]}
        project={{ id: "top_1", name: "Garden" }}
      />,
    );

    await screen.findByLabelText("Users › me › Instrument › Projects › Garden");
    fireEvent.click(screen.getByRole("button", { name: "Open in Files" }));

    expect(showProjectInFiles).toHaveBeenCalledWith({ name: "Garden" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
