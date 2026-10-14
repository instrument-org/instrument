import path from "node:path";
import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import {
  chatVenvDir,
  chatVenvPython,
  uvSubprocessEnv,
  withPythonVersionNote,
} from "./uv";

const isWindows = process.platform === "win32";
const chatId = createMockChatConfig(ChatIdSchema.parse("test"));

describe("chatVenvDir", () => {
  it("resolves to .venv at the root of the chat's work folder", () => {
    expect(chatVenvDir(chatId).replaceAll("\\", "/")).toBe(
      "/tmp/workspace-machine/work/test/.venv",
    );
  });
});

describe("chatVenvPython", () => {
  it("points at the venv interpreter for the platform layout", () => {
    const expected = isWindows
      ? "work/test/.venv/Scripts/python.exe"
      : "work/test/.venv/bin/python";
    expect(chatVenvPython(chatId).replaceAll("\\", "/")).toContain(expected);
  });
});

describe("uvSubprocessEnv", () => {
  const env = uvSubprocessEnv({ chatId });
  const runtime = "/tmp/workspace/runtime";

  it("keeps uv's cache and tools in the runtime caches, and its Pythons in their own folder", () => {
    expect(env.UV_CACHE_DIR).toBe(path.join(runtime, "caches", "uv"));
    expect(env.UV_PYTHON_INSTALL_DIR).toBe(path.join(runtime, "python"));
    expect(env.UV_TOOL_DIR).toBe(path.join(runtime, "caches", "uv-tools"));
  });

  it("pins uv to managed Python, which the app installs, and ignores host config", () => {
    expect(env.UV_NO_CONFIG).toBe("1");
    expect(env.UV_PYTHON_PREFERENCE).toBe("only-managed");
    expect(env.UV_PYTHON_DOWNLOADS).toBe("never");
  });

  it("says which Python there is when uv wants another version", () => {
    expect(
      withPythonVersionNote(
        "error: No interpreter found for Python 3.11 in managed installations\n",
      ),
    ).toMatchInlineSnapshot(`
      "error: No interpreter found for Python 3.11 in managed installations
      Only Python 3.12 is available, and no other version can be installed. Use \`--python 3.12\`, or a project whose requires-python allows 3.12.
      "
    `);
    expect(withPythonVersionNote("error: other\n")).toBe("error: other\n");
  });

  it("points VIRTUAL_ENV at the chat's venv", () => {
    expect(env.VIRTUAL_ENV).toBe(chatVenvDir(chatId));
  });

  it("redirects model/data caches to app-managed dirs without overriding HOME", () => {
    expect(env.XDG_CACHE_HOME).toBe(path.join(runtime, "caches"));
    expect(env.HF_HOME).toBe(path.join(runtime, "caches", "huggingface"));
    expect(env.U2NET_HOME).toBe(path.join(runtime, "caches", "u2net"));
    // HOME stays the real host home (or unset), never the isolated dir.
    expect(env.HOME).toBe(process.env.HOME);
  });

  it("prepends the uv binary dir and venv bin dir to PATH", () => {
    const dirs = (env.PATH ?? "").split(path.delimiter);
    expect(dirs[0]).toBe(path.dirname("/tmp/uv"));
    expect(dirs[1]).toContain(path.join("work", "test", ".venv"));
  });
});
