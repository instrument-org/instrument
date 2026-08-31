import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
// The chip a blocked image stands behind hands its URL to the system browser;
// the spy is that seam.
const { openExternalLinkSpy } = vi.hoisted(() => ({
  openExternalLinkSpy: vi.fn(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      openExternalLink: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: openExternalLinkSpy,
        }),
      },
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
  "![chart](./chart.png)",
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

  // A rejected source stands as a chip naming its host. A chip with a web
  // source is a button out to the system browser, the same trust a link in
  // the same document gets; a path names nothing a browser could be handed,
  // so that chip is not a button at all.
  it("offers a web image as a click out to the browser, and a path as none", async () => {
    renderMarkdownFile();
    await screen.findByText("Notes");

    expect(
      screen.getByRole("button", { name: /raw\.githubusercontent\.com/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /x\.localhost/ })).toBeTruthy();
    expect(screen.getByText("./chart.png")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /chart\.png/ })).toBeNull();
  });

  // The click leaves the app rather than fetching in it: the URL goes to the
  // system browser and the preview still draws no image for it.
  it("hands a clicked image to the system browser", async () => {
    const { container } = renderMarkdownFile();
    await screen.findByText("Notes");

    fireEvent.click(
      screen.getByRole("button", { name: /raw\.githubusercontent\.com/ }),
    );

    await waitFor(() => {
      expect(openExternalLinkSpy.mock.calls[0]?.[0]).toEqual({
        url: "https://raw.githubusercontent.com/o/r/main/p.png",
      });
    });
    const sources = [...container.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(sources).toEqual(["data:image/png;base64,QUJD"]);
  });
});
