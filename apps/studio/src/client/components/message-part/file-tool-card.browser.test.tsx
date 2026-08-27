import { renderInBrowser } from "@/tests/render-browser";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { FileToolCard } from "./file-tool-card";
import { ToolCallSessionProvider } from "./tool-call-session";

// The card asks which theme to highlight against, which the real provider
// answers over an RPC round trip the browser project has no main process for.
// Every case here is about the box the card draws, which is the same box
// whether the text came back highlighted or as the plain fallback.
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    syntax: {
      highlightCode: {
        queryOptions: () => ({ queryFn: () => [], queryKey: ["highlight"] }),
      },
      supportedLanguages: {
        queryOptions: () => ({ queryFn: () => [], queryKey: ["languages"] }),
      },
    },
  },
}));

vi.mock("../../hooks/use-task-pane", () => ({
  useTaskPaneActions: () => ({ openFiles: vi.fn() }),
}));

const taskId = TaskIdSchema.parse("task-fixture");

const renderCard = (content: string) =>
  renderInBrowser(
    <div style={{ width: 480 }}>
      <ToolCallSessionProvider
        backgroundProcess={undefined}
        isRunning={false}
        isStreaming={false}
      >
        <FileToolCard
          content={content}
          filePath="src/utils/helpers.ts"
          id={taskId}
          modifiedAt={1_718_198_400_000}
        />
      </ToolCallSessionProvider>
    </div>,
  );

describe("FileToolCard", () => {
  // 14px, the size the pane reads a whole file at. Asserted rather than trusted
  // because the size used to live on a component that was removed, and nothing
  // under the card sets one: the highlighter's `<pre>` takes `1em` from
  // preflight, so losing the class reads as "inherit" and silently grew the
  // body to 16px in every file card at once.
  it("draws a file body at the size the pane reads one at", async () => {
    const screen = await renderCard("const a = 1;\nconst b = 2;\n");
    const pre = screen.container.querySelector("pre");
    if (!pre) {
      throw new Error("no file body rendered");
    }

    expect(globalThis.getComputedStyle(pre).fontSize).toBe("14px");
  });

  it("says so rather than drawing nothing when there is no content", async () => {
    const screen = await renderCard("");

    await expect
      .element(screen.getByText("There is nothing to show."))
      .toBeVisible();
  });
});
