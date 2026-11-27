import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { removeChatsDir } from "../../test/helpers/remove-chats-dir";
import { runTool } from "../../test/helpers/run-tool";
import { BashTool } from "../../tools/bash";

/** What the stand-in for LibreOffice does with a conversion: write the PDF, or nothing. */
const soffice = vi.hoisted(() => ({ writes: true }));

vi.mock(import("../office/install"), async (importOriginal) => ({
  ...(await importOriginal()),
  ensureOffice: () =>
    Promise.resolve({
      profileTemplate: "/nowhere",
      soffice: "/nowhere/soffice",
      source: "own" as const,
      version: "test",
    }),
}));

vi.mock(import("../office/run"), async (importOriginal) => ({
  ...(await importOriginal()),
  runSoffice: async (_install, args) => {
    const outDir = args[args.indexOf("--outdir") + 1] ?? "";
    const input = args.at(-1) ?? "";
    if (soffice.writes) {
      await fs.writeFile(
        path.join(outDir, `${path.parse(input).name}.pdf`),
        "%PDF-new",
      );
    }
    return { exitCode: 0, stderr: "", stdout: "" } as never;
  },
}));

const model = createMockAIGatewayModel();

describe("office render", () => {
  let chatRoot: string;
  let chatId: ChatId;

  beforeEach(async () => {
    soffice.writes = true;
    const tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), "office-"));
    chatRoot = path.join(tasksDir, `01k${"office".padEnd(23, "0")}`);
    await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
    chatId = createMockChatConfigForDir(chatRoot);
    await fs.writeFile(path.join(chatRoot, "work", "report.docx"), "docx");
  });

  afterEach(async () => {
    await removeChatsDir(path.dirname(chatRoot));
  });

  async function render() {
    const result = await runTool(BashTool, {
      chatId,
      input: { command: "office render work/report.docx", yieldMs: 30_000 },
      model,
      sessionId: StoreId.newSessionId(),
      signal: new AbortController().signal,
    });
    return result._unsafeUnwrap();
  }

  it("says it replaced a PDF of the same name that was there", async () => {
    await fs.writeFile(path.join(chatRoot, "work", "report.pdf"), "%PDF-old");
    // Older than the render, as a file a person saved earlier is.
    const earlier = new Date(Date.now() - 60_000);
    await fs.utimes(
      path.join(chatRoot, "work", "report.pdf"),
      earlier,
      earlier,
    );

    const { output } = await render();

    expect(output).toContain("(replaced the report.pdf that was there)");
  });

  it("fails when LibreOffice leaves the PDF that was there as it was", async () => {
    soffice.writes = false;
    await fs.writeFile(path.join(chatRoot, "work", "report.pdf"), "%PDF-old");

    const { exitCode, output } = await render();

    expect(exitCode).not.toBe(0);
    expect(output).toContain("LibreOffice wrote no new PDF;");
    expect(output).toContain("report.pdf is from before.");
  });
});
