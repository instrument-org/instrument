import { type Worker } from "node:worker_threads";
import { mkdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { ok, standInDriver } from "../../test/helpers/computer-driver-stand-in";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createTsxBashWorker } from "../../test/helpers/tsx-bash-worker";
import { createRemoteBash, setBashWorkerFactory } from "../bash-worker/client";
import { type BashEnvOptions, createLocalBashEnv } from "../create-bash-env";
import { grantApp } from "../permissions/apps";
import { chatDir } from "../record-folders";

const WORKER_TIMEOUT_MS = 60_000;
const RUN = Math.random().toString(36).slice(2, 8);

const answers = {
  "list-apps": ok({
    apps: [
      {
        bundle_id: "com.apple.TextEdit",
        name: "TextEdit",
        pid: 501,
        presentation: "foreground",
      },
    ],
  }),
  "list-windows": ok([
    { accessible: true, id: "w-1", pid: 501, title: "Untitled" },
  ]),
  snapshot: ok({
    snapshot_id: "s1abc",
    tree: { name: "Untitled", role: "window" },
  }),
};

const workers: Worker[] = [];
const chatId = createMockChatConfig(
  ChatIdSchema.parse(`computer-shell-${RUN}`),
);

beforeAll(async () => {
  await mkdir(chatDir(chatId), { recursive: true });
  setBashWorkerFactory((workerOptions) => {
    const worker = createTsxBashWorker(workerOptions);
    workers.push(worker);
    return worker;
  });
});

afterAll(async () => {
  await Promise.all(workers.map((worker) => worker.terminate()));
});

const options = (): BashEnvOptions => ({
  chatId,
  role: "chat",
  sessionId: StoreId.newSessionId(),
});

/**
 * The agent's shell runs in the bash worker, which has none of the host's live
 * config and builds `instrument` only to send the call back to this thread.
 */
describe.each([
  ["on this thread", () => createLocalBashEnv(options())],
  [
    "in the bash worker",
    () => {
      const bashOptions = options();
      return Promise.resolve(
        createRemoteBash(bashOptions, () => createLocalBashEnv(bashOptions)),
      );
    },
  ],
])(
  "instrument computer %s",
  { timeout: WORKER_TIMEOUT_MS },
  (_where, shell) => {
    const run = async (command: string) =>
      (await shell()).exec(command, {
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      });

    it("is listed once its flag is on, and reads a granted app", async () => {
      const driver = standInDriver(answers);
      await grantApp(chatId, "com.apple.TextEdit");
      expect((await run("instrument help")).stdout).toContain("computer");
      const read = await run("instrument computer snapshot TextEdit");
      expect(read).toMatchObject({ exitCode: 0, stderr: "" });
      expect(read.stdout).toContain('window "Untitled"');
      expect(driver.actions().at(-1)?.[0]).toBe("snapshot");
    });

    it("is left out of the listing while its flag is off", async () => {
      standInDriver(answers, { enabled: false });
      expect((await run("instrument help")).stdout).not.toContain("computer");
      const refused = await run("instrument computer apps");
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("not available on this computer");
    });
  },
);
