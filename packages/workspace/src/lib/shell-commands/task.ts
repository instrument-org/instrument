import {
  type AIGatewayModel,
  AIGatewayModelURI,
  fetchModel,
  REASONING_EFFORTS,
} from "@instrument-org/ai-gateway";
import { type ByteString, defineCommand } from "just-bash";
import ms from "ms";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { publisher } from "../../rpc/publisher";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { StoreId } from "../../schemas/store-id";
import { type Task } from "../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
  encodeBrowserTargetId,
} from "../../types";
import { absolutePathJoin } from "../absolute-path-join";
import {
  describeConnection,
  isConnected,
  readConnection,
} from "../apps/connection";
import { loadApp } from "../apps/store";
import { attachFolder, detachFolder } from "../attach-folder";
import {
  killBackgroundProcess,
  listTaskBackgroundProcesses,
} from "../background-processes";
import { defaultTaskName } from "../default-task-name";
import { getTask } from "../get-tasks";
import { initializeTask } from "../initialize-task";
import { newMessage } from "../new-message";
import { newTaskId } from "../new-task-id";
import { isWorking, leftRunning } from "../orchestrator/activity";
import { recordTaskChannel } from "../orchestrator/attribution";
import { listChildTasks } from "../orchestrator/children";
import {
  lastAssistantText,
  latestOrNewSessionId,
  latestSessionId,
} from "../orchestrator/latest-session";
import { describeLeftRunning } from "../orchestrator/left-running";
import {
  listRunnableModels,
  modelTable,
  ownProviderConfigId,
} from "../orchestrator/models";
import {
  type FolderMounts,
  mountPathOf,
  mountsOf,
  translateMountPaths,
} from "../orchestrator/mount-paths";
import { outputFolderPath } from "../orchestrator/output-folder";
import { expectStop } from "../orchestrator/wake";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import {
  getTaskSettings,
  recordTaskActivity,
  updateTaskSettings,
} from "../task-settings";
import { trashTask } from "../trash-task";
import { getTaskUsageSummary } from "../usage-summary";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { getWorkspaceConfig } from "../workspace-config";
import { effectiveFolderAccess } from "../workspace-fs-layout";
import {
  parseFlags,
  parseFolderSpec,
  requireFoldersOnDisk,
  resolveFolders,
} from "./task-args";
import { TASK_COMMAND } from "./task-command";
import { searchTaskContent } from "./task-content-search";
import {
  formatAge,
  parseListDate,
  renderTaskList,
  renderTaskSearch,
  selectTasks,
  TASK_LIST_WINDOW,
  type TaskListQuery,
  type TaskListRow,
  type TaskSearchRow,
} from "./task-list-output";
import { subprocessStdin } from "./utils";

export { TASK_COMMAND } from "./task-command";

/** What `task` needs from the `bash` call it runs inside. */
export interface TaskCommandContext {
  /** The orchestrator whose tasks these are. Every subcommand is scoped to it. */
  orchestratorTaskId: TaskId;
  /** What is left of the enclosing call's yield window, read when a wait starts. */
  remainingYieldMs: () => number;
  /**
   * The channel this command is running in, recorded on every task it makes so
   * the outcome comes back where it was asked for. Absent where the command is
   * built outside a turn, which leaves a task unattributed rather than wrong.
   */
  sessionId?: StoreId.Session;
}

const DEFAULT_LOG_TAIL_LINES = 120;
const LOG_MAX_BYTES = 24 * 1024;
const OUTPUT_LISTING_MAX = 30;
const SHOW_SUMMARY_MAX_LENGTH = 600;
/** Held back from the yield window so a wait returns inside it. */
const WAIT_MARGIN_MS = 500;
const MAX_WAIT_MS = ms("10 minutes");

const USAGE = `Usage: ${TASK_COMMAND.name} <subcommand> ...

  ${TASK_COMMAND.name} new --name '<title>' [--model <uri>] [--effort <level>] [--folder <mount>[/<folder>][:rw|:ro]]... [--app <slug>]... [--tab <id>] <<'EOF'
  <prompt>
  EOF
      Create a task and start it. The prompt is its whole brief: it knows nothing
      about this conversation. Give it on stdin with a quoted heredoc, as shown,
      so the shell leaves it alone: inside double quotes a $800 becomes 00. The
      title takes single quotes for the same reason. Every task has the workspace
      folder, ${MOUNT.attachedFolders}/Instrument, read and write, without being asked:
      its results go there unless the brief says where else. Other folders are
      mounts under ${MOUNT.attachedFolders} in this conversation, or a folder inside one,
      named with or without the prefix; a task sees none unless named here,
      with the access this conversation has unless :ro narrows it. --app hands the task a
      connected app, by slug; it gets the \`app\` command for that app and no
      other. --tab hands the task one of the user's browser tabs, by the id the
      note on their message gives; its browser is then that tab, page and all.
      --effort is how hard its model thinks, one of ${REASONING_EFFORTS.join(", ")};
      \`${TASK_COMMAND.name} models\` says which levels each model takes and its default. The same
      brief at two levels is two tasks, which is how a level is compared.
      Prints the task id. You are told when it finishes a turn; do not poll it.
  ${TASK_COMMAND.name} send <id> <<'EOF'
  <message>
  EOF
      Deliver a message into a task: it runs now if idle, after its current turn
      if busy. Follow-ups, corrections, answers to its questions. Same heredoc.
  ${TASK_COMMAND.name} stop <id>
      Interrupt a running task. Follow with send to redirect it.
  ${TASK_COMMAND.name} kill <id> [<bg id>]
      Stop what a task left running in the background after its turn ended:
      the one process named, by the id \`show\` lists (bg_1), or every one. A
      server the user is still using is theirs to keep; a scan nobody is
      waiting on is not.
  ${TASK_COMMAND.name} folder <id> [--add <mount>[/<folder>][:rw|:ro]]... [--remove <mount>[/<folder>]]...
      Change which folders a task already running may reach, named the way
      \`new --folder\` names them. --add hands it one more of yours, read and
      write unless :ro narrows it, and naming a folder it already has re-grants
      that one at the new access instead of mounting it twice. --remove takes
      one away; the workspace folder stays, since that is where its results go.
      A task hears about the change on the next message you send it.
  ${TASK_COMMAND.name} app <id> [--add <slug>]... [--remove <slug>]...
      Change which connected apps a task already running may reach. A task that
      stopped for want of a service is why this exists: connect the app with
      \`connect_app\`, hand it over here, and ${TASK_COMMAND.name} send tells it to carry on,
      rather than starting the work again from nothing. Only a connected app
      can be handed over.
  ${TASK_COMMAND.name} tab <id> <tab id>|--none
      Hand a task one of the user's browser tabs after the fact, by the id the
      note on their message gives, or take the tab back with --none, which
      leaves the task a browser of its own again.
  ${TASK_COMMAND.name} list [--since <date>] [--until <date>] [--running] [--limit <n>] [--all]
      Your tasks, newest activity first: id, status, what it has running in the
      background when anything does, the day it was last active, how long ago
      that was, and the title. The newest ${TASK_LIST_WINDOW} unless narrowed, and
      a count of the rest; --all shows every match. --since and --until take a
      day (2026-08-14) or a span back from now (30d), and read the day a task
      was last active, not the date its id begins with: that one is the day it
      was created, and a quarter of tasks have no date in the id at all.
  ${TASK_COMMAND.name} search <words> [--since <date>] [--until <date>] [--limit <n>] [--all]
      Find a task by what was said in it. Searches every one of your tasks, not
      only the ones \`list\` last showed, and matches their titles and ids too.
      Each result carries how many times it came up and the words around the
      first mention, best match first. What a person or the agent said, not
      what a tool was handed or returned, so a page that happened to contain
      the word is not a match. Takes the same dates as \`list\`, which narrow
      what is opened before the search runs.
  ${TASK_COMMAND.name} show <id>
      Status, model, folders, output files, and what it last said.
  ${TASK_COMMAND.name} log <id> [--tail <lines>]
      Its transcript, last ${DEFAULT_LOG_TAIL_LINES} lines by default. Composes: \`${TASK_COMMAND.name} log <id> | rg error\`.
  ${TASK_COMMAND.name} model <id> <uri>
      The model its next turn runs on, named from the list \`models\` gives.
  ${TASK_COMMAND.name} models [--author <name>]
      Every model you can run, newest first: release date, context window, price
      in dollars per million tokens in and out, what it takes besides text, and
      tags. All of them on the provider this conversation runs on, which is the
      only provider a task of yours runs on. Long; pipe it through head or rg.
  ${TASK_COMMAND.name} wait <id> [--timeout <ms>]
      Block until it finishes or the timeout, whichever comes first. Rarely the
      right call: you are woken when it finishes anyway.
  ${TASK_COMMAND.name} rename <id> '<title>'
      Give a task a better title.
  ${TASK_COMMAND.name} trash <id>
      Move a finished task to the trash. There is no undo.
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
        case "app": {
          return await runApp(rest, context);
        }
        case "folder": {
          return await runFolder(rest, context);
        }
        case "kill": {
          return await runKill(rest, context);
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
          return await runModels(rest, context);
        }
        case "new": {
          return await runNew(rest, context, ctx.stdin);
        }
        case "rename": {
          return await runRename(rest, context);
        }
        case "search": {
          return await runSearch(rest, context);
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
        case "tab": {
          return await runTab(rest, context);
        }
        case "trash": {
          return await runTrash(rest, context);
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

/**
 * Changes which connected apps a task already under way may reach.
 *
 * The flow this exists for: a task needs a service it was not handed, and it
 * has no way to ask for one itself, so it stops and says so. The conversation
 * connects the app with the user, hands it over here, and sends the task on its
 * way. Without this the app arrives with nowhere to go and the only move left
 * is a second task, briefed from nothing, paying again for everything the first
 * one had worked out.
 */
export async function runApp(args: string[], context: TaskCommandContext) {
  const { positional, values } = parseFlags(args, {
    flags: ["add", "remove"],
    repeatable: ["add", "remove"],
  });
  const task = await requireChild(positional[0], context);
  const askedAdds = values.get("add") ?? [];
  const askedRemoves = values.get("remove") ?? [];
  if (askedAdds.length === 0 && askedRemoves.length === 0) {
    throw new Error(
      `app: --add or --remove is required. \`${TASK_COMMAND.name} show ${task.id}\` lists the apps it has.`,
    );
  }
  const settings = await getTaskSettings(taskDir(task.id));
  // A task a person made reaches every app and holds no list; narrowing it to
  // one here would take away every app it has by handing it a single app.
  if (settings?.apps === undefined) {
    throw new Error(
      `${task.id} was not created by this conversation, so it already reaches every connected app.`,
    );
  }
  // Checked before anything is written, so a refused slug leaves the task's
  // apps as they were rather than half changed.
  const adds = await resolveApps(askedAdds);
  const held = new Set(settings.apps);
  for (const slug of askedRemoves) {
    if (!held.has(slug)) {
      throw new Error(
        `${task.id} does not have "${slug}". It has: ${settings.apps.join(", ") || "none"}.`,
      );
    }
  }
  const removed = new Set(askedRemoves);
  const apps = [
    ...settings.apps.filter((slug) => !removed.has(slug)),
    ...adds.filter((slug) => !held.has(slug)),
  ];
  const result = await updateTaskSettings(task.id, { apps });
  if (result.isErr()) {
    throw result.error;
  }
  const lines = [
    ...askedRemoves.map((slug) => `Took ${slug} back from ${task.id}.`),
    ...adds
      .filter((slug) => !held.has(slug))
      .map((slug) => `${task.id} can now reach ${slug}.`),
  ];
  return ok(
    `${lines.join("\n") || `${task.id} already had ${adds.join(", ")}.`}\nIt learns of this on the next message you send it; say what the app is for when it stopped for want of one.\n`,
  );
}

/**
 * Changes which of the user's folders a task already under way may reach.
 *
 * The grant `new --folder` makes, made after the fact: a task that turns out to
 * need one more folder is handed it where it stands, rather than stopped and
 * started again with everything it had worked out thrown away. The specs are
 * this conversation's own, the same as on `new`, since the names a task mounts
 * its folders under are assigned per task and mean nothing here.
 *
 * A task reads its folders fresh on every turn, so the mount is there the
 * moment this returns; what waits for the next message is the *telling*, which
 * rides it as a folder-changes note.
 */
export async function runFolder(args: string[], context: TaskCommandContext) {
  const { positional, values } = parseFlags(args, {
    flags: ["add", "remove"],
    repeatable: ["add", "remove"],
  });
  const task = await requireChild(positional[0], context);
  const askedAdds = values.get("add") ?? [];
  const askedRemoves = values.get("remove") ?? [];
  if (askedAdds.length === 0 && askedRemoves.length === 0) {
    throw new Error(
      `folder: --add or --remove is required. \`${TASK_COMMAND.name} show ${task.id}\` lists the folders it has.`,
    );
  }
  const orchestratorState = await getTaskState(
    taskDir(context.orchestratorTaskId),
  );
  const orchestratorFolders = orchestratorState.attachedFolders ?? {};
  // Resolved before anything is written, so a refused spec leaves the task's
  // folders as they were rather than half changed.
  const adds = resolveFolders(askedAdds, orchestratorFolders);
  await requireFoldersOnDisk(adds, askedAdds);
  const workspace = path.resolve(outputFolderPath());
  // Matched against the folders as they stand before any of this runs: every
  // spec on the line names one of those, not one a later removal has moved.
  const taskFolders = await mountsOf(task.id);
  const removes = askedRemoves.map((spec) => {
    const folder = matchTaskFolder(spec, orchestratorFolders, taskFolders);
    if (!folder) {
      throw new Error(
        `${task.id} has no folder "${spec}". \`${TASK_COMMAND.name} show ${task.id}\` lists the ones it has.`,
      );
    }
    if (path.resolve(folder.path) === workspace) {
      throw new Error(
        "every task keeps the workspace folder, which is where its results go when nothing else says. Hand it another folder to write to rather than taking this one away.",
      );
    }
    return folder;
  });

  const lines: string[] = [];
  // Taken away first, so `--remove <folder> --add <folder>:ro` reads as the
  // re-grant it looks like rather than as a removal of what was just added.
  for (const folder of removes) {
    await detachFolder({ path: folder.path, taskId: task.id });
    lines.push(
      `Took ${mountPathOf(folder.path, orchestratorFolders) ?? `${MOUNT.attachedFolders}/${folder.mountName}`} back from ${task.id}.`,
    );
  }
  for (const folder of adds) {
    await attachFolder({
      access: folder.access,
      path: folder.path,
      taskId: task.id,
    });
    lines.push(
      `${task.id} now has ${mountPathOf(folder.path, orchestratorFolders) ?? folder.path} (${folder.access}).`,
    );
  }
  return ok(
    `${lines.join("\n")}\nIt learns of this on the next message you send it; say what the folder is for when it is waiting on one.\n`,
  );
}

/**
 * Stops what a task left running in the background: one process, or all of
 * them. Acts on the registry directly rather than asking the task to, which
 * would cost it a turn and trust the model that left the process behind. The
 * same act as the stop button beside the task's title.
 */
export async function runKill(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const wanted = args[1];
  const running = listTaskBackgroundProcesses(task.id).filter(
    (process) => process.status === "running",
  );
  if (running.length === 0) {
    return ok(`${task.id} has nothing running in the background.\n`);
  }
  const targets =
    wanted === undefined
      ? running
      : running.filter((process) => process.id === wanted);
  if (wanted !== undefined && targets.length === 0) {
    const background = leftRunning(task.id)
      .map((process) => describeLeftRunning(process))
      .join(", ");
    throw new Error(
      `no ${wanted} running in ${task.id}. In the background: ${background}.`,
    );
  }
  const now = Date.now();
  const lines = await Promise.all(
    targets.map(async (process) => {
      const described = describeLeftRunning({
        command: process.command,
        id: process.id,
        runningForMs: now - process.startedAt.getTime(),
      });
      const killed = await killBackgroundProcess({
        id: process.id,
        sessionId: process.sessionId,
      });
      if (!killed?.stoppedByThisCall) {
        return `${process.id} had already ended.`;
      }
      return killed.terminationConfirmed
        ? `Stopped ${described}.`
        : `Told ${described} to stop, but could not confirm it did; \`${TASK_COMMAND.name} show ${task.id}\` will say.`;
    }),
  );
  return ok(`${lines.join("\n")}\n`);
}

export async function runNew(
  args: string[],
  context: TaskCommandContext,
  stdin: ByteString,
) {
  const { positional, values } = parseFlags(args, {
    flags: ["app", "effort", "folder", "model", "name", "tab"],
    repeatable: ["app", "folder"],
  });
  const prompt = promptFrom(positional.join(" "), stdin);
  if (!prompt) {
    throw new Error(
      `new: a brief is required, on stdin through a quoted heredoc.\n\n${USAGE}`,
    );
  }
  // With the brief on stdin, a bare word on the command is a mistake, and
  // the usual one is the tail of a path with a space in it: `--folder
  // /mnt/x/a folder:rw` reaches here as the folder `a` and the word
  // `folder:rw`, which would otherwise be dropped without a word.
  if (positional.length > 0 && subprocessStdin(stdin)) {
    throw new Error(
      `new: unexpected ${positional.length === 1 ? "argument" : "arguments"} ${positional.map((argument) => `"${argument}"`).join(", ")} beside the brief on stdin. A path with a space in it needs quotes: --folder '${MOUNT.attachedFolders}/<mount>/a folder:rw'.`,
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
  await requireOwnProvider(model, context);
  const askedFolders = values.get("folder") ?? [];
  const orchestratorFolders = orchestratorState.attachedFolders ?? {};
  const resolvedFolders = resolveFolders(askedFolders, orchestratorFolders);
  await requireFoldersOnDisk(resolvedFolders, askedFolders);
  const folders = withWorkspaceFolder(resolvedFolders);
  const name = values.get("name")?.[0]?.trim() || defaultTaskName(prompt);
  const tab = values.get("tab")?.[0];
  const browserTargetId =
    tab === undefined ? undefined : resolveTab(tab, context.orchestratorTaskId);
  const apps = await resolveApps(values.get("app") ?? []);
  requireAppsNamedInBrief(prompt, apps);

  const taskId = await newTaskId({ prompt, workspaceConfig });
  // How hard the conversation thinks is how hard its tasks think: the level is
  // a property of the workspace rather than of one turn, and a task the
  // conversation cannot configure has no other way to be told.
  const parentSettings = await getTaskSettings(
    taskDir(context.orchestratorTaskId),
  );
  // A level named on the command wins over the conversation's own, which is how
  // one brief is run at several levels to compare them.
  const askedEffort = values.get("effort")?.[0]?.trim();
  const effort = askedEffort
    ? z.enum(REASONING_EFFORTS).parse(askedEffort)
    : parentSettings?.reasoningEffort;
  const initialized = await initializeTask(
    {
      initialSettings: {
        apps,
        kind: "task",
        name,
        parentTaskId: context.orchestratorTaskId,
        ...(effort ? { reasoningEffort: effort } : {}),
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
  if (context.sessionId) {
    await recordTaskChannel({
      orchestratorTaskId: context.orchestratorTaskId,
      sessionId: context.sessionId,
      taskId,
    });
  }
  const session = await latestOrNewSessionId(taskId);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  const message = await newMessage({
    folders,
    model,
    modelURI,
    prompt,
    sessionId,
    taskId,
  });
  if (message.isErr()) {
    throw message.error;
  }
  // The brief names folders by the paths this conversation reaches them at, and
  // the task reaches the same folders at paths of its own: the message attached
  // them a line ago, which is what makes the task's names readable here.
  const taskFolders = await mountsOf(taskId);
  const briefed = {
    ...message.value,
    parts: message.value.parts.map((part) =>
      part.type === "text"
        ? {
            ...part,
            text: translateMountPaths(
              part.text,
              orchestratorFolders,
              taskFolders,
            ),
          }
        : part,
    ),
  };

  publisher.publish("task.updated", { id: taskId });
  getWorkspaceActorRef().send({
    type: "createSession",
    value: {
      agentName: "main",
      id: taskId,
      message: briefed,
      model,
      sessionId,
    },
  });
  await recordTaskActivity(taskId);

  return ok(
    `Created ${taskId} ("${name}"). It is running now.\nIts folders: ${handedFolders(folders, orchestratorFolders)}.\nYou will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`,
  );
}

export async function runSend(
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
    // In the task's paths, as the brief that started it was.
    prompt: translateMountPaths(
      prompt,
      orchestratorState.attachedFolders ?? {},
      state.attachedFolders ?? {},
    ),
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

export async function runStop(args: string[], context: TaskCommandContext) {
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

/**
 * Hands a task one of the user's browser tabs after it has started, or takes
 * the tab back.
 *
 * The tab is the user's and outlives the task, so this points the task's
 * browser at it rather than creating anything; `--none` leaves the task to open
 * a browser of its own the next time it needs a page.
 */
export async function runTab(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const wanted = args[1];
  if (!wanted) {
    throw new Error(
      "tab: a tab id is required, or --none to take the tab back. The note on the user's message lists the tabs open.",
    );
  }
  if (wanted === "--none") {
    const state = await getTaskState(taskDir(task.id));
    if (!state.browserTargetId) {
      return ok(
        `${task.id} has no tab of the user's; it browses on its own already.\n`,
      );
    }
    await setTaskState(taskDir(task.id), { browserTargetId: undefined });
    publisher.publish("task.stateUpdated", { id: task.id });
    return ok(
      `Took the tab back from ${task.id}. It opens a browser of its own from here.\n`,
    );
  }
  const browserTargetId = resolveTab(wanted, context.orchestratorTaskId);
  await setTaskState(taskDir(task.id), { browserTargetId });
  publisher.publish("task.stateUpdated", { id: task.id });
  return ok(
    `${task.id} now drives tab ${wanted}, page and all. It acts on that tab from its next message.\n`,
  );
}

/**
 * The tab a task was handed, by the id the conversation knows it as, and
 * whether it is still open: a tab the user has since closed leaves the task
 * with nothing to act on, which is worth seeing before steering it at one.
 */
function describeHandedTab(targetId: BrowserTargetId | undefined): string {
  if (!targetId) {
    return "none; it browses on its own";
  }
  const decoded = decodeBrowserTargetId(targetId);
  if (!decoded) {
    return "none; it browses on its own";
  }
  return getWorkspaceConfig().browser.getTargetMeta(targetId)
    ? decoded.sessionId
    : `${decoded.sessionId} (closed since it was handed over)`;
}

function fail(message: string) {
  return {
    exitCode: 1,
    stderr: `${TASK_COMMAND.name}: ${message}\n`,
    stdout: "",
  };
}

/**
 * What a task was handed, in this conversation's own paths: the folders named
 * on the command with the access each ended up with, and the workspace folder
 * that goes with them whether it was named or not.
 */
function handedFolders(
  folders: { access: FolderAttachment.Access; path: string }[],
  orchestratorFolders: FolderMounts,
): string {
  return folders
    .map(
      (folder) =>
        `${mountPathOf(folder.path, orchestratorFolders) ?? folder.path} (${folder.access})`,
    )
    .join(", ");
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

/**
 * The folder of a task's own that a `--remove` spec names.
 *
 * `show` prints a task's folders in this conversation's paths where a mount of
 * its own covers one, and in the task's own where none does, so both readings
 * are tried here: a task can hold a folder this conversation has since given
 * up, and that folder is still the task's to lose.
 */
function matchTaskFolder(
  spec: string,
  orchestratorFolders: Record<string, FolderAttachment.Type>,
  taskFolders: FolderMounts,
): undefined | { mountName: string; path: string } {
  const held = Object.values(taskFolders);
  let hostPath: string | undefined;
  try {
    hostPath = resolveFolders([spec], orchestratorFolders)[0]?.path;
  } catch {
    // Not a folder of this conversation's; read as one of the task's below.
    hostPath = undefined;
  }
  if (hostPath !== undefined) {
    const wanted = path.resolve(hostPath);
    const found = held.find((folder) => path.resolve(folder.path) === wanted);
    if (found) {
      return found;
    }
  }
  const { name, subpath } = parseFolderSpec(spec);
  return subpath ? undefined : held.find((folder) => folder.mountName === name);
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
    [
      ...prompt.matchAll(
        /\bapp (?:call|request|tools|guide) ([a-z0-9][a-z0-9-]*)/g,
      ),
    ].map((match) => match[1] ?? ""),
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
 * Refuses a model from any other provider. Another provider is another account
 * and another bill, spent without anything here reporting the difference until
 * it had been. The user is still free to move a task to any model themselves.
 */
async function requireOwnProvider(
  model: AIGatewayModel.Type,
  context: TaskCommandContext,
) {
  const providerConfigId = await requireOwnProviderConfigId(context);
  if (model.params.providerConfigId !== providerConfigId) {
    throw new Error(
      `${model.uri} is not on this conversation's provider, and a task runs on no other. \`${TASK_COMMAND.name} models\` lists every model you can hand one.`,
    );
  }
}

/**
 * The provider config this conversation runs on, which is the only one it may
 * put a task on.
 */
async function requireOwnProviderConfigId(context: TaskCommandContext) {
  const providerConfigId = await ownProviderConfigId(
    context.orchestratorTaskId,
  );
  if (providerConfigId === undefined) {
    throw new Error(
      "this conversation has not chosen a model yet, so it has no provider to run a task on.",
    );
  }
  return providerConfigId;
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

async function runTrash(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const result = await trashTask({
    id: task.id,
    workspaceConfig: getWorkspaceConfig(),
    workspaceRef: getWorkspaceActorRef(),
  });
  if (result.isErr()) {
    throw result.error;
  }
  return ok(`Moved ${task.id} ("${task.title}") to the trash.\n`);
}

/**
 * A task named for the term counts for about this many mentions of it.
 *
 * A conversation that said the word thirty times is what is being looked for,
 * so mentions lead the ordering. But a task whose title is the term is at
 * least as good an answer as one that mentioned it in passing, and ranking
 * purely on mentions would push it past the window and out of sight.
 */
const NAME_MATCH_MENTIONS = 5;

/** The window and date flags `list` and `search` share. */
function listQueryFrom(args: string[]): TaskListQuery {
  const { values } = parseFlags(args, {
    flags: ["limit", "since", "until"],
    repeatable: [],
  });
  const rawLimit = values.get("limit")?.[0];
  if (rawLimit !== undefined && !Number.isInteger(Number(rawLimit))) {
    throw new Error(`--limit takes a whole number, not "${rawLimit}".`);
  }
  const rawSince = values.get("since")?.[0];
  const rawUntil = values.get("until")?.[0];
  return {
    all: args.includes("--all"),
    ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
    running: args.includes("--running"),
    ...(rawSince ? { since: parseListDate(rawSince) } : {}),
    ...(rawUntil ? { until: parseListDate(rawUntil, { endOfDay: true }) } : {}),
  };
}

function listRowsOf(tasks: Task[]): TaskListRow[] {
  return tasks.map((task) => ({
    id: task.id,
    isRunning: isWorking(task.id),
    leftRunning: leftRunning(task.id).length,
    title: task.title,
    updatedAt: task.updatedAt,
  }));
}

async function runList(args: string[], context: TaskCommandContext) {
  const query = listQueryFrom(args);
  const children = await listChildTasks(context.orchestratorTaskId);
  const selection = selectTasks(listRowsOf(children), query);
  if (selection.shown.length === 0) {
    if (children.length === 0) {
      return ok("No tasks yet. Create one with `task new`.\n");
    }
    if (query.running && !query.since && !query.until) {
      return ok("No tasks running.\n");
    }
    return ok(
      `No task in that range, out of ${children.length}. Widen the dates, or list them all with \`task list --all\`.\n`,
    );
  }
  return ok(renderTaskList(selection));
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
  const { model, modelURI } = await resolveModel(rawURI);
  await requireOwnProvider(model, context);
  await setTaskState(taskDir(task.id), { selectedModelURI: modelURI });
  return ok(`${task.id} will run its next turn on ${modelURI}.\n`);
}

async function runModels(args: string[], context: TaskCommandContext) {
  const { values } = parseFlags(args, { flags: ["author"], repeatable: [] });
  const author = values.get("author")?.[0]?.toLowerCase();
  const runnable = await listRunnableModels(
    await requireOwnProviderConfigId(context),
  );
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

async function runSearch(args: string[], context: TaskCommandContext) {
  const { positional } = parseFlags(args, {
    flags: ["limit", "since", "until"],
    repeatable: [],
  });
  const term = positional
    .filter((word) => !word.startsWith("--"))
    .join(" ")
    .trim();
  if (!term) {
    throw new Error("search needs words. `task search <words>`.");
  }
  const query = listQueryFrom(args);
  const children = await listChildTasks(context.orchestratorTaskId);
  // The dates narrow which conversations are opened at all; the window is
  // applied after ranking, so nothing is missed for having been old.
  const scoped = selectTasks(listRowsOf(children), {
    all: true,
    ...(query.since ? { since: query.since } : {}),
    ...(query.until ? { until: query.until } : {}),
  });
  const hits = await searchTaskContent({
    taskIds: scoped.shown.map((row) => row.id),
    term,
  });
  const wanted = term.toLowerCase();
  const matched: TaskSearchRow[] = scoped.shown.flatMap((row) => {
    const hit = hits.get(row.id);
    const named = `${row.title} ${row.id}`.toLowerCase().includes(wanted);
    if (!hit && !named) {
      return [];
    }
    return [{ ...row, count: hit?.count ?? 0, snippet: hit?.snippet ?? "" }];
  });
  const scoreOf = (row: TaskSearchRow) =>
    row.count +
    (`${row.title} ${row.id}`.toLowerCase().includes(wanted)
      ? NAME_MATCH_MENTIONS
      : 0);
  matched.sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const size = query.all ? matched.length : (query.limit ?? TASK_LIST_WINDOW);
  const shown = matched.slice(0, Math.max(0, size));
  if (shown.length === 0) {
    return ok(
      `Nothing said "${term}", across ${scoped.total} ${scoped.total === 1 ? "task" : "tasks"}.\n`,
    );
  }
  return ok(
    renderTaskSearch({
      omitted: matched.length - shown.length,
      shown,
      total: matched.length,
    }),
  );
}

async function runShow(args: string[], context: TaskCommandContext) {
  const task = await requireChild(args[0], context);
  const state = await getTaskState(taskDir(task.id));
  const running = isWorking(task.id);
  // Everything below is the task's, said in this conversation's paths: the
  // names are the task's own and mean nothing here (see mount-paths.ts).
  const taskFolders = state.attachedFolders ?? {};
  const orchestratorFolders = await mountsOf(context.orchestratorTaskId);
  const folders = Object.values(taskFolders).map(
    (folder) =>
      `${mountPathOf(folder.path, orchestratorFolders) ?? `${MOUNT.attachedFolders}/${folder.mountName}`} (${effectiveFolderAccess(folder)})`,
  );
  const outputs = await listOutputs(task.id);
  const sessionId = await latestSessionId(task.id);
  const said =
    sessionId.isOk() && sessionId.value
      ? await lastAssistantText({
          maxLength: SHOW_SUMMARY_MAX_LENGTH,
          sessionId: sessionId.value,
          taskId: task.id,
        })
      : undefined;
  const lastSaid =
    said === undefined
      ? undefined
      : translateMountPaths(said, taskFolders, orchestratorFolders);

  const settings = await getTaskSettings(taskDir(task.id));
  const handedApps = settings?.apps ?? [];
  const usage = await getTaskUsageSummary(task.id);
  // Its own line rather than a word in the status: the status is the turn,
  // and a turn that ended with a scan still going leaves the task idle with
  // something running.
  const background = leftRunning(task.id);
  const lines = [
    `${task.id}: "${task.title}"`,
    `status: ${running ? "running" : "idle"}`,
    ...(background.length > 0
      ? [
          `in the background: ${background.length > 1 ? "\n  " : ""}${background.map((process) => describeLeftRunning(process)).join("\n  ")}`,
        ]
      : []),
    `last activity: ${task.updatedAt.toISOString().slice(0, 10)}, ${formatAge(Date.now() - task.updatedAt.getTime())} ago`,
    `spent: ${ms(Math.max(1000, usage.activeMs), { long: true })} of work, ${usage.inputTokens + usage.outputTokens} tokens`,
    `model: ${state.selectedModelURI ?? "(none yet)"}`,
    `folders: ${folders.length > 0 ? folders.join(", ") : "none"}`,
    `apps: ${handedApps.length > 0 ? handedApps.join(", ") : "none"}`,
    `tab: ${describeHandedTab(state.browserTargetId)}`,
    `scratch: ${MOUNT.tasks}/${task.id}`,
    `outputs: ${outputs.length > 0 ? `\n  ${outputs.join("\n  ")}` : "none yet"}`,
    `last said: ${lastSaid ? `\n  ${lastSaid.replaceAll("\n", "\n  ")}` : "nothing yet"}`,
  ];
  return ok(`${lines.join("\n")}\n`);
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

/**
 * The workspace folder, read and write, on every task: where results go when
 * nobody said where, so a task puts its deliverable there itself rather than
 * leaving it in scratch for the conversation to fetch. A brief that names the
 * folder, or a folder inside it, keeps what it asked for beside this.
 */
function withWorkspaceFolder<T extends { path: string }>(
  folders: T[],
): (T | { access: "read-write"; path: string; source: "user" })[] {
  const workspace = outputFolderPath();
  return folders.some((folder) => folder.path === workspace)
    ? folders
    : [...folders, { access: "read-write", path: workspace, source: "user" }];
}
