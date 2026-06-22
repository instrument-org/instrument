import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./app-dir-utils";

export function redactWorkspacePaths(message: string, taskId: TaskId): string {
  let redactedMessage = message;

  const pathsToRedact = [
    {
      fullPath: taskDir(taskId),
      replacement: "",
    },
  ];

  for (const { fullPath, replacement } of pathsToRedact) {
    // Handle literal paths
    const escapedPath = escapeRegExp(fullPath);
    const regex = new RegExp(escapedPath, "g");
    redactedMessage = redactedMessage.replace(regex, replacement);

    // Handle URL-encoded versions where spaces become %20
    const urlEncodedPath = fullPath.replaceAll(" ", "%20");
    const escapedUrlEncodedPath = escapeRegExp(urlEncodedPath);
    const urlEncodedRegex = new RegExp(escapedUrlEncodedPath, "g");
    redactedMessage = redactedMessage.replace(urlEncodedRegex, replacement);
  }

  return redactedMessage;
}

function escapeRegExp(string: string): string {
  return string.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
