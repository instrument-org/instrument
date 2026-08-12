/** Ports tried, counting the base port, before giving up. */
const DEFAULT_ATTEMPTS = 20;

/**
 * Structural rather than `node:net`'s `Server`, so this module imports no Node
 * built-ins: everything in this package has to stay loadable in the browser.
 */
interface BindableServer {
  once: (event: string, listener: (error?: unknown) => void) => unknown;
  removeListener: (
    event: string,
    listener: (error?: unknown) => void,
  ) => unknown;
}

/**
 * Starts `listen` on the first port that accepts a bind, counting up from
 * `basePort`.
 *
 * Testing a port before binding it cannot be made correct: it is free when the
 * test closes its socket and taken by the time the real server asks for it,
 * which is how two instances starting at the same moment end up on one number.
 * The bind is the only test that holds, so a refused port is treated as the
 * answer rather than as a failure.
 *
 * Rejects once every port in the range is taken, and rethrows anything that is
 * not a port conflict. Callers own both: an unhandled rejection here reaches
 * the process, which in the main process means a crash dialog.
 */
export async function listenWithPortFallback<T extends BindableServer>({
  attempts = DEFAULT_ATTEMPTS,
  basePort,
  listen,
}: {
  attempts?: number;
  basePort: number;
  listen: (port: number) => T;
}): Promise<{ port: number; server: T }> {
  const lastPort = basePort + attempts - 1;

  for (let port = basePort; port <= lastPort; port++) {
    const server = listen(port);
    // One handler for both events: `listening` carries no argument, so the
    // bind that succeeds is the one that settles with nothing.
    const listenError = await new Promise<unknown>((resolve) => {
      const onSettled = (error?: unknown) => {
        server.removeListener("error", onSettled);
        server.removeListener("listening", onSettled);
        resolve(error);
      };
      server.once("error", onSettled);
      server.once("listening", onSettled);
    });

    if (listenError === undefined) {
      return { port, server };
    }

    // A bind that fails has already closed its own handle, so there is nothing
    // to clean up before trying the next port.
    if (!isPortTaken(listenError)) {
      throw listenError instanceof Error
        ? listenError
        : new Error(`Failed to listen on port ${port}`, {
            cause: listenError,
          });
    }
  }

  throw new Error(`No port free between ${basePort} and ${lastPort}`);
}

function isPortTaken(error: unknown) {
  return (
    error instanceof Error && "code" in error && error.code === "EADDRINUSE"
  );
}
