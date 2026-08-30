import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FileViewer } from "./file-viewer";

// What is under test is the markdown preview; the header's open-with
// affordances ask the main process questions a jsdom test has no answers to.
vi.mock("../hooks/use-task-file-open-control", () => ({
  useTaskFileOpenControl: () => ({}),
}));
vi.mock("./open-task-file-button", () => ({
  OpenTaskFileButton: () => null,
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      showTaskFileInFolder: {
        mutationOptions: (options: object) => options,
      },
    },
  },
}));

const TASK_ID = TaskIdSchema.parse("a-task");

// A `.md` that arrived in the task folder: one image of every kind the agent's
// own markdown would be allowed to fetch, plus the embedded one that stays.
const MARKDOWN_FILE = [
  "# Notes",
  "![embedded](data:image/png;base64,QUJD)",
  "![remote](https://raw.githubusercontent.com/o/r/main/p.png)",
  "![loopback](http://x.localhost:11434/probe)",
].join("\n\n");

function renderMarkdownFile() {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(MARKDOWN_FILE)));
  return renderWithProviders(
    <FileViewer
      file={{
        filename: "notes.md",
        filePath: "output/notes.md",
        mimeType: "text/markdown",
        taskId: TASK_ID,
        url: "http://assets.a-task.localhost:1234/output/notes.md",
      }}
    />,
  );
}

// jsdom has no layout engine and so no scrolling; the viewer resets its
// scroll position when the view mode changes.
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A `.md` in the task folder is a file someone else may have written -- a
// cloned repo, an attachment, agent output -- and an `<img>` naming a host is
// fetched the moment the preview renders, with no click in between.
describe("FileViewer markdown preview", () => {
  it("draws only the file's embedded images", async () => {
    const { container } = renderMarkdownFile();
    await screen.findByText("Notes");

    const sources = [...container.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(sources).toEqual(["data:image/png;base64,QUJD"]);
  });

  // Not fetched until a reader clicks for it: a rejected source names its URL
  // in a placeholder rather than reaching for it, so no `<img>` renders for it
  // on its own.
  it("holds a rejected image behind a click instead of fetching it", async () => {
    const { container } = renderMarkdownFile();
    await screen.findByText("Notes");

    const sources = [...container.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(sources).toEqual(["data:image/png;base64,QUJD"]);
    expect(
      screen.getByText("https://raw.githubusercontent.com/o/r/main/p.png"),
    ).toBeTruthy();
    expect(screen.getByText("http://x.localhost:11434/probe")).toBeTruthy();
  });

  // A reader who wants a rejected image anyway can still choose to load it: the
  // click is the request, and it happens only for the one placeholder clicked.
  it("draws a rejected image once its placeholder is clicked", async () => {
    const { container } = renderMarkdownFile();
    await screen.findByText("Notes");

    fireEvent.click(
      screen.getByRole("button", { name: /raw\.githubusercontent\.com/ }),
    );

    const sources = [...container.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(sources).toEqual([
      "data:image/png;base64,QUJD",
      "https://raw.githubusercontent.com/o/r/main/p.png",
    ]);
  });
});
