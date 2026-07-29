import path from "node:path";

export function parseRunBashArgs(argv: string[]) {
  const attach: string[] = [];
  let bail = false;
  const commands: string[] = [];
  let taskId: string | undefined;
  let tasksDir: string | undefined;

  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    switch (arg) {
      case "--attach": {
        const dir = remaining.shift();
        if (dir === undefined || dir.startsWith("--")) {
          throw new Error("--attach requires a directory path");
        }
        attach.push(path.resolve(dir));

        break;
      }
      case "--bail": {
        bail = true;

        break;
      }
      case "--task": {
        taskId = remaining.shift();

        break;
      }
      case "--tasks-dir": {
        tasksDir = remaining.shift();

        break;
      }
      default: {
        if (arg !== undefined && !arg.startsWith("-")) {
          commands.push(arg);
        }
      }
    }
  }

  return { attach, bail, commands, taskId, tasksDir };
}
