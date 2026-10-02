/**
 * A CDP command the browser guest did not answer within its budget.
 *
 * Thrown by the host's `BrowserConfig.sendCommand` so a caller can tell a slow
 * or busy page apart from a command that failed outright. A timed-out
 * `Page.navigate` in particular usually means the server was slow to send its
 * first byte, and the navigation carries on without us.
 */
export class CdpCommandTimeoutError extends Error {
  readonly method: string;

  constructor(method: string, message: string) {
    super(message);
    this.method = method;
  }
}
