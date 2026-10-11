import { execa } from "execa";

import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { filterShellOutput } from "./filter-shell-output";
import { getUvBinPath, uvSubprocessEnv } from "./uv";

export async function runUvCommand({
  args,
  cwd,
  signal,
  stdin,
  chatId,
}: {
  args: string[];
  cwd?: AbsolutePath;
  signal?: AbortSignal;
  stdin?: string;
  chatId: ChatId;
}) {
  const result = await execa(getUvBinPath(), args, {
    all: true,
    cancelSignal: signal,
    cwd,
    env: uvSubprocessEnv({ chatId }),
    reject: false,
    ...(stdin === undefined ? { stdin: "ignore" } : { input: stdin }),
  });

  return {
    combined: filterShellOutput(
      result.all ||
        result.shortMessage ||
        "uv failed without diagnostic output.",
    ),
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
  };
}
