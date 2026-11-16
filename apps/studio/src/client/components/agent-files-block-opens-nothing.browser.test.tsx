import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { type ReactNode } from "react";
import { expect, test, vi } from "vitest";

import { AgentFilesBlock } from "./agent-files-block";
import { FileOpenContext } from "./file-open-context";
import { MarkdownChatContext } from "./markdown-chat-context";
import { ThemeProvider } from "./theme-provider";
import { WindowContext, type WindowContextValue } from "./window/context";

/**
 * A handed-over page, spreadsheet or document opens beside the chat only on
 * the live end of the turn, which the workspace decides. Drawing a reply's
 * files fence is a read, so it opens nothing: not an old finished reply, and
 * not a reply seen going from streaming to finished, which is what another
 * window, a reopened chat or a task drawn in its parent sees.
 */

vi.mock("@/client/hooks/use-host-paths", () => ({
  useHostPaths: (_chatId: unknown, filePaths: readonly string[]) =>
    Object.fromEntries(
      filePaths.map((filePath) => [
        filePath,
        `/Users/mac-user/tasks/quarterly-numbers/${filePath}`,
      ]),
    ),
}));
vi.mock("@/client/hooks/use-computers-holding", () => ({
  useComputersHolding: () => ({}),
}));
vi.mock("@/client/lib/computer-file-url", () => ({
  getComputerFileUrl: ({ hostPath }: { hostPath: string }) =>
    `http://files.example.test${hostPath}`,
  getComputerThumbnailUrl: () => "",
  thumbnailUrlAtSize: (url: string) => url,
}));

const HANDED = "```files\nsite/index.html\nnumbers.xlsx\nreport.pdf\n```";

function openers() {
  const openFile = vi.fn();
  const appWindow = {
    ask: vi.fn(),
    browser: null,
    openPage: vi.fn(),
    openPath: vi.fn(),
    openScreen: vi.fn(),
  } satisfies WindowContextValue;
  const draw = (isStreaming: boolean): ReactNode => (
    <ThemeProvider>
      <WindowContext value={appWindow}>
        <FileOpenContext value={openFile}>
          <MarkdownChatContext
            value={{
              chatId: ChatIdSchema.parse("quarterly-numbers"),
              isStreaming,
            }}
          >
            <AgentFilesBlock content={HANDED} />
          </MarkdownChatContext>
        </FileOpenContext>
      </WindowContext>
    </ThemeProvider>
  );
  const opened = () => [
    ...openFile.mock.calls,
    ...appWindow.openPage.mock.calls,
    ...appWindow.openPath.mock.calls,
    ...appWindow.openScreen.mock.calls,
  ];
  return { draw, opened };
}

test("drawing an old finished reply opens nothing", async () => {
  const { draw, opened } = openers();
  const screen = await renderInBrowser(draw(false));
  await expect
    .element(screen.getByText("index.html", { exact: false }).first())
    .toBeInTheDocument();
  expect(opened()).toEqual([]);
});

test("a reply seen finishing opens nothing either", async () => {
  const { draw, opened } = openers();
  const screen = await renderInBrowser(draw(true));
  await screen.rerender(draw(false));
  await expect
    .element(screen.getByText("report.pdf", { exact: false }).first())
    .toBeInTheDocument();
  expect(opened()).toEqual([]);
});
