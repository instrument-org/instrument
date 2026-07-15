import { type AbsolutePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { ensureTaskVenvForTask } from "./ensure-task-venv";
import { runUvCommand } from "./run-uv";
import { getTaskWorkDir, taskDir } from "./task-dir-utils";
import { taskVenvPython } from "./uv";

type PythonSkillInstallResult =
  | { exitCode: number; output: string; state: "failure" }
  | { state: "success" };

export async function installPythonSkill({
  signal,
  skillDir,
  taskId,
}: {
  signal: AbortSignal;
  skillDir: AbsolutePath;
  taskId: TaskId;
}): Promise<PythonSkillInstallResult> {
  const workDir = getTaskWorkDir(taskDir(taskId));
  const python = taskVenvPython(taskId);

  const venvError = await ensureTaskVenvForTask({ signal, taskId });
  if (venvError !== undefined) {
    return { ...venvError, state: "failure" };
  }

  const exportResult = await runUvCommand({
    args: [
      "export",
      "--locked",
      "--no-emit-project",
      "--no-hashes",
      "--project",
      skillDir,
    ],
    cwd: workDir,
    signal,
    taskId,
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
    cwd: workDir,
    signal,
    stdin: exportResult.stdout,
    taskId,
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
