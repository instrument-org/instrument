import { type AbsolutePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { runUvCommand } from "./run-uv";
import { venvPython, workVenvDir } from "./uv";
import { ensureVenv } from "./venv";
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
  // Into the virtualenv at the root of the work folder, which `python` there
  // runs in, made now where there is none.
  const dir = workDir(chatId);
  const venv = workVenvDir(chatId);
  const python = venvPython(venv);

  const venvError = await ensureVenv({ chatId, signal, venv });
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
