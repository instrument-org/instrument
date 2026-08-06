import { type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Markdown } from "./markdown";
import { CurrentTaskFilesProvider } from "./task/current-task-files";

// The chip navigates on click; the route tree it navigates within is not what
// these tests are about.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

const MOUNTED_PATH = "/mnt/Documents-Test 2/August.md";

// Only a mounted file needs the server, since the live index cannot answer for
// a path outside the task directory. The path is spelled out rather than read
// from the constant above, which the hoisted factory cannot see.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      openExternalLink: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
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
                input.filePath === "/mnt/Documents-Test 2/August.md"
                  ? Promise.resolve({
                      filename: "August.md",
                      filePath: "/mnt/Documents-Test 2/August.md",
                      mimeType: "text/markdown",
                      modifiedAt: 300,
                    })
                  : Promise.reject(new Error("File not found")),
              queryKey: ["fileInfo", input.taskId, input.filePath],
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
    filename: "notes.md",
    filePath: "output/notes.md",
    mimeType: "text/markdown",
    modifiedAt: 200,
    size: 20,
  },
] as RPCOutput["workspace"]["task"]["files"]["list"];

function renderMarkdown(markdown: string) {
  return renderWithProviders(
    <CurrentTaskFilesProvider files={INDEXED}>
      <Markdown
        assetBaseUrl={ASSET_BASE}
        markdown={markdown}
        taskId={TASK_ID}
      />
    </CurrentTaskFilesProvider>,
  );
}

describe("Markdown links", () => {
  it("opens a file: link to a shared folder, which the task file index never holds", async () => {
    renderMarkdown(
      "Created [`August.md`](file:///mnt/Documents-Test%202/August.md) in Test 2.",
    );

    const chip = await screen.findByRole("button", { name: "August.md" });
    expect(chip.title).toBe(MOUNTED_PATH);
  });

  // Asserted as the absence of an anchor rather than of a link role, which an
  // `<a>` carrying the empty href the default transform leaves behind does not
  // have either: the dead anchor is the whole bug, so a test that cannot see
  // one passes whether the href reaches the shell or not.
  it("leaves a file: link to a path outside the mounts as plain text", async () => {
    const { container, queryClient } = renderMarkdown(
      "Saved [your key](file:///Users/someone/.ssh/id_rsa).",
    );
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });

    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toContain("your key");
  });

  it("leaves a file: URL that does not parse as plain text", () => {
    const { container } = renderMarkdown("See [the doc](file://host|bad/x).");

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("the doc");
  });

  it("still opens a task-relative link the index holds", () => {
    renderMarkdown("Wrote [`notes.md`](output/notes.md).");

    expect(screen.getByRole("button", { name: "notes.md" }).title).toBe(
      "output/notes.md",
    );
  });

  it("still hands an http link to the browser", () => {
    renderMarkdown("See [the docs](https://example.com/a).");

    expect(screen.getByRole("link", { name: "the docs" })).toHaveProperty(
      "href",
      "https://example.com/a",
    );
  });
});
