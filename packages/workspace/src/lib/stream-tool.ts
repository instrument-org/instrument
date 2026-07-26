import { type Result } from "neverthrow";

import { type ExecuteError } from "../lib/execute-error";
import { isAsyncIterable } from "../lib/is-async-iterable";
import { type AnyAgentTool } from "../tools/types";
import { withWorkspaceSkillTracking } from "./workspace-skill-index";

type ExecuteOptions = Parameters<AnyAgentTool["execute"]>[0];
type ExecuteResult = Result<unknown, ExecuteError>;

export async function* streamTool({
  execute,
  options,
}: {
  execute: AnyAgentTool["execute"];
  options: ExecuteOptions;
}): AsyncGenerator<
  | { output: ExecuteResult; type: "final" }
  | { output: ExecuteResult; type: "preliminary" }
> {
  const tracked = <T>(callback: () => T) =>
    withWorkspaceSkillTracking(
      { id: options.taskId, sessionId: options.sessionId },
      callback,
    );
  const result = tracked(() => execute(options));

  if (isAsyncIterable(result)) {
    let lastOutput: ExecuteResult | undefined;
    const iterator = result[Symbol.asyncIterator]();
    let completed = false;
    try {
      while (true) {
        const next = await tracked(() => iterator.next());
        if (next.done) {
          completed = true;
          break;
        }
        lastOutput = next.value;
        yield { output: next.value, type: "preliminary" };
      }
    } finally {
      if (!completed) {
        await tracked(() => iterator.return(undefined));
      }
    }
    if (lastOutput !== undefined) {
      yield { output: lastOutput, type: "final" };
    }
  } else {
    // TypeScript can't narrow the union after the AsyncIterable check
    yield { output: await (result as Promise<ExecuteResult>), type: "final" };
  }
}
