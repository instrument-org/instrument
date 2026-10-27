import "@milkdown/crepe/theme/common/style.css";

import "@/client/components/markdown-editor/markdown-editor.css";

import {
  createEditorSession,
  type EditorSession,
  type EditorSessionOptions,
} from "@/client/components/markdown-editor/editor-session";
import { vi } from "vitest";

const open: EditorSession[] = [];

/**
 * Open the Markdown editor on a document in the browser project, styled and
 * laid out as the app draws it: a column of text with a gutter on its left,
 * where the block handle stands.
 *
 * The session reads and writes its file through the main process, so the file
 * using this mocks `@/client/rpc/client` (a mock belongs to the file that
 * declares it); nothing here saves, so the mock is never reached. Pair it with
 * `afterEach(closeMarkdownEditors)`.
 */
export async function openMarkdownEditor(
  markdown: string,
  {
    hostPath = "/notes.md",
    onOpenLink = vi.fn(),
  }: Partial<Pick<EditorSessionOptions, "hostPath" | "onOpenLink">> = {},
) {
  const frame = document.createElement("div");
  frame.className = "md-editor";
  frame.style.width = "640px";
  frame.style.marginLeft = "80px";
  const root = document.createElement("div");
  frame.append(root);
  document.body.append(frame);
  const session = await createEditorSession({
    hostPath,
    initial: { content: markdown, version: "1" },
    onAsk: vi.fn(),
    onExternalChange: vi.fn(),
    onFrontMatter: vi.fn(),
    onOpenLink,
    onStatus: vi.fn(),
    renderFence: () => null,
    resolveSrc: (src) => src,
    root,
  });
  open.push(session);
  return session.view();
}

/** Tear down every editor a test opened, and what they drew. */
export async function closeMarkdownEditors() {
  for (const session of open.splice(0)) {
    await session.destroy();
  }
  document.body.replaceChildren();
}
