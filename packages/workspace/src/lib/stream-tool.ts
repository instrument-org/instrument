import { type Result } from "neverthrow";

import { type ExecuteError } from "../lib/execute-error";
import { isAsyncIterable } from "../lib/is-async-iterable";
import { type AnyAgentTool } from "../tools/types";
import { withTurnContext } from "./turn-context";

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
  // Every resumption re-enters the turn: an async generator's body runs in the
  // context of whoever called `next()`, not the one it was created in, so a
  // single wrap around `execute` would cover only the code before the first
  // yield.
  const inTurn = <T>(callback: () => T) =>
    withTurnContext(
      { id: options.taskId, sessionId: options.sessionId },
      callback,
    );
  const result = inTurn(() => execute(options));

  if (isAsyncIterable(result)) {
    let lastOutput: ExecuteResult | undefined;
    const iterator = result[Symbol.asyncIterator]();
    let completed = false;
    try {
      while (true) {
        const next = await inTurn(() => iterator.next());
        if (next.done) {
          completed = true;
          break;
        }
        lastOutput = next.value;
        yield { output: next.value, type: "preliminary" };
      }
    } finally {
      if (!completed) {
        await inTurn(() => iterator.return(undefined));
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
