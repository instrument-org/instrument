import { renderWithProviders } from "@/tests/render";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttachedFolderChangesNote } from "./attached-folder-changes-note";

function changes(
  data: Partial<SessionMessageDataPart.AttachedFolderChangesDataPart>,
) {
  return { accessChanged: [], added: [], removed: [], renamed: [], ...data };
}

function noteText() {
  return screen.queryByText(/./)?.textContent ?? null;
}

const NOTES = { name: "Notes", path: "/Users/sam/Notes" };
const PHOTOS = { name: "Photos", path: "/Users/sam/Photos" };

describe("AttachedFolderChangesNote", () => {
  it.each([
    {
      data: changes({
        accessChanged: [{ access: "read-write", ...NOTES }],
        removed: [PHOTOS],
      }),
      text: "Removed Photos",
    },
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
    renderWithProviders(<AttachedFolderChangesNote data={data} />);

    expect(noteText()).toBe(text);
  });

  // The app attaches its own two folders at startup and the conversation hands
  // one to a task it is running. Both arrive here, and neither is something the
  // person reading the chat did.
  it("draws nothing for folders arriving alone", () => {
    renderWithProviders(
      <AttachedFolderChangesNote
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
      <AttachedFolderChangesNote
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

  // The mount is ours and moves for reasons on our side; the user's folder is
  // still called what they call it, so there is nothing here to tell them.
  it("draws nothing for a mount rename alone", () => {
    renderWithProviders(
      <AttachedFolderChangesNote
        data={changes({
          renamed: [
            {
              newName: "Home-Notes",
              oldName: "Notes",
              path: "/Users/sam/Notes",
            },
          ],
        })}
      />,
    );

    expect(noteText()).toBeNull();
  });
});
