import { APP_NAME_SLUG } from "@instrument-org/shared";
import { platform } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { AGENT_BROWSER_SOCKET_DIR } from "./agent-browser";

const isUnix = platform() !== "win32";

// The unix socket path limit is 103 bytes on macOS / 107 on Linux.
// Use a representative worst-case session name to guard against regressions.
describe("AGENT_BROWSER_SOCKET_DIR", () => {
  it("is undefined on Windows, rooted in /tmp on unix", () => {
    if (!isUnix) {
      expect(AGENT_BROWSER_SOCKET_DIR).toBeUndefined();
      return;
    }
    expect(AGENT_BROWSER_SOCKET_DIR).toBe(
      path.join("/tmp", `.${APP_NAME_SLUG}-browser`),
    );
  });

  it("keeps socket paths under the 103-byte unix limit for a session ID", () => {
    if (!isUnix || !AGENT_BROWSER_SOCKET_DIR) {
      return;
    }
    const sessionId = StoreId.newSessionId();
    const socketPath = path.join(AGENT_BROWSER_SOCKET_DIR, `${sessionId}.sock`);
    expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(103);
  });

  it("socket path byte length is independent of the username", () => {
    if (!isUnix || !AGENT_BROWSER_SOCKET_DIR) {
      return;
    }
    // /tmp/.instrument-browser/ses_<26-char-ulid>.sock = 60 bytes, fixed.
    const sessionId = StoreId.newSessionId();
    const socketPath = path.join(AGENT_BROWSER_SOCKET_DIR, `${sessionId}.sock`);
    expect(Buffer.byteLength(socketPath)).toBe(60);
  });
});
