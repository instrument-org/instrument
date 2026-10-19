import { renderWithProviders } from "@/tests/render";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type Clash,
  type ClashAnswer,
  useClashQuestions,
} from "./clash-dialog";

const FILE_OVER_FILE: Clash = {
  kind: "file",
  name: "notes.txt",
  path: "/a/notes.txt",
  replaceable: true,
  with: { by: "entry", kind: "file" },
};
const FOLDER_OVER_FOLDER: Clash = {
  kind: "folder",
  name: "pics",
  path: "/a/pics",
  replaceable: true,
  with: { by: "entry", kind: "folder" },
};
const TWO_SOURCES: Clash = {
  kind: "file",
  name: "notes.txt",
  path: "/b/notes.txt",
  replaceable: false,
  with: { by: "source", kind: "file" },
};

/** Asks about `clashes` and hands back what it settles with. */
function askAbout(clashes: Clash[]) {
  let ask: ReturnType<typeof useClashQuestions>["ask"] | undefined;
  function Harness() {
    const questions = useClashQuestions();
    ask = questions.ask;
    return questions.dialog;
  }
  renderWithProviders(<Harness />);
  let settled: null | Record<string, ClashAnswer> | undefined;
  act(() => {
    void ask?.(clashes, { folder: "Reports", verb: "moving" }).then(
      (answers) => {
        settled = answers;
      },
    );
  });
  return () => settled;
}

describe("asking about names already taken", () => {
  it("asks one at a time, Keep Both first under Return, with the wording for what each is", async () => {
    const settled = askAbout([FILE_OVER_FILE]);

    expect(screen.getByRole("alertdialog").textContent).toMatchInlineSnapshot(`"“notes.txt” already exists in “Reports”Do you want to replace it with the one you’re moving?StopReplaceKeep Both"`);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Keep Both");
    });
    fireEvent.click(screen.getByRole("button", { name: "Keep Both" }));

    await waitFor(() => {
      expect(settled()).toEqual({ "/a/notes.txt": "keepBoth" });
    });
  });

  it("stops on Escape, so nothing happens", async () => {
    const settled = askAbout([FILE_OVER_FILE, FOLDER_OVER_FOLDER]);

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    await waitFor(() => {
      expect(settled()).toBeNull();
    });
  });

  // Replace for all goes only to the ones that can be replaced; one that
  // cannot (two sources with one name) is still asked about in its turn.
  it("answers the rest with Apply to all, and asks about what that cannot answer", async () => {
    const settled = askAbout([FILE_OVER_FILE, FOLDER_OVER_FOLDER, TWO_SOURCES]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    await waitFor(() => {
      expect(screen.getByRole("alertdialog").textContent).toContain(
        "You’re moving two items named “notes.txt”",
      );
    });
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep Both" }));

    await waitFor(() => {
      expect(settled()).toEqual({
        "/a/notes.txt": "replace",
        "/a/pics": "replace",
        "/b/notes.txt": "keepBoth",
      });
    });
  });

  it("says when a folder would replace a folder, and a file a folder", () => {
    askAbout([
      FOLDER_OVER_FOLDER,
      { ...FILE_OVER_FILE, with: { by: "entry", kind: "folder" } },
    ]);

    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Do you want to replace it with the folder you’re moving?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Do you want to replace the folder with the one you’re moving?",
    );
  });
});
