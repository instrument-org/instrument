import {
  type AIGatewayModel,
  type AIGatewayModelURI,
  fetchModel,
  REASONING_EFFORTS,
} from "@instrument-org/ai-gateway";
import { APP_NAME } from "@instrument-org/shared";
import { type ByteString, defineCommand } from "just-bash";
import ms from "ms";
import path from "node:path";
import { z } from "zod";

import { MOUNT } from "../../mount-points";
import { publisher } from "../../rpc/publisher";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type Task } from "../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { type HeldTab } from "../../schemas/task-state";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
  encodeBrowserTargetId,
} from "../../types";
import {
  describeConnection,
  isConnected,
  readConnection,
} from "../apps/connection";
import { loadApp } from "../apps/store";
import { attachFolder, detachFolder } from "../attach-folder";
import { attachedFolderMountPoint } from "../attached-folder-mounts";
import {
  killBackgroundProcess,
  listTaskBackgroundProcesses,
} from "../background-processes";
import { defaultTaskName } from "../default-task-name";
import { folderLabel } from "../folder-parent-label";
import { getTask } from "../get-tasks";
import { initializeTask } from "../initialize-task";
import { isLocalAddress } from "../local-page-address";
import { newMessage } from "../new-message";
import { newTaskId } from "../new-task-id";
import { isWorking, leftRunning } from "../chat/activity";
import { childTaskMounts, listChildTasks } from "../chat/children";
import { describeHoldings } from "../chat/describe-holdings";
import { WINDOW_ID } from "../../schemas/window-id";
import { taskFolderHoldings } from "../chat/folder-holdings";
import { folderReach } from "../chat/folder-reach";
import { stepInFlight } from "../chat/in-flight";
import {
  lastAssistantText,
  latestOrNewSessionId,
  latestSessionId,
} from "../chat/latest-session";
import { describeLeftRunning } from "../chat/left-running";
import {
  completeModelURI,
  listRunnableModels,
  modelTable,
  ownModelParams,
} from "../chat/models";
import {
  type FolderMounts,
  mountPathOf,
  mountsOf,
  translateMountPaths,
  translateTaskFolderPaths,
  unreachableMountPaths,
} from "../chat/mount-paths";
import { outputFolderPath } from "../chat/output-folder";
import { renderSteps, sessionSteps } from "../chat/steps";
import { recordHandOff } from "./task-hand-off";
import { askWake, cancelAskedWake, expectStop } from "../chat/wake";
import { tabHolders } from "../chat/window-tab";
import { isChatId, sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { systemNote } from "../system-note";
import { taskDir } from "../task-dir-utils";
import {
  cancelHold,
  holdTask,
  queueBehindHold,
  type TaskHold,
  taskHold,
} from "../task-hold";
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
import {
  buildWorkspaceFsLayout,
  effectiveFolderAccess,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import {
  ANSWER_WAIT_MS,
  awaitAnswers,
  chatOnlyPathsIn,
  parseDelay,
  parseFlags,
  parseFolderSpec,
  type PendingLook,
  requireFilesNamedInBrief,
  requireFoldersOnDisk,
  resolveFileUploads,
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
  /** The chat whose tasks these are. Every subcommand is scoped to it. */
  chatId: TaskId;
  /** What is left of the enclosing call's yield window, read when a wait starts. */
  remainingYieldMs: () => number;
  /**
   * The chat this command is running in, recorded on every task it makes so
   * the outcome comes back where it was asked for. Absent where the command is
   * built outside a turn, which leaves a task unattributed rather than wrong.
   */
  sessionId?: StoreId.Session;
}

const DEFAULT_LOG_TAIL_LINES = 120;

/**
 * The longest a conversation may put off looking at a task. Past this the
 * clock is the better judge, since a task that has run for hours is one the
 * user has stopped watching.
 */
const MAX_ASKED_WAKE_MS = ms("2 hours");
const LOG_MAX_BYTES = 24 * 1024;
/** Held back from the yield window so a stop returns inside it. */
const WAIT_MARGIN_MS = 500;
/**
 * Held back from the yield window while `new` waits on the user's answer to
 * the system's ask, for the task to be made and the command to return inside
 * it.
 */
const ANSWER_WAIT_MARGIN_MS = 2000;

const USAGE = `Usage: ${TASK_COMMAND.name} <subcommand> ...

  ${TASK_COMMAND.name} new --name '<title>' [--model <model>] [--effort <level>] [--folder <mount>[/<folder>][:rw|:ro]]... [--file <path>]... [--app <slug>]... [--tab <id>]... <<'EOF'
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
      with the access this conversation has unless :ro narrows it. --file hands
      the task one file you can read, a file the user sent above all: a copy
      lands in the task's own attachments/ and the task is told it is there,
      so the brief calls it by that name. --app hands the task a
      connected app, by slug; it gets the \`app\` command for that app and no
      other. --tab hands the task a tab already open, by the id the note on
      their message gives, page and all; repeat it for several pages that
      are one job (compare these, fill this form from that page), and the
      task starts on the first. A task opens the pages it needs in tabs of
      its own in this chat too, behind whatever the user has up, so work on
      a new page needs no tab: the brief names the page.
      --effort is how hard its model thinks, one of ${REASONING_EFFORTS.join(", ")};
      \`${TASK_COMMAND.name} models\` says which levels each model takes and its default. The same
      brief at two levels is two tasks, which is how a level is compared.
      Prints the task id. You are told when it finishes a turn; do not poll it.
      What that note carries is its last message, so the brief names a file to
      make and a folder for it, never findings or a summary to put in the reply.
  ${TASK_COMMAND.name} send <id> [--now] [--file <path>]... <<'EOF'
  <message>
  EOF
      Deliver a message into a task: it runs now if idle; if busy, the task
      hears it at its next step; if still waiting to start, right after its
      brief once it starts. Follow-ups, corrections, answers to its
      questions. --now stops the step in flight and runs the message as its
      next turn: for a correction that makes the current work wrong, or a
      task whose latest step has run for minutes without a tool call. Same
      heredoc, and --file hands it a file the way \`new --file\` does.
  ${TASK_COMMAND.name} stop <id> [<bg id> | --all]
      End a running task's turn where it is, and say whether it stopped;
      \`send\` gives it the next thing to do. With a process id (bg_1, as
      \`show\` lists them), stop only that process the task left running in
      the background, and leave its turn alone. --all ends the turn and every
      process it left running. A server the user is still using is theirs to
      keep; a scan nobody is waiting on is not. A task still waiting to
      start is canceled instead, and never runs.
  ${TASK_COMMAND.name} folder <id> [--add <mount>[/<folder>][:rw|:ro]]... [--remove <mount>[/<folder>]]... [--none] [<<'EOF'
  <what it is for>
  EOF]
      Change which folders a task may reach, named the way \`new --folder\`
      names them. --add hands it one more of yours, read and write unless :ro
      narrows it, and naming a folder it already has re-grants that one at the
      new access instead of mounting it twice. --remove takes one away; --none
      takes every one away. The workspace folder stays either way, since that
      is where its results go. The task is told at once: a working task hears
      it at its next step, an idle one it hands a folder carries on with it as
      a new turn. Say what the folder is for on stdin, in the same heredoc form
      as \`send\`, and it is told that too.
  ${TASK_COMMAND.name} app <id> [--add <slug>]... [--remove <slug>]... [--none] [<<'EOF'
  <what it is for>
  EOF]
      Change which connected apps a task may reach; --none takes every one
      away. A task that stopped for want of a service is why this exists:
      connect the app with \`connect_app\` and hand it over here, with what it
      is for on stdin, and the task carries on rather than starting the work
      again from nothing. It is told the way \`folder\` tells it. Only a
      connected app can be handed over.
  ${TASK_COMMAND.name} tab <id> [<tab id>...] [--add <tab id>]... [--remove <tab id>]... [--none]
      Change which tabs a task holds after the fact, by the ids the note on
      their message gives. Tab ids on their own replace the tabs it was
      handed; --add and --remove change one at a time; --none lets go of all
      of them. Letting go of a tab never closes it.
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
      Status, model, folders, what its folder holds, and what it last said, whole.
  ${TASK_COMMAND.name} log <id> [--steps] [--tail <lines>]
      Its transcript, last ${DEFAULT_LOG_TAIL_LINES} lines by default. Composes: \`${TASK_COMMAND.name} log <id> | rg error\`.
      \`--steps\` is the outline instead: what it set out to do, each call and how it ended, what it said, one line each and no tool output. Read this first to see what a task is doing; the transcript's tail is whatever printed last.
  ${TASK_COMMAND.name} model <id> <model>
      The model its next turn runs on, named author/id as \`models\` prints it.
  ${TASK_COMMAND.name} models [--author <name>]
      Every model you can run, newest first: release date, context window, price
      in dollars per million tokens in and out, what it takes besides text, and
      tags. All of them on the provider this conversation runs on, which is the
      only provider a task of yours runs on. Long; pipe it through head or rg.
  ${TASK_COMMAND.name} wake <id> --in <duration>|--cancel
      Be woken about a task after a delay you choose (30s, 5m, 1h), with where it
      stands then: its steps this turn, what it has written, what it has spent.
      For a task whose brief says how long it should take, so you look when it
      matters rather than when the clock does; the clock's own note stays quiet
      for that task until then. Asking again moves the wake, --cancel forgets
      it, and a task that finishes first wakes you as usual. Your turn ends; the
      note starts a new one.
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
          return await runApp(rest, context, ctx.stdin);
        }
        case "folder": {
          return await runFolder(rest, context, ctx.stdin);
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
          return await runNew(rest, context, ctx.stdin, ctx.cwd);
        }
        case "rename": {
          return await runRename(rest, context);
        }
        case "search": {
          return await runSearch(rest, context);
        }
        case "send": {
          return await runSend(rest, context, ctx.stdin, ctx.cwd);
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
        case "wake": {
          return await runWake(rest, context);
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
 * Changes which connected apps a task may reach.
 *
 * The flow this exists for: a task needs a service it was not handed, and it
 * has no way to ask for one itself, so it stops and says so. The conversation
 * connects the app with the user and hands it over here, and the task is told
 * in the same call and carries on. Without this the app arrives with nowhere
 * to go and the only move left is a second task, briefed from nothing, paying
 * again for everything the first one had worked out.
 */
export async function runApp(
  args: string[],
  context: TaskCommandContext,
  stdin: ByteString,
) {
  const { positional, values } = parseFlags(args, {
    boolean: ["none"],
    flags: ["add", "remove"],
    repeatable: ["add", "remove"],
  });
  const task = await requireOwnChild(positional[0], context);
  const askedAdds = values.get("add") ?? [];
  const none = values.has("none");
  if (askedAdds.length === 0 && !values.has("remove") && !none) {
    throw new Error(
      `app: --add, --remove, or --none is required. \`${TASK_COMMAND.name} show ${task.id}\` lists the apps it has.`,
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
  const askedRemoves = none ? settings.apps : (values.get("remove") ?? []);
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
  const purpose = await grantPurpose("app", task.id, context, stdin);
  const removed = new Set(askedRemoves);
  const added = adds.filter((slug) => !held.has(slug));
  const apps = [
    ...settings.apps.filter((slug) => !removed.has(slug)),
    ...added,
  ];
  const result = await updateTaskSettings(task.id, { apps });
  if (result.isErr()) {
    throw result.error;
  }
  const lines = [
    ...askedRemoves.map((slug) => `Took ${slug} back from ${task.id}.`),
    ...added.map((slug) => `${task.id} can now reach ${slug}.`),
  ];
  const told = await tellOfGrant({
    added: added.length > 0,
    command: "app",
    context,
    facts: [
      ...added.map((slug) => `You were handed the connected app ${slug}.`),
      ...askedRemoves.map((slug) => `The app ${slug} was taken back from you.`),
    ],
    purpose,
    task,
  });
  return ok(
    `${lines.join("\n") || (none ? `${task.id} had no apps.` : `${task.id} already had ${adds.join(", ")}.`)}\n${told}`,
  );
}

/**
 * Changes which of the user's folders a task may reach.
 *
 * The grant `new --folder` makes, made after the fact: a task that turns out to
 * need one more folder is handed it where it stands, rather than stopped and
 * started again with everything it had worked out thrown away. The specs are
 * this conversation's own, the same as on `new`, since the names a task mounts
 * its folders under are assigned per task and mean nothing here.
 *
 * A task reads its folders fresh on every turn, so the mount is there the
 * moment this returns, and the task is told in the same call (tellOfGrant).
 */
export async function runFolder(
  args: string[],
  context: TaskCommandContext,
  stdin: ByteString,
) {
  const { positional, values } = parseFlags(args, {
    boolean: ["none"],
    flags: ["add", "remove"],
    repeatable: ["add", "remove"],
  });
  const task = await requireOwnChild(positional[0], context);
  const askedAdds = values.get("add") ?? [];
  const askedRemoves = values.get("remove") ?? [];
  const none = values.has("none");
  if (askedAdds.length === 0 && askedRemoves.length === 0 && !none) {
    throw new Error(
      `folder: --add, --remove, or --none is required. \`${TASK_COMMAND.name} show ${task.id}\` lists the folders it has.`,
    );
  }
  const chatFolders = await folderReach(context.chatId);
  // Resolved before anything is written, so a refused spec leaves the task's
  // folders as they were rather than half changed.
  const adds = resolveFolders(askedAdds, chatFolders);
  await requireFoldersOnDisk(adds, askedAdds);
  const workspace = path.resolve(outputFolderPath());
  // Matched against the folders as they stand before any of this runs: every
  // spec on the line names one of those, not one a later removal has moved.
  const taskFolders = await mountsOf(task.id);
  const removes = none
    ? Object.values(taskFolders).filter(
        (folder) => path.resolve(folder.path) !== workspace,
      )
    : askedRemoves.map((spec) => {
        const folder = matchTaskFolder(spec, chatFolders, taskFolders);
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
  const removedPaths = new Set(
    removes.map((folder) => path.resolve(folder.path)),
  );
  const purpose = await grantPurpose("folder", task.id, context, stdin, [
    ...Object.values(taskFolders).filter(
      (folder) => !removedPaths.has(path.resolve(folder.path)),
    ),
    ...adds,
  ]);

  const lines: string[] = [];
  const facts: string[] = [];
  // Taken away first, so `--remove <folder> --add <folder>:ro` reads as the
  // re-grant it looks like rather than as a removal of what was just added.
  for (const folder of removes) {
    await detachFolder({ path: folder.path, taskId: task.id });
    lines.push(
      `Took ${mountPathOf(folder.path, chatFolders) ?? `${MOUNT.attachedFolders}/${folder.mountName}`} back from ${task.id}.`,
    );
    facts.push(
      `The folder ${folderLabel(folder.path)} at ${attachedFolderMountPoint(folder.mountName)} was taken back from you.`,
    );
  }
  for (const folder of adds) {
    const attached = await attachFolder({
      access: folder.access,
      path: folder.path,
      taskId: task.id,
    });
    lines.push(
      `${task.id} now has ${mountPathOf(folder.path, chatFolders) ?? folder.path} (${folder.access}).`,
    );
    facts.push(
      `You were handed the folder ${folderLabel(attached.path)} at ${attachedFolderMountPoint(attached.mountName)}, ${attached.access === "read-write" ? "read and write" : "read-only"}.`,
    );
  }
  const told = await tellOfGrant({
    added: adds.length > 0,
    command: "folder",
    context,
    facts,
    purpose,
    task,
  });
  return ok(
    `${lines.join("\n") || `${task.id} has no folder but the workspace folder.`}\n${told}`,
  );
}

async function runNew(
  args: string[],
  context: TaskCommandContext,
  stdin: ByteString,
  cwd: string,
) {
  const { positional, values } = parseFlags(args, {
    flags: ["app", "effort", "file", "folder", "model", "name", "tab"],
    repeatable: ["app", "file", "folder", "tab"],
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
  const chatState = await getTaskState(taskDir(context.chatId));
  const rawURI = values.get("model")?.[0] ?? chatState.selectedModelURI;
  if (!rawURI) {
    throw new Error(
      "new: no model. This conversation has not chosen one yet; pass --model <model>.",
    );
  }
  const { model, modelURI } = await resolveModel(rawURI, context);
  await requireOwnProvider(model, context);
  const askedFolders = values.get("folder") ?? [];
  const chatFolders = await folderReach(context.chatId);
  const resolvedFolders = resolveFolders(askedFolders, chatFolders);
  const looks = await requireFoldersOnDisk(resolvedFolders, askedFolders);
  const folders = withWorkspaceFolder(resolvedFolders);
  const askedFiles = values.get("file") ?? [];
  const layout = await chatLayout(context, chatFolders);
  await requireFilesNamedInBrief(prompt, askedFiles, { cwd, layout });
  const files = await resolveFileUploads(askedFiles, { cwd, layout });
  requireFoldersNamedInBriefHanded("new", prompt, chatFolders, [
    ...folders,
    ...files,
  ]);
  const name = values.get("name")?.[0]?.trim() || defaultTaskName(prompt);
  const handedTabs = await resolveTabs(values.get("tab") ?? []);
  const sharedTabs = await tabsHeldElsewhere(handedTabs, context.chatId);
  const apps = await resolveApps(values.get("app") ?? []);
  requireAppsNamedInBrief(prompt, apps);
  // The dialog is on the user's screen already, so the answer is often a few
  // seconds off: waited for, it is reported as what it is, a task started or
  // a refusal with nothing made. Only a look still unanswered after the wait
  // makes a task that waits on it.
  const unanswered = await awaitAnswers(
    looks,
    Math.min(
      ANSWER_WAIT_MS,
      context.remainingYieldMs() - ANSWER_WAIT_MARGIN_MS,
    ),
  );

  const taskId = await newTaskId({ prompt, workspaceConfig });
  // How hard the conversation thinks is how hard its tasks think: the level is
  // a property of the workspace rather than of one turn, and a task the
  // conversation cannot configure has no other way to be told.
  const parentSettings = await getTaskSettings(taskDir(context.chatId));
  // A level named on the command wins over the conversation's own, which is how
  // one brief is run at several levels to compare them.
  const askedEffort = values.get("effort")?.[0]?.trim();
  const effort = askedEffort
    ? z.enum(REASONING_EFFORTS).parse(askedEffort)
    : parentSettings?.reasoningEffort;
  const initialized = await initializeTask(
    {
      chatId: context.chatId,
      initialSettings: {
        apps,
        name,
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
  if (handedTabs.length > 0) {
    await setTaskState(taskDir(taskId), {
      browserTabs: handedTabs.map((id) => ({ id, openedBy: "handed" })),
    });
  }
  const session = await latestOrNewSessionId(taskId);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  const message = await newMessage({
    files,
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
            text: translateMountPaths(part.text, chatFolders, taskFolders),
          }
        : part,
    ),
  };

  publisher.publish("task.updated", { id: taskId });
  const start = (brief: SessionMessage.UserWithParts) => {
    getWorkspaceActorRef().send({
      type: "createSession",
      value: {
        agentName: "main",
        id: taskId,
        message: brief,
        model,
        sessionId,
      },
    });
  };
  // A folder the system is still asking the user about holds the task until
  // they answer, since a file written by its path goes through while the ask
  // is up, and a refusal would come after the work it was meant to prevent.
  if (unanswered.length === 0) {
    start(briefed);
  } else {
    holdTask(taskId, {
      ...folderAskHold(unanswered),
      // Stamped when it starts, so the turn's clock counts the work rather
      // than the wait.
      start: (refusals) => {
        start(withRefusals(stampedNow(briefed), refusals));
      },
      until: Promise.all(unanswered.map((look) => look.answer)).then(
        (answers) => answers.filter((answer) => answer !== undefined),
      ),
    });
  }
  await recordTaskActivity(taskId);

  if (unanswered.length === 0) {
    recordHandOff({ kind: "created", taskId });
  }
  const asking =
    unanswered.length === 0
      ? `It is running now.`
      : `macOS is asking the user whether ${APP_NAME} may use ${unanswered.map((look) => `"${look.spec}"`).join(" and ")}, and the task starts once they answer: tell them to answer the system's dialog. Until then it waits; \`${TASK_COMMAND.name} send\` queues behind that, and \`${TASK_COMMAND.name} stop\` cancels it.`;
  return ok(
    `Created ${taskId} ("${name}"). ${asking}\nIts folders: ${handedFolders(folders, chatFolders)}.\n${handedFiles(message.value)}${handedTabsLine(handedTabs)}${sharedTabs}You will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`,
  );
}

export async function runSend(
  args: string[],
  context: TaskCommandContext,
  stdin: ByteString,
  cwd: string,
) {
  const { positional, values } = parseFlags(args, {
    boolean: ["now"],
    flags: ["file"],
    repeatable: ["file"],
  });
  const now = values.has("now");
  const task = await requireOwnChild(positional[0], context);
  const prompt = promptFrom(positional.slice(1).join(" "), stdin);
  if (!prompt) {
    throw new Error(
      "send: a message is required, on stdin through a quoted heredoc.",
    );
  }
  const state = await getTaskState(taskDir(task.id));
  const chatFolders = await folderReach(context.chatId);
  const askedFiles = values.get("file") ?? [];
  const layout = await chatLayout(context, chatFolders);
  await requireFilesNamedInBrief(prompt, askedFiles, { cwd, layout });
  const files = await resolveFileUploads(askedFiles, { cwd, layout });
  requireFoldersNamedInBriefHanded(
    "send",
    prompt,
    chatFolders,
    [...Object.values(state.attachedFolders ?? {}), ...files],
    task.id,
  );
  const { held, message, running } = await deliver({
    command: "send",
    context,
    files,
    interrupt: now,
    // In the task's paths, as the brief that started it was.
    prompt: translateMountPaths(
      prompt,
      chatFolders,
      state.attachedFolders ?? {},
    ),
    task,
  });
  if (!held) {
    recordHandOff({ kind: "sent", taskId: task.id });
  }
  const sent = held
    ? `Queued for ${task.id}, which has not started: ${describeHold(held)}. It hears this right after its brief once it starts; you will be told when it finishes.`
    : running
      ? now
        ? `Sent to ${task.id}. Its step in flight was stopped, and it takes this up as its next turn; you will be told when that turn finishes.`
        : `Sent to ${task.id}. It is busy and will hear this at its next step; you will be told when its turn finishes. If its latest step has run for minutes without a tool call, \`send --now\` interrupts it.`
      : `Sent to ${task.id}. It is running now; you will be told when it finishes.`;
  return ok(`${sent}\n${handedFiles(message)}`);
}

/**
 * Puts a message into a task: saved at once, so the task's transcript shows it
 * the moment it was sent, then handed to its session, which runs it now when
 * the task is idle and at its next step when it is working (at once, its step
 * in flight stopped, with `interrupt`). Says whether the task was working.
 */
async function deliver({
  command,
  context,
  files,
  interrupt = false,
  prompt,
  task,
}: {
  command: string;
  context: TaskCommandContext;
  files?: Awaited<ReturnType<typeof resolveFileUploads>>;
  interrupt?: boolean;
  prompt: string;
  task: Task;
}) {
  const state = await getTaskState(taskDir(task.id));
  const chatState = await getTaskState(taskDir(context.chatId));
  const rawURI = state.selectedModelURI ?? chatState.selectedModelURI;
  if (!rawURI) {
    throw new Error(
      `${command}: the task has no model; set one with \`task model\`.`,
    );
  }
  const { model, modelURI } = await resolveModel(rawURI, context);
  const session = await latestOrNewSessionId(task.id);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  const message = await newMessage({
    ...(files ? { files } : {}),
    model,
    modelURI,
    prompt,
    sessionId,
    taskId: task.id,
  });
  if (message.isErr()) {
    throw message.error;
  }
  // A task held from starting hears this after its brief, once it starts. The
  // store gets it then too, so the transcript never shows it ahead of the brief.
  const held = taskHold(task.id);
  if (
    held &&
    queueBehindHold(task.id, () => {
      getWorkspaceActorRef().send({
        type: "addMessage",
        value: {
          agentName: "main",
          id: task.id,
          message: stampedNow(message.value),
          model,
          sessionId,
        },
      });
    })
  ) {
    await recordTaskActivity(task.id);
    return { held, message: message.value, running: false };
  }
  const running = isWorking(task.id);
  const written = await Store.saveMessageWithParts(message.value, task.id);
  if (written.isErr()) {
    throw written.error;
  }
  getWorkspaceActorRef().send({
    type: "addMessage",
    value: {
      agentName: "main",
      id: task.id,
      interrupt,
      message: message.value,
      model,
      saved: true,
      sessionId,
    },
  });
  await recordTaskActivity(task.id);
  return { held: undefined, message: message.value, running };
}

/** A hold as the conversation reads it: why, and for how long so far. */
function describeHold(hold: TaskHold, now = Date.now()): string {
  return `${hold.reason} (${formatAge(now - hold.since.getTime())})`;
}

/**
 * What holds a task on the system's ask about its folders, in the
 * conversation's words and in the user's.
 */
function folderAskHold(looks: PendingLook[]) {
  const names = looks.map((look) => folderLabel(look.path));
  return {
    reason: `macOS is asking the user about ${names.map((name) => `"${name}"`).join(" and ")}`,
    userReason: `Waiting for you to allow access to ${names.join(" and ")}`,
  };
}

/**
 * What the conversation said a folder or app is for, on stdin, in the task's
 * paths. Checked before the grant is written, so a message naming a folder the
 * task will not have refuses the whole call rather than half of it.
 */
async function grantPurpose(
  command: "app" | "folder",
  taskId: TaskId,
  context: TaskCommandContext,
  stdin: ByteString,
  handed?: { path: string }[],
): Promise<string> {
  const said = promptFrom("", stdin);
  if (!said) {
    return "";
  }
  const chatFolders = await folderReach(context.chatId);
  const taskState = await getTaskState(taskDir(taskId));
  const taskFolders = taskState.attachedFolders;
  requireFoldersNamedInBriefHanded(
    command,
    said,
    chatFolders,
    handed ?? Object.values(taskFolders ?? {}),
    taskId,
  );
  // Translated against the folders as they stand once the grant is written,
  // which is when the task reads it; `tellOfGrant` does that.
  return said;
}

/**
 * The message as sent now: a message made before its task was held reaches
 * the task when the hold lets go, and the turn it starts is timed from there.
 */
function stampedNow(
  message: SessionMessage.UserWithParts,
): SessionMessage.UserWithParts {
  return {
    ...message,
    metadata: { ...message.metadata, createdAt: new Date() },
  };
}

/**
 * Tells a task what a `folder` or `app` call changed, so the change takes
 * effect without a `send` after it: a working task hears it at its next step,
 * and an idle one it handed something carries on with it as a new turn. An
 * idle task that only lost something is left idle, since a turn to hear that
 * would cost money and do nothing; the change rides its next message anyway,
 * as the folder and app notes every message carries.
 */
async function tellOfGrant({
  added,
  command,
  context,
  facts,
  purpose,
  task,
}: {
  added: boolean;
  command: "app" | "folder";
  context: TaskCommandContext;
  facts: string[];
  purpose: string;
  task: Task;
}): Promise<string> {
  const running = isWorking(task.id);
  if (!running && !added && !purpose) {
    return `${task.id} is not running; it is told when its next turn starts.\n`;
  }
  const chatFolders = await folderReach(context.chatId);
  const state = await getTaskState(taskDir(task.id));
  const said = purpose
    ? translateMountPaths(purpose, chatFolders, state.attachedFolders ?? {})
    : "";
  const { held } = await deliver({
    command,
    context,
    prompt: [facts.join(" "), said].filter(Boolean).join("\n\n"),
    task,
  });
  if (held) {
    return `${task.id} has not started (${describeHold(held)}); it is told this right after its brief once it starts.\n`;
  }
  recordHandOff({ kind: "sent", taskId: task.id });
  return running
    ? `Sent to ${task.id}, which is busy and hears this at its next step; you will be told when its turn finishes.\n`
    : `Sent to ${task.id}, which carries on with it now; you will be told when it finishes.\n`;
}

/**
 * The brief with what the user declined added to it: the task still starts,
 * so the refusal reaches the conversation the way any finish does, and it
 * does none of the work that needed the folder.
 */
function withRefusals(
  message: SessionMessage.UserWithParts,
  refusals: string[],
): SessionMessage.UserWithParts {
  if (refusals.length === 0) {
    return message;
  }
  const note = systemNote`
    ${refusals.join("\n")}
    Do none of the work that needs that folder: say in one line that macOS refused it, and stop.
  `;
  // On the brief's own text, so the task reads it as part of what it was told.
  let noted = false;
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "text" || noted) {
        return part;
      }
      noted = true;
      return { ...part, text: `${part.text}\n${note}` };
    }),
  };
}

/** How long `stop` waits to see a task go idle before saying it is still ending. */
const STOP_CONFIRM_MS = 5000;
const STOP_POLL_MS = 100;

/**
 * One stop verb for everything a task has going. Bare, it ends the task's
 * turn and leaves what it started in the background running, since a server
 * the user is looking at outlives the turn that started it; with a process id
 * it stops that one process and leaves the turn alone; `--all` ends both.
 *
 * Background processes are stopped through the registry directly rather than
 * by asking the task to, which would cost it a turn and trust the model that
 * left them behind: the same act as the stop button beside the task's title.
 */
export async function runStop(args: string[], context: TaskCommandContext) {
  const { positional, values } = parseFlags(args, {
    boolean: ["all"],
    flags: [],
    repeatable: [],
  });
  const task = await requireOwnChild(positional[0], context);
  const processId = positional[1];
  const all = values.has("all");
  if (processId !== undefined && all) {
    throw new Error(
      "stop: a process id or --all, not both. --all already stops every process.",
    );
  }
  if (processId !== undefined) {
    return ok(await stopBackground(task.id, processId));
  }
  const canceled = cancelHold(task.id);
  const turn = canceled
    ? `Stopped ${task.id} before it started; it was waiting: ${describeHold(canceled)}. It never ran, and nothing sent to it will run; start a new task if the work is still wanted.\n`
    : isWorking(task.id)
      ? await stopTurn(task.id, context)
      : `${task.id} is not running.\n`;
  if (all) {
    return ok(`${turn}${await stopBackground(task.id)}`);
  }
  const background = leftRunning(task.id);
  if (background.length === 0) {
    return ok(turn);
  }
  return ok(
    `${turn}It left running in the background: ${background.map((process) => describeLeftRunning(process)).join(", ")}. \`${TASK_COMMAND.name} stop ${task.id} <bg id>\` stops one, \`${TASK_COMMAND.name} stop ${task.id} --all\` every one.\n`,
  );
}

/**
 * Changes which of the window's tabs a task holds after it has started.
 *
 * The tabs are the user's and outlive the task, so this points the task's
 * browser at them rather than creating anything. Named on their own they
 * replace the tabs it was handed, keeping any it opened itself; `--add` and
 * `--remove` change the set one tab at a time; `--none` lets go of every tab,
 * leaving the task to open one of its own the next time it needs a page.
 * Letting go of a tab never closes it.
 */
export async function runTab(args: string[], context: TaskCommandContext) {
  const { positional, values } = parseFlags(args, {
    boolean: ["none"],
    flags: ["add", "remove"],
    repeatable: ["add", "remove"],
  });
  const task = await requireOwnChild(positional[0], context);
  const named = positional.slice(1);
  const adds = values.get("add") ?? [];
  const removes = values.get("remove") ?? [];
  const none = values.has("none");
  if (
    named.length === 0 &&
    adds.length === 0 &&
    removes.length === 0 &&
    !none
  ) {
    throw new Error(
      "tab: name the tabs to hand over, or --add, --remove, or --none. The note on the user's message lists the tabs open.",
    );
  }
  const state = await getTaskState(taskDir(task.id));
  const current = state.browserTabs ?? [];
  if (none) {
    if (current.length === 0) {
      return ok(`${task.id} holds no tabs; it opens one of its own already.\n`);
    }
    await setTaskState(taskDir(task.id), { browserTabs: undefined });
    publisher.publish("task.stateUpdated", { id: task.id });
    return ok(
      `${task.id} let go of every tab it held; they stay open. It opens a tab of its own from here.\n`,
    );
  }
  const handed = await resolveTabs([...named, ...adds]);
  const letGo = await resolveTabs(removes, { closedIsFine: true });
  const dropped = new Set<string>(letGo);
  const kept =
    named.length > 0
      ? current.filter((held) => held.openedBy === "task")
      : current;
  const next = [
    ...kept.filter((held) => !dropped.has(held.id)),
    ...handed
      .filter((id) => !kept.some((held) => held.id === id))
      .map((id) => ({ id, openedBy: "handed" as const })),
  ];
  await setTaskState(taskDir(task.id), {
    browserTabs: next.length > 0 ? next : undefined,
  });
  publisher.publish("task.stateUpdated", { id: task.id });
  const shared = await tabsHeldElsewhere(handed, context.chatId, task.id);
  return ok(
    `${task.id} now holds ${next.length > 0 ? `tabs ${next.map((held) => tabIdOf(held.id)).join(", ")}` : "no tabs"}. It acts on them from its next browser command.\n${shared}`,
  );
}

/**
 * Schedules the note the conversation asked for about one of its tasks. A
 * timer rather than a wait: the turn ends, and the note starts another one
 * when the time comes, the same way a finish does.
 */
export async function runWake(args: string[], context: TaskCommandContext) {
  const { positional, values } = parseFlags(args, {
    boolean: ["cancel"],
    flags: ["in"],
    repeatable: [],
  });
  const task = await requireOwnChild(positional[0], context);
  if (values.has("cancel")) {
    return ok(
      cancelAskedWake(task.id)
        ? `Forgot the wake you asked for about ${task.id}; the clock takes over again.\n`
        : `No wake was pending for ${task.id}.\n`,
    );
  }
  const raw = values.get("in")?.[0];
  const afterMs = raw === undefined ? undefined : parseDelay(raw);
  if (afterMs === undefined) {
    throw new Error(
      "wake: --in takes a delay such as 30s, 5m, or 1h (or --cancel).",
    );
  }
  if (afterMs > MAX_ASKED_WAKE_MS) {
    throw new Error(
      `wake: --in may be at most ${ms(MAX_ASKED_WAKE_MS, { long: true })}.`,
    );
  }
  if (!isWorking(task.id)) {
    return ok(
      `${task.id} is not running, so there is nothing to wake you about; you are told when it next finishes a turn.\n`,
    );
  }
  askWake({
    afterMs,
    chatId: context.chatId,
    taskId: task.id,
    workspaceRef: getWorkspaceActorRef(),
  });
  return ok(
    `You will be woken about ${task.id} in ${ms(afterMs, { long: true })} if it is still working; sooner if it finishes. End your turn.\n`,
  );
}

/**
 * The tab a task was handed, by the id the conversation knows it as, and
 * whether it is still open: a tab the user has since closed leaves the task
 * with nothing to act on, which is worth seeing before steering it at one.
 */
function describeHeldTabs(tabs: HeldTab[]): string {
  if (tabs.length === 0) {
    return "none; it opens one of its own when it needs a page";
  }
  return tabs
    .map((held) => {
      const own = held.openedBy === "task" ? ", which it opened" : "";
      const closed = getWorkspaceConfig().browser.getTargetMeta(held.id)
        ? ""
        : " (closed since)";
      return `${tabIdOf(held.id)}${own}${closed}`;
    })
    .join("; ");
}

function fail(message: string) {
  return {
    exitCode: 1,
    stderr: `${TASK_COMMAND.name}: ${message}\n`,
    stdout: "",
  };
}

/**
 * The files a message handed a task, at the paths the task reads them by: a
 * copy can take a new name when the task already holds one by that name, and
 * the brief is written against the name the conversation knew.
 */
function handedFiles(message: SessionMessage.UserWithParts): string {
  const files = message.parts.flatMap((part) =>
    part.type === "data-attachments"
      ? part.data.files.map((file) => file.filePath)
      : [],
  );
  return files.length > 0 ? `Its files: ${files.join(", ")}.\n` : "";
}

/**
 * What a task was handed, in this conversation's own paths: the folders named
 * on the command with the access each ended up with, and the workspace folder
 * that goes with them whether it was named or not.
 */
function handedFolders(
  folders: { access: FolderAttachment.Access; path: string }[],
  chatFolders: FolderMounts,
): string {
  return folders
    .map(
      (folder) =>
        `${mountPathOf(folder.path, chatFolders) ?? folder.path} (${folder.access})`,
    )
    .join(", ");
}

/** What a hand-over prints about the tabs it made, or nothing. */
function handedTabsLine(tabs: BrowserTargetId[]): string {
  return tabs.length > 0
    ? `Its tabs: ${tabs.map((id) => tabIdOf(id)).join(", ")}.\n`
    : "";
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
  chatFolders: Record<string, FolderAttachment.Type>,
  taskFolders: FolderMounts,
): undefined | { mountName: string; path: string } {
  const held = Object.values(taskFolders);
  let hostPath: string | undefined;
  try {
    hostPath = resolveFolders([spec], chatFolders)[0]?.path;
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

/**
 * The child whose id shares the most words with a mistyped one, when it
 * shares more than half of them. Words rather than characters, because an id
 * is the date plus the brief's first words, and a guess from the title gets
 * the words right and their order or their tail wrong.
 */
function nearestChildId(rawId: string, children: Task[]): string | undefined {
  const words = new Set(rawId.split("-").filter((word) => word.length > 2));
  if (words.size === 0) {
    return undefined;
  }
  let best: undefined | { id: string; shared: number };
  for (const child of children) {
    const shared = child.id.split("-").filter((word) => words.has(word)).length;
    if (shared > (best?.shared ?? 0)) {
      best = { id: child.id, shared };
    }
  }
  return best && best.shared * 2 > words.size ? best.id : undefined;
}

function ok(stdout: string) {
  return { exitCode: 0, stderr: "", stdout };
}

/**
 * The conversation's own view of the filesystem, which is what a `--file`
 * spec is read against: its folder, the user's mounts, and the read-only
 * mounts of the tasks it created.
 */
async function chatLayout(
  context: TaskCommandContext,
  attachedFolders: Record<string, FolderAttachment.Type>,
): Promise<WorkspaceFsLayout> {
  return buildWorkspaceFsLayout({
    attachedFolders,
    extraMounts: await childTaskMounts(context.chatId),
    taskHostRoot: taskDir(context.chatId),
  });
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
 * wake the chat about it, which is a turn spent on what this catches.
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
  { chatId }: TaskCommandContext,
): Promise<Task> {
  if (!rawId) {
    throw new Error("a task id is required. See `task list`.");
  }
  const parsed = TaskIdSchema.safeParse(rawId);
  if (!parsed.success) {
    throw new Error(`"${rawId}" is not a task id. See \`task list\`.`);
  }
  // Every chat's tasks can be read from any chat; steering one is its own
  // chat's alone (requireOwnChild).
  const task = await getTask(parsed.data);
  const parent = task.isOk() ? task.value.parentTaskId : undefined;
  if (task.isErr() || parent === undefined || !isChatId(parent)) {
    // An id is most often mistyped from the title it was given rather than
    // copied from what `new` printed, so the nearest of the chat's own
    // tasks is offered in the same reply, where `task list` costs a turn.
    const nearest = nearestChildId(rawId, await listChildTasks(chatId));
    throw new Error(
      `no task "${rawId}" of yours.${nearest ? ` Did you mean "${nearest}"?` : ""} See \`task list\`.`,
    );
  }
  return task.value;
}

/**
 * Refuses a brief that names a folder by a path the task will not have. Mount
 * paths are this conversation's own: the task reaches the folders and files it
 * is handed at paths of its own, and a path none of them covers reaches the
 * task as written, naming nothing there. A folder the task is not handed is
 * still something a brief can talk about, by its name, the way a person would.
 */
function requireFoldersNamedInBriefHanded(
  command: "app" | "folder" | "new" | "send",
  prompt: string,
  chatFolders: FolderMounts,
  handed: ({ content: string } | { path: string })[],
  taskId?: string,
) {
  // A file written out on the command has no path, so there is nothing of it
  // a path in the brief could name.
  const paths = handed.flatMap((item) => ("path" in item ? [item.path] : []));
  const chatOnly = chatOnlyPathsIn(prompt, paths);
  if (chatOnly.length > 0) {
    throw new Error(
      `${command}: the ${command === "new" ? "brief" : "message"} names ${chatOnly.join(", ")}, and no task reaches ${MOUNT.apps} or ${MOUNT.tasks}: they are yours alone. Have the task leave what it makes in its own folder and \`cp\` it into place yourself when it reports; hand it a file from one with --file. Nothing was ${command === "new" ? "created" : "sent"}.`,
    );
  }
  const unreachable = unreachableMountPaths(
    prompt,
    chatFolders,
    Object.fromEntries(
      paths.map((itemPath) => [
        itemPath,
        { mountName: itemPath, path: itemPath },
      ]),
    ),
  );
  if (unreachable.length === 0) {
    return;
  }
  const named = unreachable.join(", ");
  const handOver =
    command === "new"
      ? `pass the folder with --folder`
      : command === "folder"
        ? `add it on this command with --add <path>`
        : `hand it over first with \`${TASK_COMMAND.name} folder ${taskId ?? "<id>"} --add <path>\``;
  throw new Error(
    `${command}: the ${command === "new" ? "brief" : "message"} names ${named}, which this task ${command === "new" ? "is not handed" : "was not handed"}. A task reaches only the folders it is handed, at paths of its own, and your paths are translated to its paths only for those folders. If the task needs the folder, ${handOver}; if not, call the folder by its name rather than its path. Nothing was ${command === "new" ? "created" : "sent"}.`,
  );
}

/**
 * The task named, and one this chat may act on: a task started in another
 * chat is that chat's to steer, since its outcome reports there and a
 * message sent into it from here would land in a conversation the user is not
 * having. Reading it (`show`, `log`, `list`) stays open to every chat; the
 * refusal says where to go instead.
 */
async function requireOwnChild(
  rawId: string | undefined,
  context: TaskCommandContext,
): Promise<Task> {
  const task = await requireChild(rawId, context);
  const filedIn =
    task.parentTaskId === undefined
      ? undefined
      : sessionOfChat(task.parentTaskId);
  if (
    task.parentTaskId === context.chatId ||
    task.parentTaskId === undefined ||
    filedIn === undefined
  ) {
    return task;
  }
  const chat = await Store.getSession(filedIn, task.parentTaskId);
  const named = chat.isOk() ? ` ("${chat.value.title}")` : "";
  throw new Error(
    `"${task.id}" was started in another chat${named}, and is that chat's to steer: you can read it (\`task show\`, \`task log\`) but not send to it, stop it, or change it. Tell the user which chat it is in, or start a task of your own here.`,
  );
}

/**
 * The provider this conversation runs on, as the parameters its model URIs
 * carry: the only provider it may put a task on.
 */
async function requireOwnModelParams(context: TaskCommandContext) {
  const params = await ownModelParams(context.chatId);
  if (params === undefined) {
    throw new Error(
      "this conversation has not chosen a model yet, so it has no provider to run a task on.",
    );
  }
  return params;
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
  const { providerConfigId } = await requireOwnModelParams(context);
  if (model.params.providerConfigId !== providerConfigId) {
    throw new Error(
      `${model.uri} is not on this conversation's provider, and a task runs on no other. \`${TASK_COMMAND.name} models\` lists every model you can hand one.`,
    );
  }
}

/**
 * The apps a task is handed, each checked to be connected now: a task given
 * an app that cannot answer would fail on its first call and wake the
 * chat about it, which is a turn wasted on what this catches.
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

/**
 * The model a command names, as `author/id` the way `task models` prints it
 * or as a whole URI. A bare name is completed on the conversation's own
 * provider, the only one a task may run on.
 */
async function resolveModel(rawName: string, context: TaskCommandContext) {
  let modelURI: AIGatewayModelURI.Type;
  try {
    modelURI = completeModelURI(rawName, await requireOwnModelParams(context));
  } catch (error) {
    throw new Error(
      `"${rawName}" is not a model: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const workspaceConfig = getWorkspaceConfig();
  const result = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI,
  });
  if (!result.ok) {
    throw new Error(`model ${rawName}: ${result.error.message}`);
  }
  return { model: result.value, modelURI };
}

async function resolveTab(tab: string): Promise<BrowserTargetId> {
  // The window's tabs are the window's, whichever chat names one.
  const windowId = WINDOW_ID;
  const sessionId = StoreId.SessionSchema.safeParse(tab);
  if (!sessionId.success) {
    throw new Error(
      `"${tab}" is not a tab id; the note on the user's message lists them.`,
    );
  }
  const targetId = encodeBrowserTargetId(windowId, sessionId.data);
  const { browser } = getWorkspaceConfig();
  if (!browser.getTargetMeta(targetId)) {
    throw new Error(`Tab ${tab} is not open any more.`);
  }
  const targets = await browser.listTargets(windowId);
  const target = targets.find((candidate) => candidate.id === targetId);
  if (target && isLocalAddress(target.url)) {
    throw new Error(
      `Tab ${tab} shows a file on this computer, which a task is not handed; give the task the folder the file is in instead.`,
    );
  }
  return targetId;
}

/**
 * A tab id from the note on the user's message is the session half of one of
 * the chat's own browser targets; the target has to exist, since the
 * task connects to it rather than creating anything. A tab showing a file on
 * the computer is not handed over: its address is a path only the window
 * opens, and a task reaches a file through its folders, never through a
 * browser standing on one.
 */
/** Several tab ids, each resolved, without repeats; `closedIsFine` for ids only being let go of. */
async function resolveTabs(
  tabs: string[],
  { closedIsFine = false }: { closedIsFine?: boolean } = {},
): Promise<BrowserTargetId[]> {
  const resolved: BrowserTargetId[] = [];
  for (const tab of tabs) {
    const id = closedIsFine ? await tabTargetOf(tab) : await resolveTab(tab);
    if (!resolved.includes(id)) {
      resolved.push(id);
    }
  }
  return resolved;
}

async function runTrash(args: string[], context: TaskCommandContext) {
  const task = await requireOwnChild(args[0], context);
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
 * Stops what a task left running in the background: the one process named, or
 * every one. Says so when there is nothing, so `--all` on a task with no
 * processes reads as done rather than as silence.
 */
async function stopBackground(taskId: TaskId, wanted?: string) {
  const running = listTaskBackgroundProcesses(taskId).filter(
    (process) => process.status === "running",
  );
  if (running.length === 0) {
    return `${taskId} has nothing running in the background.\n`;
  }
  const targets =
    wanted === undefined
      ? running
      : running.filter((process) => process.id === wanted);
  if (wanted !== undefined && targets.length === 0) {
    const background = leftRunning(taskId)
      .map((process) => describeLeftRunning(process))
      .join(", ");
    throw new Error(
      `no ${wanted} running in ${taskId}. In the background: ${background}.`,
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
        by: "conversation",
        id: process.id,
        sessionId: process.sessionId,
      });
      if (!killed?.stoppedByThisCall) {
        return `${process.id} had already ended.`;
      }
      return killed.terminationConfirmed
        ? `Stopped ${described}.`
        : `Told ${described} to stop, but could not confirm it did; \`${TASK_COMMAND.name} show ${taskId}\` will say.`;
    }),
  );
  return `${lines.join("\n")}\n`;
}

/** Ends a working task's turn, and says whether it went idle in time. */
async function stopTurn(taskId: TaskId, context: TaskCommandContext) {
  // The wake would report the turn this ends as a finish; it is not news.
  expectStop(taskId);
  getWorkspaceActorRef().send({ type: "stopSessions", value: { id: taskId } });
  const timeoutMs = Math.max(
    0,
    Math.min(STOP_CONFIRM_MS, context.remainingYieldMs() - WAIT_MARGIN_MS),
  );
  const stopped = await waitForIdle(taskId, timeoutMs);
  return stopped
    ? `Stopped ${taskId}. Its turn ended where it was; \`task send\` gives it the next thing to do.\n`
    : `Told ${taskId} to stop, and it is still ending; \`task show ${taskId}\` will say when it has.\n`;
}

/** The id a tab goes by in the note and on `--tab`. */
function tabIdOf(targetId: BrowserTargetId): string {
  return decodeBrowserTargetId(targetId)?.sessionId ?? targetId;
}

/**
 * A line for each tab just handed over that another working task holds too:
 * both will act on the same page, which is sometimes the point and otherwise
 * a mistake worth seeing.
 */
async function tabsHeldElsewhere(
  tabs: BrowserTargetId[],
  chatId: TaskId,
  except?: TaskId,
): Promise<string> {
  if (tabs.length === 0) {
    return "";
  }
  const holders = await tabHolders(chatId);
  return tabs
    .flatMap((id) => {
      const holder = holders.get(tabIdOf(id));
      return holder && holder.id !== except
        ? [
            `Tab ${tabIdOf(id)} is also held by ${holder.id} ("${holder.title}"), which is working in it now; both will act on the same page.\n`,
          ]
        : [];
    })
    .join("");
}

/** A tab id in the window's terms, open or not. */
async function tabTargetOf(tab: string): Promise<BrowserTargetId> {
  const sessionId = StoreId.SessionSchema.safeParse(tab);
  if (!sessionId.success) {
    throw new Error(
      `"${tab}" is not a tab id; the note on the user's message lists them.`,
    );
  }
  return encodeBrowserTargetId(WINDOW_ID, sessionId.data);
}

/**
 * Whether a task went idle within `timeoutMs`, checked every
 * {@link STOP_POLL_MS}. A stop ends the step in flight at once, and a session
 * that does not answer is torn down a second later, so a few seconds is
 * enough for anything but a store write that hangs.
 */
async function waitForIdle(taskId: TaskId, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (isWorking(taskId)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  return true;
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

export async function runLog(args: string[], context: TaskCommandContext) {
  const { positional, values } = parseFlags(args, {
    boolean: ["steps"],
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
  const rendered = values.has("steps")
    ? // The outline rather than the transcript: one line per thing the task
      // set out to do or called, with tool output left out. The transcript's
      // tail is whatever printed last, which for a wide search is a page of
      // paths that says nothing about what the task is doing.
      renderSteps(
        await sessionSteps({ sessionId: sessionId.value, taskId: task.id }),
      )
    : await renderTranscript({ sessionId: sessionId.value, taskId: task.id });
  const lines = rendered.trimEnd().split("\n");
  const omitted = Math.max(0, lines.length - tail);
  let text = lines.slice(-tail).join("\n");
  if (text.length > LOG_MAX_BYTES) {
    text = `[...${text.length - LOG_MAX_BYTES} earlier characters omitted]\n${text.slice(-LOG_MAX_BYTES)}`;
  }
  const header =
    omitted > 0
      ? `[${omitted} earlier lines omitted; raise --tail to see more]\n`
      : "";
  // The outline's lines are steps that happened; a working task's last line
  // is the one still happening, which no step line measures.
  const inFlight =
    values.has("steps") && isWorking(task.id)
      ? await stepInFlight(task.id)
      : undefined;
  return ok(`${header}${text}\n${inFlight ? `now: ${inFlight}\n` : ""}`);
}

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
  return tasks.map((task) => {
    const held = taskHold(task.id);
    return {
      id: task.id,
      isRunning: isWorking(task.id),
      leftRunning: leftRunning(task.id).length,
      title: task.title,
      updatedAt: task.updatedAt,
      ...(held ? { waiting: describeHold(held) } : {}),
    };
  });
}

async function renderTranscript({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  // Loaded here rather than at the top: the renderer imports the tool registry,
  // which imports the bash tool, which imports this command, so a static import
  // would close a cycle that leaves the registry half-built when it is read.
  const { getSessionMarkdown } = await import("../session-to-markdown");
  return getSessionMarkdown({
    includeContextMessages: false,
    sessionId,
    taskId,
  });
}

async function runList(args: string[], context: TaskCommandContext) {
  const query = listQueryFrom(args);
  const children = await listChildTasks(context.chatId);
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

async function runModel(args: string[], context: TaskCommandContext) {
  const task = await requireOwnChild(args[0], context);
  const rawURI = args[1];
  if (!rawURI) {
    throw new Error(
      "model: a model is required, named author/id as `models` prints it.",
    );
  }
  const { model, modelURI } = await resolveModel(rawURI, context);
  await requireOwnProvider(model, context);
  await setTaskState(taskDir(task.id), { selectedModelURI: modelURI });
  return ok(`${task.id} will run its next turn on ${modelURI}.\n`);
}

async function runModels(args: string[], context: TaskCommandContext) {
  const { values } = parseFlags(args, { flags: ["author"], repeatable: [] });
  const author = values.get("author")?.[0]?.toLowerCase();
  const { providerConfigId } = await requireOwnModelParams(context);
  const runnable = await listRunnableModels(providerConfigId);
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
  const task = await requireOwnChild(args[0], context);
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
  const children = await listChildTasks(context.chatId);
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
  const held = taskHold(task.id);
  // Everything below is the task's, said in this conversation's paths: the
  // names are the task's own and mean nothing here (see mount-paths.ts).
  const taskFolders = state.attachedFolders ?? {};
  const chatFolders = await mountsOf(context.chatId);
  const folders = Object.values(taskFolders).map(
    (folder) =>
      `${mountPathOf(folder.path, chatFolders) ?? `${MOUNT.attachedFolders}/${folder.mountName}`} (${effectiveFolderAccess(folder)})`,
  );
  const holds = await taskFolderHoldings(task.id);
  const sessionId = await latestSessionId(task.id);
  // Whole, and in this conversation's paths: this is where the note's ceiling
  // sends the conversation for the rest of a receipt it cut.
  const said =
    sessionId.isOk() && sessionId.value
      ? await lastAssistantText({
          sessionId: sessionId.value,
          taskId: task.id,
        })
      : undefined;
  const lastSaid =
    said === undefined
      ? undefined
      : translateTaskFolderPaths(
          translateMountPaths(said, taskFolders, chatFolders),
          task.id,
        );

  const settings = await getTaskSettings(taskDir(task.id));
  const handedApps = settings?.apps ?? [];
  const usage = await getTaskUsageSummary(task.id);
  // Its own line rather than a word in the status: the status is the turn,
  // and a turn that ended with a scan still going leaves the task idle with
  // something running.
  const background = leftRunning(task.id);
  const inFlight = running ? await stepInFlight(task.id) : undefined;
  const lines = [
    `${task.id}: "${task.title}"`,
    `status: ${held ? `waiting: ${describeHold(held)}` : running ? "running" : "idle"}`,
    ...(inFlight ? [`now: ${inFlight}`] : []),
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
    `tabs: ${describeHeldTabs(state.browserTabs ?? [])}`,
    `folder: ${MOUNT.tasks}/${task.id}, holding ${describeHoldings(holds)}`,
    `last said: ${lastSaid ? `\n  ${lastSaid.replaceAll("\n", "\n  ")}` : "nothing yet"}`,
  ];
  return ok(`${lines.join("\n")}\n`);
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
