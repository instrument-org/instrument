import { APP_NAME_SLUG } from "@instrument-org/shared";
import { platform } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { AGENT_BROWSER_SOCKET_DIR } from "./agent-browser";

const isWindows = platform() === "win32";

describe("AGENT_BROWSER_SOCKET_DIR", () => {
  it.runIf(isWindows)("is unset on Windows", () => {
    expect(AGENT_BROWSER_SOCKET_DIR).toBeUndefined();
  });

  // The unix socket path limit is 103 bytes on macOS and 107 on Linux, so the
  // folder is a fixed one in /tmp rather than `os.tmpdir()`, which on macOS is
  // a long per-user path.
  it.skipIf(isWindows)(
    "is a fixed folder in /tmp that keeps a session's socket under the 103-byte limit",
    () => {
      expect(AGENT_BROWSER_SOCKET_DIR).toBe(
        path.join("/tmp", `.${APP_NAME_SLUG}-browser`),
      );
      const socketPath = path.join(
        AGENT_BROWSER_SOCKET_DIR ?? "",
        `${StoreId.newSessionId()}.sock`,
      );
      expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(103);
    },
  );
});
