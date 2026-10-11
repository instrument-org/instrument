import { renderWithProviders } from "@/tests/render";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileOpenContext } from "./file-open-context";
import { SentFoldersCard } from "./sent-folders-card";
import { type OpenOptions } from "./window/context";

// Paths shorten against the home directory the dom setup pins on the preload
// bridge, `/Users/sam`.

function folder(path: string): SessionMessageDataPart.SentFolderDataPart {
  return { path };
}

describe("SentFoldersCard", () => {
  it("names a folder from its path", () => {
    renderWithProviders(
      <SentFoldersCard folders={[folder("/Users/sam/Downloads")]} />,
    );

    expect(screen.getByText("Downloads")).toBeTruthy();
  });

  it("reads a path under the home directory from the home folder's name", () => {
    renderWithProviders(
      <SentFoldersCard folders={[folder("/Users/sam/Downloads")]} />,
    );

    expect(screen.getByText("sam/Downloads")).toBeTruthy();
  });

  it("shows a path outside the home directory in full", () => {
    renderWithProviders(
      <SentFoldersCard folders={[folder("/Volumes/Archive/2026")]} />,
    );

    expect(screen.getByText("/Volumes/Archive/2026")).toBeTruthy();
  });

  it("opens the folder where the surface opens files", () => {
    const openFile = vi.fn<(path: string, options?: OpenOptions) => void>();
    renderWithProviders(
      <FileOpenContext value={openFile}>
        <SentFoldersCard folders={[folder("/Users/sam/Downloads")]} />
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
