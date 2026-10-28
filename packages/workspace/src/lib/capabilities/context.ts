import { stat } from "node:fs/promises";
import nodePath from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { readModelWindow } from "../model-window";
import { type SubcommandShell } from "../shell-commands/subcommands";
import {
  hostPathOf,
  unsandboxedOperandRefusal,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { type CapabilityContext, type Surface } from "./define";

/** What a shell knows about the bash call it runs, from which each call's context is made. */
export interface CapabilityScope {
  chatId: ChatId;
  /**
   * The shell's folders under the chat's rules, which a file handed to an
   * app is held to; without them no file is handed over.
   */
  layout?: WorkspaceFsLayout;
  model?: string;
  /** The bash call, by its part's id, which a card the call raises names. */
  partId?: StoreId.Part;
  role: "chat" | "task";
  sessionId: StoreId.Session;
}

/** The ways a file is looked at: the shell's, from its folder, or a script's, by its full path. */
type FileLook = Pick<SubcommandShell, "cwd" | "fs"> | undefined;

/** What is at `resolved` in the shell's filesystem. */
async function shellFileKind(
  shell: NonNullable<FileLook>,
  resolved: string,
): Promise<"file" | "folder" | "none"> {
  if (!(await shell.fs.exists(resolved))) {
    return "none";
  }
  return (await shell.fs.stat(resolved)).isDirectory ? "folder" : "file";
}

/**
 * A file named for an app to read outside every sandbox, as the absolute
 * path the chat may read: held to the folder rules for reading, as the
 * shell's own commands hold a path, and to them again where a link leads;
 * then it has to be a file. A shell resolves it from its folder; a script
 * names it by its full path.
 */
async function readableFile(
  named: string,
  layout: WorkspaceFsLayout | undefined,
  shell: FileLook,
): Promise<string> {
  if (layout === undefined) {
    throw new Error(`${named}: no folder rules here to hand a file over by.`);
  }
  if (shell === undefined && !nodePath.isAbsolute(named)) {
    throw new Error(`${named}: a script names a file by its full path.`);
  }
  const resolved = shell ? shell.fs.resolvePath(shell.cwd, named) : named;
  const refusal = unsandboxedOperandRefusal(layout, resolved, "read");
  if (refusal !== undefined) {
    throw new Error(`${named}: Permission denied\n${refusal}`);
  }
  const found = shell
    ? await shellFileKind(shell, resolved)
    : await stat(hostPathOf(resolved)).then(
        (each) => (each.isDirectory() ? "folder" : "file"),
        () => "none",
      );
  if (found === "none") {
    throw new Error(`no file at ${named} to attach.`);
  }
  if (found === "folder") {
    throw new Error(`${named} is a folder; attach the files in it instead.`);
  }
  return hostPathOf(resolved);
}

/**
 * The contexts of the calls one bash call makes, on one surface. The model
 * window is read once, at the first call that asks: it is the same for the
 * whole bash call, since nothing it does is in the window until it returns.
 */
export function capabilityContexts(
  { chatId, layout, model, partId, role, sessionId }: CapabilityScope,
  surface: Surface,
): (signal?: AbortSignal, shell?: FileLook) => CapabilityContext {
  let window: ReturnType<CapabilityContext["modelWindow"]> | undefined;
  const modelWindow = () =>
    (window ??= readModelWindow({ chatId, model, sessionId }));
  return (signal, shell) => ({
    asker: { chatId, ...(partId === undefined ? {} : { partId }), sessionId },
    chatId,
    ...(model === undefined ? {} : { model }),
    modelWindow,
    readableFile: (named) => readableFile(named, layout, shell),
    role,
    sessionId,
    ...(signal === undefined ? {} : { signal }),
    surface,
  });
}
