import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopicDialog } from "./topic-dialog";

const { showFolderPicker } = vi.hoisted(() => ({
  showFolderPicker: vi.fn<() => Promise<{ path: string } | null>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { utils: { showFolderPicker: { call: showFolderPicker } } },
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
  useDictation: () => ({
    cancel: vi.fn(),
    live: undefined,
    phase: { kind: "idle" },
    start: vi.fn(),
    stop: vi.fn(),
    stream: undefined,
  }),
}));
vi.mock(import("./use-topic-backfill"), async (importOriginal) => ({
  ...(await importOriginal()),
  useTopicBackfill: () => [],
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
  await screen.findByText("Garden");
}

describe("TopicDialog", () => {
  it("makes a topic with its instructions and folders", async () => {
    const onCreate = vi.fn();
    renderWithProviders(
      <TopicDialog
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

  it("refuses a new topic the name of one in use", () => {
    renderWithProviders(
      <TopicDialog
        mode="create"
        onCreate={vi.fn()}
        onOpenChange={vi.fn()}
        open
        otherNames={["Garden"]}
      />,
    );

    fireEvent.change(nameField(), { target: { value: "garden" } });

    expect(
      screen.getByText("There is already a topic called “Garden”"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows a topic's fields as they stand and hands back only what changed", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TopicDialog
        mode="edit"
        onChange={onChange}
        onDelete={vi.fn()}
        onOpenChange={vi.fn()}
        open
        otherNames={[]}
        topic={{
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
    expect(screen.getByRole("button", { name: "Delete topic" })).toBeTruthy();
  });
});
