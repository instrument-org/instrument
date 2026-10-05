/**
 * A request and its answer between the page editor in a guest and the window
 * that embeds it. Their channel carries one-way messages, so each side that
 * asks something numbers the question and waits for the answer with that
 * number, and each side that is asked always answers: with the result, or
 * with what kept it from one. A question nobody answers fails at its
 * deadline rather than holding everything queued behind it.
 *
 * No validator here: the guest's sandboxed bundle runs this too, and the
 * window checks the guest's messages against its schema before they reach
 * {@link createRequests} or {@link answerRequest}.
 */

export interface EditorRequest<R> {
  id: number;
  request: R;
  type: "request";
}

export type EditorResponse<T> =
  | { error: string; id: number; type: "response" }
  | { id: number; result: T; type: "response" };

/**
 * The asking side: `request` sends a question and settles with its answer,
 * `settle` hands it each answer that arrives, and `abandon` fails every
 * question still waiting, for a peer that is gone.
 */
export function createRequests<R, T>({
  send,
  timeoutMs,
}: {
  send: (message: EditorRequest<R>) => void;
  timeoutMs: number;
}) {
  const waiting = new Map<
    number,
    {
      reject: (error: Error) => void;
      resolve: (result: T) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let lastId = 0;

  const finish = (id: number) => {
    const entry = waiting.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      waiting.delete(id);
    }
    return entry;
  };

  return {
    abandon(reason: string) {
      for (const id of waiting.keys()) {
        finish(id)?.reject(new Error(reason));
      }
    },
    request(request: R): Promise<T> {
      lastId += 1;
      const id = lastId;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          finish(id)?.reject(
            new Error(`No answer within ${timeoutMs / 1000}s`),
          );
        }, timeoutMs);
        waiting.set(id, { reject, resolve, timer });
        try {
          send({ id, request, type: "request" });
        } catch (error) {
          finish(id)?.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    },
    settle(response: EditorResponse<T>) {
      const entry = finish(response.id);
      if (!entry) {
        return;
      }
      if ("error" in response) {
        entry.reject(new Error(response.error));
      } else {
        entry.resolve(response.result);
      }
    },
  };
}

/** Answers one question, whatever `handle` does: with its result, or with what it threw. */
export async function answerRequest<R, T>(
  { id, request }: EditorRequest<R>,
  handle: (request: R) => Promise<T>,
  send: (response: EditorResponse<T>) => void,
): Promise<void> {
  let response: EditorResponse<T>;
  try {
    response = { id, result: await handle(request), type: "response" };
  } catch (error) {
    response = {
      error: error instanceof Error ? error.message : String(error),
      id,
      type: "response",
    };
  }
  send(response);
}
