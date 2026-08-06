import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentFilesBlock } from "./agent-files-block";
import { MarkdownTaskContext } from "./markdown-task-context";
import { CurrentTaskFilesProvider } from "./task/current-task-files";

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

const MOUNTED_PATH = "/mnt/Photos/cat.png";

// Only the mounted file needs the server, since the live index cannot answer
// for a path outside the task directory. The path is spelled out rather than
// read from the constant above, which the hoisted factory cannot see.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      task: {
        files: {
          fileInfo: {
            queryOptions: ({
              input,
            }: {
              input: { filePath: string; taskId: string };
            }) => ({
              queryFn: () =>
                input.filePath === "/mnt/Photos/cat.png"
                  ? Promise.resolve({
                      filename: "cat.png",
                      filePath: "/mnt/Photos/cat.png",
                      mimeType: "image/png",
                      modifiedAt: 300,
                    })
                  : Promise.reject(new Error("File not found")),
              queryKey: ["fileInfo", input.taskId, input.filePath],
              retry: false,
            }),
          },
        },
      },
    },
  },
}));
const TASK_ID = TaskIdSchema.parse("a-task");
const ASSET_BASE = "http://assets.a-task.localhost:1234";

// The index brands `filePath` to force real paths through the path schema;
// these are literals standing in for entries that already went through it.
const INDEXED = [
  {
    filename: "chart.png",
    filePath: "output/chart.png",
    mimeType: "image/png",
    modifiedAt: 100,
    size: 10,
  },
  {
    filename: "notes.md",
    filePath: "output/notes.md",
    mimeType: "text/markdown",
    modifiedAt: 200,
    size: 20,
  },
] as RPCOutput["workspace"]["task"]["files"]["list"];

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
      <CurrentTaskFilesProvider files={INDEXED}>
        <AgentFilesBlock content={content} />
      </CurrentTaskFilesProvider>
    </MarkdownTaskContext>,
  );
}

describe("AgentFilesBlock", () => {
  it("shows the files in the order the fence listed them, versioned by mtime", () => {
    renderBlock("output/notes.md\noutput/chart.png");

    expect(screen.getAllByRole("listitem").map((item) => item.textContent))
      .toMatchInlineSnapshot(`
        [
          "output/notes.md @ http://assets.a-task.localhost:1234/output/notes.md?version=200",
          "output/chart.png @ http://assets.a-task.localhost:1234/output/chart.png?version=100",
        ]
      `);
  });

  it("resolves a path under a mount, which the task file index never holds", async () => {
    renderBlock(`output/chart.png\n${MOUNTED_PATH}`);
    // The indexed file is on screen from the first render, so the wait has to
    // be for the mounted one specifically.
    await screen.findByText(/cat\.png/u);

    expect(screen.getAllByRole("listitem").map((item) => item.textContent))
      .toMatchInlineSnapshot(`
      [
        "output/chart.png @ http://assets.a-task.localhost:1234/output/chart.png?version=100",
        "/mnt/Photos/cat.png @ http://assets.a-task.localhost:1234/mnt/Photos/cat.png?version=300",
      ]
    `);
  });

  it("takes the grid's folder bucketing off, which drops anything outside the task folder", () => {
    renderBlock("output/chart.png");

    expect(screen.getByRole("list").dataset.preserveOrder).toBe("true");
  });

  it("keeps a path that resolves to nothing, named and marked not found", async () => {
    renderBlock("output/chart.png\noutput/gone.png");

    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "output/chart.png @ http://assets.a-task.localhost:1234/output/chart.png?version=100",
    ]);
    // By filename: the path it was written as is a sandbox path, and the full
    // one is on hover instead.
    expect(await screen.findByText("gone.png")).toBeDefined();
    expect(screen.getByTitle("output/gone.png")).toBeDefined();
    expect(screen.queryByText("output/gone.png")).toBeNull();
  });

  // Both of these assert an absence, so they have to outlast the lookups: a
  // path whose query is still in flight is undecided, and would read as absent
  // no matter what the component does with it.
  it("says nothing is missing while the fence is still arriving", async () => {
    const { container, queryClient } = renderBlock(
      "output/chart.png\noutput/gon",
      { isStreaming: true },
    );
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });

    expect(screen.queryByText(/not found/iu)).toBeNull();
    expect(container.textContent).toContain("output/chart.png");
  });

  it("ignores a stray line that was never meant as a path", async () => {
    const { queryClient } = renderBlock(
      "Here are your files\noutput/chart.png\noutput/gone.png",
    );
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });

    // The real miss is reported, so the lookups have settled and the stray line
    // was judged rather than merely still pending.
    expect(await screen.findByText("gone.png")).toBeDefined();
    expect(screen.queryByText("Here are your files")).toBeNull();
  });

  it("renders nothing while a fence with no resolvable line streams in", () => {
    const { container } = renderBlock("output/ch", { isStreaming: true });

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing outside a task, where no path can be resolved", () => {
    const { container } = renderBlock("output/chart.png", { inTask: false });

    expect(container.innerHTML).toBe("");
  });
});
