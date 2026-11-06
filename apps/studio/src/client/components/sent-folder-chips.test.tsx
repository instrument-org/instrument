import { renderWithProviders } from "@/tests/render";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileOpenContext } from "./file-open-context";
import { SentFolderChips } from "./sent-folder-chips";
import { type OpenOptions } from "./window/context";

function folder(path: string): SessionMessageDataPart.SentFolderDataPart {
  return { path };
}

describe("SentFolderChips", () => {
  it("names a folder by its own name", () => {
    renderWithProviders(
      <SentFolderChips folders={[folder("/Users/sam/Downloads")]} />,
    );

    expect(screen.getByRole("button").textContent).toBe("Downloads");
  });

  it("opens the folder where the surface opens files", () => {
    const openFile = vi.fn<(path: string, options?: OpenOptions) => void>();
    renderWithProviders(
      <FileOpenContext value={openFile}>
        <SentFolderChips folders={[folder("/Users/sam/Downloads")]} />
      </FileOpenContext>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(openFile.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "/Users/sam/Downloads/",
          {},
        ],
      ]
    `);
  });
});
