/**
 * Listens for a signal in the main process in a way that wins over Chromium's
 * own shutdown handler, which Electron installs with `sigaction` as its
 * message loop starts and which calls `app.quit()` with no trace of the
 * signal.
 *
 * Node's first listener for a signal opens a libuv handle, and only opening
 * one installs libuv's handler; later listeners share it. A library that
 * listens before Electron starts (electron-store's `when-exit` does, at
 * import) opens that handle early, Chromium's handler replaces libuv's, and
 * every listener added afterward is never called. So this takes the
 * listeners already there off, which closes the handle, and puts them back
 * with this one, which opens a new handle and installs libuv's handler over
 * Chromium's. Raw listeners keep a `once` listener once, in its place.
 *
 * Between the two the signal has its default action, for as long as a few
 * synchronous calls take.
 */
export function takeSignal(
  target: Pick<NodeJS.Process, "on" | "rawListeners" | "removeAllListeners">,
  signal: NodeJS.Signals,
  listener: NodeJS.SignalsListener,
) {
  // rawListeners is typed for any event; these all came off this signal.
  const earlier = target.rawListeners(signal) as NodeJS.SignalsListener[];
  target.removeAllListeners(signal);
  for (const each of earlier) {
    target.on(signal, each);
  }
  target.on(signal, listener);
}
