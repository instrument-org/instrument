import { renderWithProviders } from "@/tests/render";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FolderChangesNote } from "./folder-changes-note";

function changes(data: Partial<SessionMessageDataPart.FolderChangesDataPart>) {
  return { added: [], removed: [], ...data };
}

function noteText() {
  return screen.queryByText(/./)?.textContent ?? null;
}

const NOTES = { path: "/Users/sam/Notes" };
const PHOTOS = { path: "/Users/sam/Photos" };

describe("FolderChangesNote", () => {
  it.each([
    {
      data: changes({ removed: [NOTES, PHOTOS] }),
      text: "Removed 2 folders",
    },
    {
      data: changes({
        added: [{ access: "read-write", ...NOTES }],
        removed: [PHOTOS],
      }),
      text: "Removed Photos",
    },
  ])("says $text", ({ data, text }) => {
    renderWithProviders(<FolderChangesNote data={data} />);

    expect(noteText()).toBe(text);
  });

  // A folder granted already shows on the message that sent it or the card
  // that asked for it.
  it("draws nothing for folders arriving alone", () => {
    renderWithProviders(
      <FolderChangesNote
        data={changes({
          added: [
            { access: "read-write", ...NOTES },
            { access: "read-only", ...PHOTOS },
          ],
        })}
      />,
    );

    expect(noteText()).toBeNull();
  });

  it("names the folders that arrived in developer mode", () => {
    renderWithProviders(
      <FolderChangesNote
        data={changes({
          added: [
            { access: "read-write", ...NOTES },
            { access: "read-only", ...PHOTOS },
          ],
        })}
        isDeveloperMode
      />,
    );

    expect(noteText()).toBe("Added Notes, Photos");
  });
});
