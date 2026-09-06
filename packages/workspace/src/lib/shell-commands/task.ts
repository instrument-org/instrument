import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { type ByteString, defineCommand } from "just-bash";
import ms from "ms";
import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { publisher } from "../../rpc/publisher";
import { StoreId } from "../../schemas/store-id";
import { type Task } from "../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { type BrowserTargetId, encodeBrowserTargetId } from "../../types";
import { absolutePathJoin } from "../absolute-path-join";
import {
  describeConnection,
  isConnected,
  readConnection,
} from "../apps/connection";
import { loadApp } from "../apps/store";
import { defaultTaskName } from "../default-task-name";
import { getTask } from "../get-tasks";
import { initializeTask } from "../initialize-task";
import { newMessage } from "../new-message";
import { newTaskId } from "../new-task-id";
import { isWorking } from "../orchestrator/activity";
import { listChildTasks } from "../orchestrator/children";
import {
  lastAssistantText,
  latestOrNewSessionId,
  latestSessionId,
} from "../orchestrator/latest-session";
import { listRunnableModels, modelTable } from "../orchestrator/models";
import { expectStop } from "../orchestrator/wake";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { recordTaskActivity, updateTaskSettings } from "../task-settings";
import { trashTask } from "../trash-task";
import { getTaskUsageSummary } from "../usage-summary";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { getWorkspaceConfig } from "../workspace-config";
import { effectiveFolderAccess } from "../workspace-fs-layout";
import { parseFlags, resolveFolders } from "./task-args";
import { TASK_COMMAND } from "./task-command";
import { subprocessStdin } from "./utils";

export { TASK_COMMAND } from "./task-command";

/** What `task` needs from the `bash` call it runs inside. */
export interface TaskCommandContext {
  /** The orchestrator whose tasks these are. Every subcommand is scoped to it. */
  orchestratorTaskId: TaskId;
  /** What is left of the enclosing call's yield window, read when a wait starts. */
  remainingYieldMs: () => number;
}

const DEFAULT_LOG_TAIL_LINES = 120;
const LOG_MAX_BYTES = 24 * 1024;
const OUTPUT_LISTING_MAX = 30;
const SHOW_SUMMARY_MAX_LENGTH = 600;
/** Held back from the yield window so a wait returns inside it. */
const WAIT_MARGIN_MS = 500;
const MAX_WAIT_MS = ms("10 minutes");

const USAGE = `Usage: ${TASK_COMMAND.name} <subcommand> ...

  ${TASK_COMMAND.name} new --name '<title>' [--model <uri>] [--folder <mount>[/<folder>][:rw|:ro]]... [--app <slug>]... [--tab <id>] <<'EOF'
  <prompt>
  EOF
      Create a task and start it. The prompt is its whole brief: it knows nothing
      about this conversation. Give it on stdin with a quoted heredoc, as shown,
      so the shell leaves it alone: inside double quotes a $800 becomes 00. The
      title takes single quotes for the same reason. Folders are mounts under
      ${MOUNT.attachedFolders} in this conversation, or a folder inside one, named with or
      without the prefix; a task sees none unless named here, with the access
      this conversation has unless :ro narrows it. --app hands the task a
      connected app, by slug; it gets the \`app\` command for that app and no
      other. --tab hands the task one of the user's browser tabs, by the id the
      note on their message gives; its browser is then that tab, page and all.
      Prints the task id. You are told when it finishes a turn; do not poll it.
  ${TASK_COMMAND.name} send <id> <<'EOF'
  <message>
  EOF
      Deliver a message into a task: it runs now if idle, after its current turn
      if busy. Follow-ups, corrections, answers to its questions. Same heredoc.
  ${TASK_COMMAND.name} stop <id>
      Interrupt a running task. Follow with send to redirect it.
  ${TASK_COMMAND.name} list [--running]
      Your tasks, newest activity first: id, status, last activity, title.
  ${TASK_COMMAND.name} show <id>
      Status, model, folders, output files, and what it last said.
  ${TASK_COMMAND.name} log <id> [--tail <lines>]
      Its transcript, last ${DEFAULT_LOG_TAIL_LINES} lines by default. Composes: \`${TASK_COMMAND.name} log <id> | rg error\`.
  ${TASK_COMMAND.name} model <id> <uri>
      The model its next turn runs on.
  ${TASK_COMMAND.name} models [--author <name>]
      Every model you can run, newest first: release date, context window, price
      in dollars per million tokens in and out, what it takes besides text, and
      tags. Long; pipe it through head or rg.
  ${TASK_COMMAND.name} wait <id> [--timeout <ms>]
      Block until it finishes or the timeout, whichever comes first. Rarely the
      right call: you are woken when it finishes anyway.
  ${TASK_COMMAND.name} rename <id> '<title>'
      Give a task a better title.
  ${TASK_COMMAND.name} archive <id>
      Move a finished task to the trash.
`;

export function createTaskCommand(context: TaskCommandContext) {
  return defineCommand(TASK_COMMAND.name, async (args, ctx) => {
    const [subcommand, ...rest] = args;
    // \`task new --help\` asks about the command; it does not name a task.
    if (rest.includes("--help") || rest.includes("-h")) {
      return ok(USAGE);
    }
    try {
      switch (subcommand) {
        case "--help":
        case "-h":
        case "help":
        case undefined: {
          return ok(USAGE);
        }
        case "archive": {
          return await runArchive(rest, context);
        }
        case "list": {
          return await runList(rest, context);
        }
        case "log": {
          return await runLog(rest, context);
        }
        case "model": {
          return await runModel(rest, context);
        }
        case "models": {
          return await runModels(rest);
        }
        case "new": {
          return await runNew(rest, context, ctx.stdin);
        }
        case "rename": {
          return await runRename(rest, context);
        }
        case "send": {
          return await runSend(rest, context, ctx.stdin);
        }
        case "show": {
          return await runShow(rest, context);
        }
        case "stop": {
          return await runStop(rest, context);
        }
        case "wait": {
          return await runWait(rest, context, ctx.signal);
        }
        default: {
          return fail(`unknown subcommand "${subcommand}".\n\n${USAGE}`);
        }
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

function fail(message: string) {
  return {
    exitCode: 1,
    stderr: `${TASK_COMMAND.name}: ${message}\n`,
    stdout: "",
  };
}

async function listOutputs(taskId: TaskId): Promise<string[]> {
  const outputDir = absolutePathJoin(taskDir(taskId), TASK_FOLDER_NAMES.output);
  try {
    const entries = await fs.readdir(outputDir, {
      recursive: true,
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.posix.join(
          MOUNT.tasks,
          taskId,
          TASK_FOLDER_NAMES.output,
          path.relative(outputDir, path.join(entry.parentPath, entry.name)),
        ),
      )
      .sort()
      .slice(0, OUTPUT_LISTING_MAX);
  } catch {
    return [];
  }
}

function ok(stdout: string) {
  return { exitCode: 0, stderr: "", stdout };
}

/**
 * The prompt a subcommand was given: what came on stdin when anything did,
 * else the inline argument. Stdin is the documented route because a quoted
 * heredoc is the one form the shell leaves alone: a `$800` inside double
 * quotes is expanded to `00` before the command ever sees it, and a brief
 * with an apostrophe in it cannot be single-quoted without escaping.
 */
function promptFrom(inline: string, stdin: ByteString): string {
  const piped = subprocessStdin(stdin)?.toString("utf8").trim();
  return (piped || inline).trim();
}

/**
 * A brief that tells the task to use an app the command did not hand it is
 * refused, with the flag to add: the task would fail on its first call and
 * wake the orchestrator about it, which is a turn spent on what this catches.
 */
function requireAppsNamedInBrief(prompt: string, apps: string[]) {
  const named = new Set(
    [...prompt.matchAll(/\bapp (?:call|request|tools|guide) ([a-z0-9][a-z0-9-]*)/g)].map(
      (match) => match[1] ?? "",
    ),
  );
  const missing = [...named].filter((slug) => slug && !apps.includes(slug));
  if (missing.length > 0) {
    throw new Error(
      `the brief tells the task to use ${missing.map((slug) => `"${slug}"`).join(", ")}, but a task reaches only the apps handed to it on the command. Add ${missing.map((slug) => `--app ${slug}`).join(" ")}.`,
    );
  }
}

async function requireChild(
  rawId: string | undefined,
  { orchestratorTaskId }: TaskCommandContext,
): Promise<Task> {
  if (!rawId) {
    throw new Error("a task id is required. See `task list`.");
  }
  const parsed = TaskIdSchema.safeParse(rawId);
  if (!parsed.success) {
    throw new Error(`"${rawId}" is not a task id. See \`task list\`.`);
  }
  const task = await getTask(parsed.data, getWorkspaceConfig());
  if (task.isErr() || task.value.parentTaskId !== orchestratorTaskId) {
    throw new Error(`no task "${rawId}" of yours. See \`task list\`.`);
  }
  return task.value;
}

/**
 * The apps a task is handed, each checked to be connected now: a task given
 * an app that cannot answer would fail on its first call and wake the
 * orchestrator about it, which is a turn wasted on what this catches.
 */
async function resolveApps(slugs: string[]): Promise<string[]> {
  const appsDir = getWorkspaceConfig().appsDir;
  const apps: string[] = [];
  for (const slug of slugs) {
    const loaded = await loadApp(appsDir, slug);
    if (loaded.isErr()) {
      throw new Error(`--app ${slug}: ${loaded.error.message}`);
    }
    const connection = await readConnection(loaded.value.slug);
    if (!isConnected(connection, loaded.value.manifestHash)) {
      throw new Error(
        `--app ${slug}: it is ${describeConnection(connection, loaded.value.manifestHash)}. Connect it first.`,
      );
    }
    if (!apps.includes(loaded.value.slug)) {
      apps.push(loaded.value.slug);
    }
  }
  return apps;
}

async function resolveModel(rawURI: string) {
  const parsed = AIGatewayModelURI.Schema.safeParse(rawURI);
  if (!parsed.success) {
    throw new Error(`"${rawURI}" is not a model URI.`);
  }
  const workspaceConfig = getWorkspaceConfig();
  const result = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI: parsed.data,
  });
  if (!result.ok) {
    throw new Error(`model ${rawURI}: ${result.error.message}`);
  }
  return { model: result.value, modelURI: parsed.data };
}

/**
 * A tab id from the note on the user's message is the session half of one of
 * the orchestrator's own browser targets; the target has to exist, since the
 * task connects to it rather than creating anything.
 */
function resolveTab(tab: string, orchestratorTaskId: TaskId): BrowserTargetId {
  const sessionId = StoreId.SessionSchema.safeParse(tab);
  if (!sessionId.success) {
    throw new Error(
      `"${tab}" is not a tab id; the note on the user's message lists them.`,
    );
  }
  const targetId = encodeBrowserTargetId(orchestratorTaskId, sessionId.data);
  if (!getWorkspaceConfig().browser.getTargetMeta(targetId)) {
    throw new Error(`Tab ${tab} is not open any more.`);
  }
  return targetId;
}

async function runArchive(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const result = await trashTask({
    id: task.id,
    workspaceConfig: getWorkspaceConfig(),
    workspaceRef: getWorkspaceActorRef(),
  });
  if (result.isErr()) {
    throw result.error;
  }
  return ok(`Archived ${task.id} ("${task.title}").\n`);
}

async function runList(args: string[], context: TaskCommandContext) {
  const children = await listChildTasks(context.orchestratorTaskId);
  const rows: string[][] = [];
  for (const task of children) {
    const running = isWorking(task.id);
    if (args.includes("--running") && !running) {
      continue;
    }
    rows.push([
      task.id,
      running ? "running" : "idle",
      `${ms(Math.max(1000, Date.now() - task.updatedAt.getTime()))} ago`,
      task.title,
    ]);
  }
  if (rows.length === 0) {
    return ok(
      args.includes("--running")
        ? "No tasks running.\n"
        : "No tasks yet. Create one with `task new`.\n",
    );
  }
  const widths = [0, 1, 2].map((column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  return ok(
    `${rows
      .map((row) =>
        row
          .map((cell, column) =>
            column === 3 ? cell : cell.padEnd(widths[column] ?? 0),
          )
          .join("  "),
      )
      .join("\n")}\n`,
  );
}

async function runLog(args: string[], context: TaskCommandContext) {
  const { positional, values } = parseFlags(args, {
    flags: ["tail"],
    repeatable: [],
  });
  const task = await requireChild(positional[0], context);
  const tailRaw = values.get("tail")?.[0];
  const tail =
    tailRaw === undefined
      ? DEFAULT_LOG_TAIL_LINES
      : Number.parseInt(tailRaw, 10);
  if (!Number.isFinite(tail) || tail <= 0) {
    throw new Error("--tail takes a number of lines.");
  }
  const sessionId = await latestSessionId(task.id);
  if (sessionId.isErr()) {
    throw sessionId.error;
  }
  if (!sessionId.value) {
    return ok(`${task.id} has no transcript yet.\n`);
  }
  // Loaded here rather than at the top: the renderer imports the tool registry,
  // which imports the bash tool, which imports this command, so a static import
  // would close a cycle that leaves the registry half-built when it is read.
  const { getSessionMarkdown } = await import("../session-to-markdown");
  const markdown = await getSessionMarkdown({
    includeContextMessages: false,
    sessionId: sessionId.value,
    taskId: task.id,
  });
  const lines = markdown.trimEnd().split("\n");
  const omitted = Math.max(0, lines.length - tail);
  let text = lines.slice(-tail).join("\n");
  if (text.length > LOG_MAX_BYTES) {
    text = `[...${text.length - LOG_MAX_BYTES} earlier characters omitted]\n${text.slice(-LOG_MAX_BYTES)}`;
  }
  const header =
    omitted > 0
      ? `[${omitted} earlier lines omitted; raise --tail to see more]\n`
      : "";
  return ok(`${header}${text}\n`);
}

async function runModel(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const rawURI = args[1];
  if (!rawURI) {
    throw new Error("model: a model URI is required.");
  }
  const { modelURI } = await resolveModel(rawURI);
  await setTaskState(taskDir(task.id), { selectedModelURI: modelURI });
  return ok(`${task.id} will run its next turn on ${modelURI}.\n`);
}

async function runModels(args: string[]) {
  const { values } = parseFlags(args, { flags: ["author"], repeatable: [] });
  const author = values.get("author")?.[0]?.toLowerCase();
  const runnable = await listRunnableModels();
  const models = runnable.filter(
    (model) => author === undefined || model.author.toLowerCase() === author,
  );
  if (models.length === 0) {
    return ok(
      author === undefined
        ? "No models are configured.\n"
        : `No models by ${author}. Drop --author to see every author.\n`,
    );
  }
  return ok(modelTable(models));
}

async function runNew(
  args: string[],
  context: TaskCommandContext,
  stdin: ByteString,
) {
  const { positional, values } = parseFlags(args, {
    flags: ["app", "folder", "model", "name", "tab"],
    repeatable: ["app", "folder"],
  });
  const prompt = promptFrom(positional.join(" "), stdin);
  if (!prompt) {
    throw new Error(
      `new: a brief is required, on stdin through a quoted heredoc.\n\n${USAGE}`,
    );
  }
  const workspaceConfig = getWorkspaceConfig();
  const orchestratorState = await getTaskState(
    taskDir(context.orchestratorTaskId),
  );
  const rawURI = values.get("model")?.[0] ?? orchestratorState.selectedModelURI;
  if (!rawURI) {
    throw new Error(
      "new: no model. This conversation has not chosen one yet; pass --model <uri>.",
    );
  }
  const { model, modelURI } = await resolveModel(rawURI);
  const folders = resolveFolders(
    values.get("folder") ?? [],
    orchestratorState.attachedFolders ?? {},
  );
  const name = values.get("name")?.[0]?.trim() || defaultTaskName(prompt);
  const tab = values.get("tab")?.[0];
  const browserTargetId =
    tab === undefined ? undefined : resolveTab(tab, context.orchestratorTaskId);
  const apps = await resolveApps(values.get("app") ?? []);
  requireAppsNamedInBrief(prompt, apps);

  const taskId = await newTaskId({ prompt, workspaceConfig });
  const initialized = await initializeTask(
    {
      initialSettings: {
        apps,
        kind: "task",
        name,
        parentTaskId: context.orchestratorTaskId,
      },
      taskId,
      workspaceConfig,
    },
    {},
  );
  if (initialized.isErr()) {
    throw initialized.error;
  }
  if (browserTargetId) {
    await setTaskState(taskDir(taskId), { browserTargetId });
  }
  const session = await latestOrNewSessionId(taskId);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  const message = await newMessage({
    folders: folders.length > 0 ? folders : undefined,
    model,
    modelURI,
    prompt,
    sessionId,
    taskId,
  });
  if (message.isErr()) {
    throw message.error;
  }

  publisher.publish("task.updated", { id: taskId });
  getWorkspaceActorRef().send({
    type: "createSession",
    value: {
      agentName: "main",
      id: taskId,
      message: message.value,
      model,
      sessionId,
    },
  });
  await recordTaskActivity(taskId);

  return ok(
    `Created ${taskId} ("${name}"). It is running now.\nYou will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`,
  );
}

async function runRename(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const title = args.slice(1).join(" ").trim();
  if (!title) {
    throw new Error("rename takes the new title after the id.");
  }
  const result = await updateTaskSettings(task.id, { name: title });
  if (result.isErr()) {
    throw result.error;
  }
  publisher.publish("task.updated", { id: task.id });
  return ok(`Renamed ${task.id} to "${title}".\n`);
}

async function runSend(
  args: string[],
  context: TaskCommandContext,
  stdin: ByteString,
) {
  const task = await requireChild(args[0], context);
  const prompt = promptFrom(args.slice(1).join(" "), stdin);
  if (!prompt) {
    throw new Error(
      "send: a message is required, on stdin through a quoted heredoc.",
    );
  }
  const state = await getTaskState(taskDir(task.id));
  const orchestratorState = await getTaskState(
    taskDir(context.orchestratorTaskId),
  );
  const rawURI = state.selectedModelURI ?? orchestratorState.selectedModelURI;
  if (!rawURI) {
    throw new Error("send: the task has no model; set one with `task model`.");
  }
  const { model, modelURI } = await resolveModel(rawURI);
  const session = await latestOrNewSessionId(task.id);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  const message = await newMessage({
    model,
    modelURI,
    prompt,
    sessionId,
    taskId: task.id,
  });
  if (message.isErr()) {
    throw message.error;
  }
  const running = isWorking(task.id);
  // Written now, so the task's transcript shows it the moment it was sent.
  const written = await Store.saveMessageWithParts(message.value, task.id);
  if (written.isErr()) {
    throw written.error;
  }
  getWorkspaceActorRef().send({
    type: "addMessage",
    value: {
      agentName: "main",
      id: task.id,
      message: message.value,
      model,
      saved: true,
      sessionId,
    },
  });
  await recordTaskActivity(task.id);
  return ok(
    running
      ? `Sent to ${task.id}. It is busy and will hear this at its next step; you will be told when its turn finishes.\n`
      : `Sent to ${task.id}. It is running now; you will be told when it finishes.\n`,
  );
}

async function runShow(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const state = await getTaskState(taskDir(task.id));
  const running = isWorking(task.id);
  const folders = Object.values(state.attachedFolders ?? {}).map(
    (folder) =>
      `${MOUNT.attachedFolders}/${folder.mountName} (${effectiveFolderAccess(folder)})`,
  );
  const outputs = await listOutputs(task.id);
  const sessionId = await latestSessionId(task.id);
  const lastSaid =
    sessionId.isOk() && sessionId.value
      ? await lastAssistantText({
          maxLength: SHOW_SUMMARY_MAX_LENGTH,
          sessionId: sessionId.value,
          taskId: task.id,
        })
      : undefined;

  const usage = await getTaskUsageSummary(task.id);
  const lines = [
    `${task.id}: "${task.title}"`,
    `status: ${running ? "running" : "idle"}`,
    `last activity: ${ms(Math.max(1000, Date.now() - task.updatedAt.getTime()))} ago`,
    `spent: ${ms(Math.max(1000, usage.activeMs), { long: true })} of work, ${usage.inputTokens + usage.outputTokens} tokens`,
    `model: ${state.selectedModelURI ?? "(none yet)"}`,
    `folders: ${folders.length > 0 ? folders.join(", ") : "none"}`,
    `scratch: ${MOUNT.tasks}/${task.id}`,
    `outputs: ${outputs.length > 0 ? `\n  ${outputs.join("\n  ")}` : "none yet"}`,
    `last said: ${lastSaid ? `\n  ${lastSaid.replaceAll("\n", "\n  ")}` : "nothing yet"}`,
  ];
  return ok(`${lines.join("\n")}\n`);
}

async function runStop(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const running = isWorking(task.id);
  if (!running) {
    return ok(`${task.id} is not running.\n`);
  }
  // The wake would report the turn this ends as a finish; it is not news.
  expectStop(task.id);
  getWorkspaceActorRef().send({ type: "stopSessions", value: { id: task.id } });
  return ok(
    `Stopping ${task.id}. Its turn ends where it is; \`task send\` gives it the next thing to do.\n`,
  );
}

async function runWait(
  args: string[],
  context: TaskCommandContext,
  signal: AbortSignal | undefined,
) {
  const { positional, values } = parseFlags(args, {
    flags: ["timeout"],
    repeatable: [],
  });
  const task = await requireChild(positional[0], context);
  const requestedRaw = values.get("timeout")?.[0];
  const requested =
    requestedRaw === undefined ? undefined : Number.parseInt(requestedRaw, 10);
  if (requested !== undefined && !Number.isFinite(requested)) {
    throw new Error("--timeout takes a number of milliseconds.");
  }
  const budget = Math.max(
    0,
    Math.min(MAX_WAIT_MS, context.remainingYieldMs() - WAIT_MARGIN_MS),
  );
  const timeoutMs =
    requested === undefined ? budget : Math.min(requested, budget);

  if (!isWorking(task.id)) {
    return ok(`${task.id} is not running.\n`);
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const startedAt = Date.now();
  try {
    for await (const payload of publisher.subscribe("session.done", {
      signal: combined,
    })) {
      if (payload.id === task.id && !payload.parentSessionId) {
        return ok(
          `${task.id} finished after ${ms(Math.max(1000, Date.now() - startedAt), { long: true })}. Read it with \`task show ${task.id}\` or \`task log ${task.id}\`.\n`,
        );
      }
    }
  } catch (error) {
    if (!combined.aborted) {
      throw error;
    }
  }
  return ok(
    `${task.id} is still running after ${ms(Math.max(1000, Date.now() - startedAt), { long: true })}. You will be told when it finishes; there is no need to wait again.\n`,
  );
}
