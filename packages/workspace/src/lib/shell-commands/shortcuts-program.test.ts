import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { openAsks } from "../chat/open-asks";
import { createLocalBashEnv } from "../create-bash-env";
import { seatbeltAvailable } from "../native-sandbox";
import { grantApp } from "../permissions/apps";
import { chatDir } from "../record-folders";

/**
 * macOS's own `shortcuts`, run for real: `list` only, which reads the
 * person's shortcuts and runs none of them. Held to Shortcuts' app rule
 * twice over: the shell asks for the app before starting it, and the
 * Seatbelt profile closes the services it needs until the app is allowed,
 * so a program that starts it some other way gets nothing either.
 */
const SHORTCUTS = "/usr/bin/shortcuts";

// The mock workspace outlives a run, so each run's chat is its own.
const RUN = Math.random().toString(36).slice(2, 8);

describe.runIf(
  process.platform === "darwin" && existsSync(SHORTCUTS) && seatbeltAvailable(),
)("shortcuts", () => {
  it("asks for Shortcuts, and works once it is allowed", async () => {
    const chatId = createMockChatConfig(
      ChatIdSchema.parse(`shortcuts-program-${RUN}`),
    );
    await mkdir(chatDir(chatId), { recursive: true });
    const shell = () =>
      createLocalBashEnv({
        chatId,
        role: "chat",
        sessionId: StoreId.newSessionId(),
      });
    const run = async (command: string) =>
      (await shell()).exec(command, { signal: AbortSignal.timeout(30_000) });

    const asked = await run("shortcuts list");
    expect(asked.exitCode).toBe(1);
    expect(asked.stderr).toBe(
      "shortcuts: refused: using Shortcuts needs the person's yes. If the work needs it, ask for Shortcuts with ask_permission.\n",
    );
    expect(await openAsks(chatId)).toEqual([]);
    const around = await run(`/bin/sh -c '${SHORTCUTS} list'`);
    expect(around.exitCode).not.toBe(0);
    expect(around.stderr).toContain(
      "Couldn’t communicate with a helper application.",
    );

    await grantApp(chatId, "Shortcuts");
    const allowed = await run("shortcuts list");
    expect(allowed).toMatchObject({ exitCode: 0, stderr: "" });
    expect((await run(`/bin/sh -c '${SHORTCUTS} list'`)).exitCode).toBe(0);
  }, 60_000);
});
