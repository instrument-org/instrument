import { renderWithProviders } from "@/tests/render";
import {
  type FolderAttachment,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FolderAttachmentsCard } from "./folder-attachments-card";

// Paths shorten against the home directory the dom setup pins on the preload
// bridge, `/Users/sam`.

// Branded ids and paths have no runtime constructor on the client entry, which
// is why the fixtures spell them this way too.
function folder(
  path: string,
  {
    access = "read-only",
    name = "Home-Downloads",
  }: Partial<Pick<FolderAttachment.Type, "access" | "name">> = {},
): SessionMessageDataPart.FolderAttachmentDataPart {
  return {
    access,
    createdAt: 0,
    id: path as never,
    name,
    path: path as never,
    source: "user",
  };
}

describe("FolderAttachmentsCard", () => {
  // `name` is the mount the agent works through, qualified with an ancestor
  // directory whether or not anything collides, so it is never what the user
  // picked.
  it("names a folder from its path rather than its mount name", () => {
    renderWithProviders(
      <FolderAttachmentsCard folders={[folder("/Users/sam/Downloads")]} />,
    );

    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.queryByText("Home-Downloads")).toBeNull();
  });

  it("shortens a path under the home directory", () => {
    renderWithProviders(
      <FolderAttachmentsCard folders={[folder("/Users/sam/Downloads")]} />,
    );

    expect(screen.getByText("~/Downloads")).toBeTruthy();
  });

  it("shows a path outside the home directory in full", () => {
    renderWithProviders(
      <FolderAttachmentsCard folders={[folder("/Volumes/Archive/2026")]} />,
    );

    expect(screen.getByText("/Volumes/Archive/2026")).toBeTruthy();
  });

  // A message is a record of what was sent, and access can be changed after
  // it: a label here would describe a grant that no longer holds.
  it("says nothing about access", () => {
    renderWithProviders(
      <FolderAttachmentsCard
        folders={[
          folder("/Users/sam/Downloads", { access: "read-only" }),
          folder("/Users/sam/Photos", { access: "read-write" }),
        ]}
      />,
    );

    expect(screen.queryByText("Read-only")).toBeNull();
    expect(screen.queryByText("Full access")).toBeNull();
  });
});
