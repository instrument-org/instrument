/**
 * Does the titler name a chat so it can be found again among the chats beside
 * it?
 *
 * The titler is one model call rather than an agent turn, so this boots the
 * workspace, seeds chats whose titles the new one has to stand apart from, and
 * calls the naming the app calls, at the two moments the app does: when the
 * first message is sent, and when the first exchange settles with a reply.
 *
 *   pnpm eval:chat-titles --model cf:zai-org/glm-5.3-flash --repeat 3
 *
 * The cases, each against the same seeded list:
 *
 * - `weather-again`: "What's the weather?" beside earlier weather chats gets a
 *   title none of them has, and no year, at both moments.
 * - `unique-topic`: a subject nothing else in the list shares gets no date.
 * - `content-free`: "hey" is still left unnamed.
 * - `retry`: a name handed back as taken comes back different.
 * - `assumed-details`: "when is daylight savings", answered for the user's
 *   city and this year, gets neither the city nor a year, at both moments.
 */
import "./lib/sandbox-home";
import "dotenv/config";
import "../scripts/lib/test-node-env";
import "../scripts/lib/define-globals-apply";

import {
  aiGatewayApp,
  AIGatewayModelURI,
  fetchModel,
  noopModelCache,
} from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { list } from "radashi";
import { ulid } from "ulid";
import { createActor } from "xstate";

import { CHATS_FOLDER_NAME } from "../src/constants";
import { attachChats, workspaceMachine } from "../src/electron";
import { createMemoryAppsConfig } from "../src/lib/apps/memory-config";
import { ensureChat } from "../src/lib/chat/chat-records";
import { renameChat } from "../src/lib/chat/chats";
import { followTitle } from "../src/lib/chat-folders/follow-title";
import { chatFolderNames } from "../src/lib/chat-folders/own-folder";
import { nameChat, nameKey } from "../src/lib/chat/chat-name";
import { generateTitleFromUserMessage } from "../src/lib/generate-title-from-user-message";
import { ChatWrites } from "../src/lib/chat-writes";
import { newMessage } from "../src/lib/new-message";
import { newDeviceId } from "../src/lib/records/device-id";
import { type ChatId } from "../src/schemas/chat-id";
import { type SessionMessage } from "../src/schemas/session/message";
import { StoreId } from "../src/schemas/store-id";
import { unavailableWebSearchClient } from "../src/schemas/web-search";
import { createStubBrowserConfig } from "../src/test/helpers/mock-chat-config";
import { type WorkspaceConfig } from "../src/types";
import { removeClaudeAccountLeftovers } from "./lib/claude-account-leftovers";
import { EVAL_MACHINE_DIR_NAME } from "./lib/run-record";
import {
  buildProviderConfigs,
  c,
  isPaidModel,
  modelURI,
  resolveRegistryDir,
  write,
} from "./utils";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    model: { multiple: true, type: "string" },
    paid: { default: false, type: "boolean" },
    repeat: { default: "3", type: "string" },
  },
});

const models = (values.model ?? []).map((model) => {
  if (model.includes("?")) {
    return model;
  }
  if (model.startsWith("cf:")) {
    return modelURI.workersAi(model.slice(3).replace(/^@cf\//, ""));
  }
  return modelURI.openRouter(model);
});
if (models.length === 0) {
  write(`${c.red}--model is required.${c.reset}\n`);
  process.exit(1);
}
if (!values.paid && models.some(isPaidModel)) {
  write(`${c.red}A metered model needs --paid.${c.reset}\n`);
  process.exit(1);
}
const repeat = Number(values.repeat);

/**
 * The person's earlier chats, newest last: the weather asked about on other
 * days under the names a titler gives it, among work that has nothing to do
 * with it.
 */
const SEEDS = [
  {
    ask: "best portable monitor for travel",
    title: "Best portable monitor for travel",
  },
  { ask: "What's the weather?", title: "Weather forecast" },
  {
    ask: "pull the totals out of these invoices",
    title: "Invoice totals from March and April",
  },
  { ask: "What's the weather?", title: "Current weather" },
  { ask: "why is my disk still full", title: "Why the disk is still full" },
  { ask: "What's the weather?", title: "Today's weather" },
  {
    ask: "summarize this for the board meeting",
    title: "Q3 report for the board meeting",
  },
  { ask: "What's the weather?", title: "Weather today" },
  { ask: "What's the weather?", title: "Weather check" },
  { ask: "What's the weather?", title: "Weather" },
  { ask: "What's the weather?", title: "Weather in Portland" },
];

/** What a reply that told the weather said. */
const WEATHER_REPLY =
  "Right now it's 64°F and sunny in Portland. It stays clear through this afternoon, with a high of 68°F, and rain moves in Friday morning.";

/** Words that put a day or a date on a title. */
const DATED =
  /\b(?:today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2})\b/i;

interface Outcome {
  evidence: string;
  passed: boolean;
}

interface Case {
  name: string;
  run: (context: CaseContext) => Promise<Outcome>;
}

interface CaseContext {
  ask: (
    prompt: string,
  ) => Promise<{ chatId: ChatId; message: SessionMessage.UserWithParts }>;
  model: Awaited<ReturnType<typeof modelFor>>;
  taken: (chatId: ChatId) => Promise<Set<string>>;
  workspaceConfig: WorkspaceConfig;
}

const CASES: Case[] = [
  {
    name: "weather-again",
    run: async ({ ask, model, taken, workspaceConfig }) => {
      const { chatId, message } = await ask("What's the weather?");
      const opening = await NAMER({ chatId, message, model, workspaceConfig });
      const settled = await NAMER({
        chatId,
        currentTitle: opening ?? undefined,
        message,
        model,
        reply: WEATHER_REPLY,
        workspaceConfig,
      });
      const names = await taken(chatId);
      // The year is true of every chat, so it tells this one apart from none.
      const collides = (title: string | null) =>
        title === null || names.has(nameKey(title)) || /\b\d{4}\b/.test(title);
      return {
        evidence: `opening: ${opening ?? "(none)"} · settled: ${settled ?? "(none)"}`,
        passed: !collides(opening) && !collides(settled),
      };
    },
  },
  {
    name: "unique-topic",
    run: async ({ ask, model, workspaceConfig }) => {
      const { chatId, message } = await ask(
        "make me a birthday card for my dad, he sails",
      );
      const opening = await NAMER({ chatId, message, model, workspaceConfig });
      const settled = await NAMER({
        chatId,
        currentTitle: opening ?? undefined,
        message,
        model,
        reply:
          'Here\'s a card with a sailboat on the front and "Fair winds, Dad" inside. I saved it as birthday-card.pdf.',
        workspaceConfig,
      });
      const dated = [opening, settled].some(
        (title) => title === null || DATED.test(title),
      );
      return {
        evidence: `opening: ${opening ?? "(none)"} · settled: ${settled ?? "(none)"}`,
        passed: !dated,
      };
    },
  },
  {
    name: "content-free",
    run: async ({ ask, model, workspaceConfig }) => {
      const { chatId, message } = await ask("hey");
      const opening = await NAMER({ chatId, message, model, workspaceConfig });
      return {
        evidence: `opening: ${opening ?? "(none)"}`,
        passed: opening === null,
      };
    },
  },
  {
    name: "retry",
    run: async ({ ask, model, workspaceConfig }) => {
      const { chatId, message } = await ask(
        "summarize this for the board meeting thursday",
      );
      const rejected = "Q3 report for the board meeting";
      const again = await NAMER({
        chatId,
        message,
        model,
        rejected,
        workspaceConfig,
      });
      return {
        evidence: `taken: ${rejected} · again: ${again ?? "(none)"}`,
        passed: again !== null && nameKey(again) !== nameKey(rejected),
      };
    },
  },
  {
    name: "assumed-details",
    run: async ({ ask, model, workspaceConfig }) => {
      const { chatId, message } = await ask("when is daylight savings");
      const opening = await NAMER({ chatId, message, model, workspaceConfig });
      const settled = await NAMER({
        chatId,
        currentTitle: opening ?? undefined,
        message,
        model,
        reply:
          "In Chicago, daylight saving time ends Sunday, November 1, 2026, and clocks go back one hour at 2 a.m. It starts again Sunday, March 14, 2027.",
        workspaceConfig,
      });
      // Before any reply, a day in the title is the titler answering the
      // question itself.
      const assumed =
        (opening !== null && DATED.test(opening)) ||
        [opening, settled].some(
          (title) => title === null || /\bchicago\b|\b\d{4}\b/i.test(title),
        );
      return {
        evidence: `opening: ${opening ?? "(none)"} · settled: ${settled ?? "(none)"}`,
        passed: !assumed,
      };
    },
  },
];

/**
 * The naming the app does: the recent titles shown, and a taken name handed
 * back once. A case that hands a name back itself (`rejected`) calls the
 * titler alone, to score that second try whatever the first one said.
 */
async function NAMER({
  rejected,
  ...args
}: {
  chatId: ChatId;
  currentTitle?: string;
  message: SessionMessage.UserWithParts;
  model: Awaited<ReturnType<typeof modelFor>>;
  rejected?: string;
  reply?: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<string | null> {
  const title =
    rejected === undefined
      ? await nameChat(args)
      : await generateTitleFromUserMessage({ ...args, rejected });
  if (title.isErr()) {
    write(`${c.dim}  no title: ${title.error.message}${c.reset}\n`);
  }
  return title.isOk() ? title.value : null;
}

async function modelFor(uri: string, workspaceConfig: WorkspaceConfig) {
  const model = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI: AIGatewayModelURI.Schema.parse(uri),
  });
  if (!model.ok) {
    throw model.error;
  }
  return model.value;
}

async function bootWorkspace(rootDir: string): Promise<WorkspaceConfig> {
  const providerConfigs = buildProviderConfigs();
  const machineDir = path.join(rootDir, EVAL_MACHINE_DIR_NAME);
  const actor = createActor(workspaceMachine, {
    input: {
      aiGatewayApp,
      apps: createMemoryAppsConfig(),
      appVersion: "0.0.0-test",
      browser: { ...createStubBrowserConfig(), hasNoWindow: true },
      captureException: (...args: unknown[]) => {
        console.error("captureException", ...args);
      },
      deviceId: newDeviceId(),
      getAIProviderConfigs: () => providerConfigs,
      modelCache: noopModelCache,
      nodeExecEnv: {},
      outputDir: rootDir,
      pnpmBinPath: "/usr/bin/false",
      registryDir: resolveRegistryDir(),
      rootDir,
      runtimeDir: path.join(rootDir, "runtime"),
      systemSkillsDir: path.resolve(import.meta.dirname, "../system-skills"),
      trashItem: () => Promise.reject(new Error("Not implemented")),
      userDataDir: machineDir,
      uvBinPath: "/usr/bin/false",
      webSearch: unavailableWebSearchClient,
      workFoldersDir: path.join(machineDir, "work"),
      workspaceMachineDir: machineDir,
    },
  });
  attachChats(actor);
  actor.start();
  const snapshot = actor.getSnapshot();
  if (snapshot.status === "error") {
    throw snapshot.error;
  }
  return snapshot.context.config;
}

/** Opens a chat with `prompt` the way a send does: its folder, then its first message. */
async function openChat(prompt: string, uri: string) {
  const sessionId = StoreId.newSessionId();
  const chatId = await ensureChat(sessionId, prompt);
  const sent = await newMessage({
    modelURI: AIGatewayModelURI.Schema.parse(uri),
    prompt,
    sessionId,
    chatId,
  });
  if (sent.isErr()) {
    throw sent.error;
  }
  const message = sent.value;
  (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
  return { chatId, message };
}

async function main() {
  const results: {
    case: string;
    evidence: string;
    model: string;
    passed: boolean;
  }[] = [];
  for (const uri of models) {
    const rootDir = path.join(os.tmpdir(), `instrument-title-evals-${ulid()}`);
    await fs.mkdir(rootDir, { recursive: true });
    const workspaceConfig = await bootWorkspace(rootDir);
    write(`${c.dim}Workspace :${c.reset} ${rootDir}\n`);
    for (const seed of SEEDS) {
      const { chatId } = await openChat(seed.ask, uri);
      await renameChat(chatId, seed.title);
      await followTitle(chatId, seed.title);
    }
    const model = await modelFor(uri, workspaceConfig);
    const chatsDir = path.join(rootDir, CHATS_FOLDER_NAME);
    const context: CaseContext = {
      ask: (prompt) => openChat(prompt, uri),
      model,
      // What the chat may not be called: every seeded title and every folder
      // but its own, the way the folder layer counts a collision.
      taken: async (chatId) => {
        const own = chatFolderNames(workspaceConfig.workspaceMachineDir).get(
          chatId,
        );
        const folders = (await fs.readdir(chatsDir)).filter(
          (name) => name !== own,
        );
        return new Set(
          [...SEEDS.map((seed) => seed.title), ...folders].map(nameKey),
        );
      },
      workspaceConfig,
    };
    const picked = CASES.filter(
      (evalCase) =>
        positionals.length === 0 ||
        positionals.some((pattern) => evalCase.name.includes(pattern)),
    );
    for (const evalCase of picked) {
      for (const trial of list(1, repeat)) {
        const outcome = await evalCase.run(context).catch((error: unknown) => ({
          evidence: `threw: ${error instanceof Error ? error.message : String(error)}`,
          passed: false,
        }));
        results.push({ case: evalCase.name, model: uri, ...outcome });
        write(
          `${outcome.passed ? c.green + "PASS" : c.red + "FAIL"}${c.reset} ${evalCase.name} #${trial.toString()} ${c.dim}${uri}${c.reset}\n  ${outcome.evidence}\n`,
        );
      }
    }
  }
  if (process.env.APP_CLAUDE_CODE_PATH) {
    await removeClaudeAccountLeftovers();
  }
  const resultsDir = path.join(import.meta.dirname, "..", "eval-results.local");
  await fs.mkdir(resultsDir, { recursive: true });
  const file = path.join(resultsDir, `chat-titles-${ulid()}.json`);
  await fs.writeFile(file, JSON.stringify(results, null, 2));
  const passed = results.filter((result) => result.passed).length;
  write(
    `\n${passed.toString()}/${results.length.toString()} passed · ${file}\n`,
  );
  process.exit(0);
}

await main();
