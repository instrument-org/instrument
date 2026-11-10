import { afterEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  read: { call: vi.fn() },
  write: { call: vi.fn() },
}));

vi.mock("@/client/rpc/client", () => ({ rpcClient: { files } }));

import { CANT_SAVE_TEXT_FORMAT } from "@/client/components/read-only-note";

import { type CodeSession, createCodeSession } from "./code-session";

const open: CodeSession[] = [];

function openEditor(content: string) {
  const options = {
    filename: "notes.txt",
    findHost: document.createElement("div"),
    hostPath: "/notes.txt",
    initial: { content, version: "v1" },
    onAsk: vi.fn(),
    onExternalChange: vi.fn(),
    onFind: vi.fn(),
    onStatus: vi.fn(),
    onUnsaveable: vi.fn(),
    parent: document.body.appendChild(document.createElement("div")),
    readOnly: false,
    variant: "text" as const,
    wrapLines: false,
  };
  const session = createCodeSession(options);
  open.push(session);
  return { options, session };
}

/** Lets the session's disk queue run what was put on it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  files.read.call.mockReset();
  files.write.call.mockReset();
  for (const session of open.splice(0)) {
    await session.destroy();
  }
  document.body.replaceChildren();
});

describe("a code editor whose file changes to an encoding it only reads", () => {
  // UTF-8 "café" written again in Windows-1252 reads as the same text.
  it("goes read only even when the text reads the same", async () => {
    const { options, session } = openEditor("café\n");
    files.read.call.mockResolvedValue({
      content: "café\n",
      saveable: false,
      version: "v1",
    });

    session.pull();
    await settle();

    expect(options.onUnsaveable).toHaveBeenCalledOnce();
    expect(session.view.state.readOnly).toBe(true);
    expect(options.onStatus).not.toHaveBeenCalledWith(
      "error",
      expect.anything(),
    );
  });

  it("keeps what was typed on screen, says it is unsaved, and never writes it", async () => {
    const { options, session } = openEditor("café\n");
    session.view.dispatch({ changes: { from: 4, insert: "!" } });
    files.read.call.mockResolvedValue({
      content: "café\n",
      saveable: false,
      version: "v2",
    });

    session.pull();
    await settle();
    session.retrySave();
    await session.flush();

    expect(session.view.state.doc.toString()).toBe("café!\n");
    expect(session.view.state.readOnly).toBe(true);
    expect(options.onStatus).toHaveBeenLastCalledWith(
      "error",
      CANT_SAVE_TEXT_FORMAT,
    );
    expect(files.write.call).not.toHaveBeenCalled();
  });
});
