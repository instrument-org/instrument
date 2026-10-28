import { mkdir } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { createLocalBashEnv } from "../create-bash-env";
import { chatDir } from "../record-folders";

const chatId = ChatIdSchema.parse("role-split");

beforeAll(async () => {
  knowChat(chatId);
  await mkdir(chatDir(chatId), { recursive: true });
});

async function shell(role: "chat" | "task", command: string) {
  const bash = await createLocalBashEnv({
    chatId,
    role,
    sessionId: StoreId.newSessionId(),
  });
  return bash.exec(command);
}

// A chat and its tasks run one agent with one prompt; what sets a task's
// shell apart is the role each capability names, checked on every surface.
describe("a task's instrument", () => {
  it("lists no task command, and refuses one with what to do instead", async () => {
    const listed = await shell("task", "instrument");
    expect(listed.stdout).not.toMatch(/^ {2}task /m);
    expect(listed.stdout).toMatch(/^ {2}memory /m);

    const refused = await shell("task", "instrument task list");
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatchInlineSnapshot(`
      "instrument task: only the chat starts and steers tasks. Do the work here, and say in your report what is left.
      "
    `);
  });

  it("lists the task command in the chat's shell", async () => {
    expect((await shell("chat", "instrument")).stdout).toMatch(/^ {2}task /m);
  });

  it("reads memories and refuses to keep one", async () => {
    expect((await shell("task", "instrument memory list")).exitCode).toBe(0);
    const saved = await shell(
      "task",
      "instrument memory save decaf <<'EOF'\nOnly decaf.\nEOF",
    );
    expect(saved.exitCode).toBe(1);
    expect(saved.stderr).toContain("only the chat saves and forgets memories");
  });

  it("reaches the reads from a script, and nothing that changes them", async () => {
    const result = await shell(
      "task",
      `node --input-type=module <<'EOF'
console.log(JSON.stringify(await instrument.memory.list()));
const calls = {
  "memory.save": () => instrument.memory.save({ name: "decaf", text: "Only decaf." }),
  "window.show": () => instrument.window.show({ targets: ["https://example.com/"] }),
  "task.new": () => instrument.task.new({ brief: "Do it." }),
};
for (const [name, call] of Object.entries(calls)) {
  try {
    await call();
    console.log(name, "ran");
  } catch (error) {
    console.log(name, error.message);
  }
}
EOF`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "[]
      memory.save there is no capability "memory.save".
      window.show there is no capability "window.show".
      task.new there is no capability "task.new".
      "
    `);
  });
});
