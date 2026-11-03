import { renderWithProviders } from "@/tests/render";
import { act, fireEvent, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type FileInfoItem, requestFileInfo, useFileInfo } from "./file-info";

const { isActive } = vi.hoisted(() => ({ isActive: { current: true } }));

vi.mock("@/client/hooks/use-active-tab", () => ({
  useIsActiveTab: () => isActive.current,
}));
vi.mock("@/client/hooks/use-watched-file-url", () => ({
  useWatchedFileUrl: () => undefined,
}));
vi.mock("@/client/hooks/use-file-open-target", () => ({
  useFileOpenTarget: () => ({ appName: null }),
}));
vi.mock("@/client/components/folder-trail", () => ({
  FolderTrail: ({ path }: { path: string }) => <span>{path}</span>,
}));
vi.mock("@/client/rpc/client", () => {
  const procedure = {
    queryOptions: ({ input }: { input: unknown }) => ({
      enabled: false,
      queryFn: () => null,
      queryKey: ["stub", input],
    }),
  };
  return {
    rpcClient: {
      files: { folderSize: procedure, probeMedia: procedure },
      workspace: { computer: { list: procedure, titles: procedure } },
    },
  };
});

const note: FileInfoItem = {
  hostPath: "/work/note.md",
  kind: "file",
  kindLabel: "Markdown Document",
  modifiedAt: "2026-11-03T15:16:00.000Z",
  name: "note.md",
  size: 40_218,
};
const sheet: FileInfoItem = {
  ...note,
  hostPath: "/work/sheet.csv",
  kindLabel: "CSV Document",
  name: "sheet.csv",
  size: 4096,
};

function Screen({
  file,
  selection,
}: {
  file?: string;
  selection: FileInfoItem[];
}) {
  const info = useFileInfo({ belowRow: true, file });
  const { onInfoSelection } = info.props;
  useEffect(() => {
    onInfoSelection(selection);
  }, [onInfoSelection, selection]);
  return (
    <div>
      <input aria-label="Name" />
      <button onClick={info.openOnFile} type="button">
        File's menu
      </button>
      {info.card}
    </div>
  );
}

const card = () => screen.queryByRole("complementary", { name: "Info" });
const press = () => {
  act(() => {
    requestFileInfo();
  });
};

describe("the info card", () => {
  beforeEach(() => {
    isActive.current = true;
  });

  it("opens over what is selected, and the same key puts it away", () => {
    renderWithProviders(<Screen selection={[note]} />);
    expect(card()).toBeNull();
    press();
    expect(card()?.textContent).toContain("note.md");
    expect(card()?.textContent).toContain("40,218 bytes");
    press();
    expect(card()).toBeNull();
  });

  it("does not take the keyboard, and follows the selection", () => {
    const { rerender } = renderWithProviders(<Screen selection={[note]} />);
    const before = document.activeElement;
    press();
    expect(document.activeElement).toBe(before);
    rerender(<Screen selection={[sheet]} />);
    expect(card()?.textContent).toContain("sheet.csv");
    expect(card()?.textContent).not.toContain("note.md");
  });

  it("stays shut with nothing selected", () => {
    renderWithProviders(<Screen selection={[]} />);
    press();
    expect(card()).toBeNull();
  });

  it("leaves the key to a field being typed in", () => {
    renderWithProviders(<Screen selection={[note]} />);
    screen.getByRole("textbox", { name: "Name" }).focus();
    press();
    expect(card()).toBeNull();
  });

  it("answers only in the tab up", () => {
    isActive.current = false;
    renderWithProviders(<Screen selection={[note]} />);
    press();
    expect(card()).toBeNull();
  });

  it("goes on Esc, unless something nearer already used it", () => {
    renderWithProviders(<Screen selection={[note]} />);
    press();
    const used = (event: KeyboardEvent) => {
      event.preventDefault();
    };
    document.body.addEventListener("keydown", used);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(card()).not.toBeNull();
    document.body.removeEventListener("keydown", used);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(card()).toBeNull();
  });

  it("is about the open file from its own menu, until the selection moves", () => {
    const folder: FileInfoItem = {
      hostPath: "/work/ai-spend",
      kind: "folder",
      kindLabel: "Folder",
      name: "ai-spend",
    };
    const { rerender } = renderWithProviders(
      <Screen file="/work/note.md" selection={[folder]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "File's menu" }));
    expect(card()?.textContent).toContain("note.md");
    rerender(<Screen file="/work/note.md" selection={[sheet]} />);
    expect(card()?.textContent).toContain("sheet.csv");
  });

  it("is about the open file with nothing selected", () => {
    renderWithProviders(<Screen file="/work/note.md" selection={[]} />);
    press();
    expect(card()?.textContent).toContain("note.md");
  });

  it("asks before reading a folder macOS guards, unless asked for by name", () => {
    const guarded: FileInfoItem = {
      hostPath: `${window.api.homeDir}/Documents`,
      kind: "folder",
      kindLabel: "Folder",
      name: "Documents",
    };
    const { rerender } = renderWithProviders(<Screen selection={[note]} />);
    press();
    rerender(<Screen selection={[guarded]} />);
    expect(screen.queryByRole("button", { name: "Calculate" })).not.toBeNull();
    press();
    press();
    expect(screen.queryByRole("button", { name: "Calculate" })).toBeNull();
  });

  it("adds up several, and counts folders apart", () => {
    const folder: FileInfoItem = {
      hostPath: "/work/ai-spend",
      kind: "folder",
      kindLabel: "Folder",
      name: "ai-spend",
    };
    renderWithProviders(<Screen selection={[note, sheet, folder]} />);
    press();
    expect(card()?.textContent).toContain("3 items");
    expect(card()?.textContent).toContain(", plus 1 folder");
    expect(card()?.textContent).toContain(
      "1 Markdown Document, 1 CSV Document, 1 Folder",
    );
  });
});
