import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentFilesBlock } from "./agent-files-block";
import { MarkdownTaskContext } from "./markdown-task-context";

// The grid is a router-bound tree of preview cards; what this component decides
// is which files reach it and in what order, so it stands in for the real one.
vi.mock("./files-grid", () => ({
  FilesGrid: ({
    files,
    preserveOrder,
  }: {
    files: TaskFileViewerFile[];
    preserveOrder?: boolean;
  }) => (
    <ul data-preserve-order={String(preserveOrder)}>
      {files.map((file) => (
        <li key={file.filePath}>{`${file.filePath} @ ${file.url}`}</li>
      ))}
    </ul>
  ),
}));

// A fence draws from its paths and asks the server nothing, so any call at all
// is the failure. Every case below runs against this, which is what makes them
// evidence for that rule rather than just for their own output.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: new Proxy(
    {},
    {
      get() {
        throw new Error("a rendering fence resolved a file over the network");
      },
    },
  ),
}));

const TASK_ID = TaskIdSchema.parse("a-task");
const ASSET_BASE = "http://assets.a-task.localhost:1234";

function renderBlock(
  content: string,
  {
    inTask = true,
    isStreaming = false,
  }: {
    inTask?: boolean;
    isStreaming?: boolean;
  } = {},
) {
  return renderWithProviders(
    <MarkdownTaskContext
      value={
        inTask
          ? { assetBaseUrl: ASSET_BASE, isStreaming, taskId: TASK_ID }
          : { isStreaming }
      }
    >
      <AgentFilesBlock content={content} />
    </MarkdownTaskContext>,
  );
}

const shownFiles = () =>
  screen.getAllByRole("listitem").map((item) => item.textContent);

describe("AgentFilesBlock", () => {
  it("shows the files in the order the fence listed them", () => {
    renderBlock("output/notes.md\noutput/chart.png");

    expect(shownFiles()).toMatchInlineSnapshot(`
      [
        "output/notes.md @ http://assets.a-task.localhost:1234/output/notes.md",
        "output/chart.png @ http://assets.a-task.localhost:1234/output/chart.png",
      ]
    `);
  });

  // The task-file index covers the task directory only, so this path is one no
  // index could have answered for -- and now nothing has to.
  it("shows a file in a folder the user shared", () => {
    renderBlock("/mnt/Photos/cat.png");

    expect(shownFiles()).toMatchInlineSnapshot(`
      [
        "/mnt/Photos/cat.png @ http://assets.a-task.localhost:1234/mnt/Photos/cat.png",
      ]
    `);
  });

  it("takes the grid's folder bucketing off, which drops anything outside the task folder", () => {
    renderBlock("output/chart.png");

    expect(screen.getByRole("list").dataset.preserveOrder).toBe("true");
  });

  // Whether the bytes are there is a question with a different answer every
  // minute, so the card is drawn either way and the click is what finds out.
  // An image answers it on its own: the thumbnail 404s onto the fallback card.
  it("draws a card for a path with nothing behind it", () => {
    renderBlock("output/gone.png");

    expect(shownFiles()).toEqual([
      "output/gone.png @ http://assets.a-task.localhost:1234/output/gone.png",
    ]);
  });

  // The paths come from model output, so a host path can turn up among them.
  // Nothing this app can do with one, so it draws no card claiming otherwise.
  it.each(["/Users/someone/.ssh/id_rsa", "../../etc/passwd", "C:\\keys.txt"])(
    "refuses %s, which is not a path it can address",
    (path) => {
      const { container } = renderBlock(path);

      expect(container.innerHTML).toBe("");
    },
  );

  // Mid-stream the last line is a path the model is still typing, and drawing
  // it would put up a card for `output/ch` and replace it on every keystroke.
  it("draws only the lines a streaming fence has finished", () => {
    renderBlock("output/chart.png\noutput/gon", { isStreaming: true });

    expect(shownFiles()).toEqual([
      "output/chart.png @ http://assets.a-task.localhost:1234/output/chart.png",
    ]);
  });

  it("renders nothing while a fence with no finished line streams in", () => {
    const { container } = renderBlock("output/ch", { isStreaming: true });

    expect(container.innerHTML).toBe("");
  });

  it("ignores a stray line that was never meant as a path", () => {
    renderBlock("Here are your files\noutput/chart.png");

    expect(shownFiles()).toEqual([
      "output/chart.png @ http://assets.a-task.localhost:1234/output/chart.png",
    ]);
    expect(screen.queryByText(/Here are your files/u)).toBeNull();
  });

  it("renders nothing outside a task, which is what an asset URL needs", () => {
    const { container } = renderBlock("output/chart.png", { inTask: false });

    expect(container.innerHTML).toBe("");
  });
});
