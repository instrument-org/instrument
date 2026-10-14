import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { ensureChatVenv } from "./ensure-chat-venv";
import { runUvCommand } from "./run-uv";
import { chatVenvPython } from "./uv";
import { workDir } from "./work-dir";

type PythonSkillInstallResult =
  | { exitCode: number; output: string; state: "failure" }
  | { state: "success" };

export async function installPythonSkill({
  signal,
  skillDir,
  chatId,
}: {
  signal: AbortSignal;
  skillDir: AbsolutePath;
  chatId: ChatId;
}): Promise<PythonSkillInstallResult> {
  // The chat's folder, so uv discovers the venv where it now lives rather than
  // relying on VIRTUAL_ENV alone.
  const dir = workDir(chatId);
  const python = chatVenvPython(chatId);

  const venvError = await ensureChatVenv({ signal, chatId });
  if (venvError !== undefined) {
    return { ...venvError, state: "failure" };
  }

  const exportResult = await runUvCommand({
    args: [
      "export",
      "--locked",
      "--no-dev",
      "--no-emit-project",
      "--no-hashes",
      "--project",
      skillDir,
    ],
    cwd: dir,
    lockfilePinned: true,
    signal,
    chatId,
  });
  if (exportResult.exitCode !== 0) {
    return {
      exitCode: exportResult.exitCode,
      output: exportResult.combined,
      state: "failure",
    };
  }

  if (!hasRequirements(exportResult.stdout)) {
    return { state: "success" };
  }

  const installResult = await runUvCommand({
    args: ["pip", "install", "--python", python, "--requirement", "-"],
    cwd: dir,
    lockfilePinned: true,
    signal,
    stdin: exportResult.stdout,
    chatId,
  });
  return installResult.exitCode === 0
    ? { state: "success" }
    : {
        exitCode: installResult.exitCode,
        output: installResult.combined,
        state: "failure",
      };
}

function hasRequirements(requirements: string) {
  return requirements.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}
