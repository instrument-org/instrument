import { randomBytes } from "node:crypto";

/**
 * What a sign-in's `run` is handed: the `state` its authorize URL carries, and
 * the redirect the browser brings back to the loopback server. `received`
 * resolves null when the sign-in is given up in the app or replaced by a
 * newer one, and rejects when nothing came back in time.
 */
export interface LoopbackSignInFlow {
  received: Promise<null | URLSearchParams>;
  state: string;
}

export interface LoopbackSignIn<T> {
  /** Whether a sign-in is waiting on the browser. */
  isWaiting(): boolean;
  /**
   * Hand the browser's redirect to the sign-in waiting for it. Resolves once
   * that sign-in has finished, so the page the browser lands on can say how it
   * went; undefined when nothing is waiting or the redirect is not its own.
   * Any page or local process can reach the callback port, so a redirect that
   * does not match is turned away and the sign-in keeps waiting.
   */
  receive(params: URLSearchParams): Promise<T> | undefined;
  /**
   * Start a sign-in, replacing the one waiting, so a tab that was closed is
   * got past by starting again rather than by canceling first.
   */
  start(run: (flow: LoopbackSignInFlow) => Promise<T>): Promise<T>;
  /**
   * End the sign-in waiting on the browser, if there is one: its `received`
   * resolves null, and the browser's redirect, should it still come, is
   * refused.
   */
  supersede(): void;
}

interface Waiting<T> {
  deliver: (params: URLSearchParams) => void;
  promise: Promise<T>;
  state: string;
  supersede: () => void;
}

/**
 * One provider's sign-in through the browser and back to the loopback server:
 * at most one waits at a time, each carries its own random `state`, and one
 * left too long ends on its own.
 */
export function createLoopbackSignIn<T>({
  accepts = (params, state) => params.get("state") === state,
  onSettled,
  timedOut,
  timeoutMs,
}: {
  /** Whether a redirect is the waiting sign-in's. Defaults to a `state` match. */
  accepts?: (params: URLSearchParams, state: string) => boolean;
  /** Runs after a sign-in settles and is no longer waiting. */
  onSettled?: () => void;
  /** The error `received` rejects with once `timeoutMs` passes. */
  timedOut?: () => Error;
  /** How long a sign-in waits on the browser; forever when left out. */
  timeoutMs?: number;
}): LoopbackSignIn<T> {
  let waiting: null | Waiting<T> = null;

  return {
    isWaiting: () => waiting !== null,
    receive(params) {
      if (!waiting || !accepts(params, waiting.state)) {
        return undefined;
      }
      waiting.deliver(params);
      return waiting.promise;
    },
    start(run) {
      waiting?.supersede();
      let deliver: (params: URLSearchParams) => void = noop;
      let supersede: () => void = noop;
      const received = new Promise<null | URLSearchParams>(
        (resolve, reject) => {
          const timeout =
            timeoutMs === undefined
              ? undefined
              : setTimeout(() => {
                  reject(timedOut?.() ?? new Error("Sign-in timed out"));
                }, timeoutMs);
          deliver = (params) => {
            clearTimeout(timeout);
            resolve(params);
          };
          supersede = () => {
            clearTimeout(timeout);
            resolve(null);
          };
        },
      );
      const state = randomBytes(32).toString("base64url");
      const entry: Waiting<T> = {
        deliver,
        promise: run({ received, state }).finally(() => {
          if (waiting === entry) {
            waiting = null;
          }
          onSettled?.();
        }),
        state,
        supersede,
      };
      waiting = entry;
      return entry.promise;
    },
    supersede() {
      waiting?.supersede();
    },
  };
}

function noop() {
  // Stands in until the promise executor hands over its own.
}
