import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import {
  createMockChatConfig,
  createMockChatConfigForDir,
} from "../test/helpers/mock-chat-config";
import {
  nearestVenv,
  uvSubprocessEnv,
  venvPython,
  withPythonVersionNote,
  workVenvDir,
} from "./uv";
import { workDir } from "./work-dir";

const isWindows = process.platform === "win32";
const chatId = createMockChatConfig(ChatIdSchema.parse("test"));

describe("workVenvDir", () => {
  it("resolves to .venv at the root of the chat's work folder", () => {
    expect(workVenvDir(chatId).replaceAll("\\", "/")).toBe(
      "/tmp/workspace-machine/work/test/.venv",
    );
  });
});

describe("venvPython", () => {
  it("points at the venv interpreter for the platform layout", () => {
    const expected = isWindows
      ? "work/test/.venv/Scripts/python.exe"
      : "work/test/.venv/bin/python";
    expect(venvPython(workVenvDir(chatId)).replaceAll("\\", "/")).toContain(
      expected,
    );
  });
});

/**
 * A chat whose work folder holds a virtualenv at its root and one in `job/`,
 * and none in `other/`.
 */
function chatWithVenvs() {
  const id = createMockChatConfigForDir(
    path.join(mkdtempSync(path.join(os.tmpdir(), "nearest-venv-")), "chat"),
  );
  const root = workDir(id);
  for (const venv of [".venv", "job/.venv"]) {
    mkdirSync(path.join(root, venv), { recursive: true });
    writeFileSync(path.join(root, venv, "pyvenv.cfg"), "");
  }
  mkdirSync(path.join(root, "job", "deeper"), { recursive: true });
  mkdirSync(path.join(root, "other"), { recursive: true });
  return { id, root };
}

describe("nearestVenv", () => {
  it.each([
    { cwd: ".", venv: ".venv" },
    { cwd: "job", venv: "job/.venv" },
    { cwd: "job/deeper", venv: "job/.venv" },
    { cwd: "other", venv: ".venv" },
  ])("takes $venv from $cwd", ({ cwd, venv }) => {
    const { id, root } = chatWithVenvs();
    expect(nearestVenv(id, path.join(root, cwd))).toBe(path.join(root, venv));
  });

  it("takes the work folder's own from a folder outside it", () => {
    const { id, root } = chatWithVenvs();
    expect(nearestVenv(id, os.homedir())).toBe(path.join(root, ".venv"));
  });

  it("finds none where no folder up to the work folder's root holds one", () => {
    const id = createMockChatConfigForDir(
      path.join(mkdtempSync(path.join(os.tmpdir(), "nearest-venv-")), "chat"),
    );
    mkdirSync(path.join(workDir(id), "job"), { recursive: true });
    expect(nearestVenv(id, path.join(workDir(id), "job"))).toBeUndefined();
    expect(nearestVenv(id, os.homedir())).toBeUndefined();
  });
});

describe("uvSubprocessEnv", () => {
  const env = uvSubprocessEnv({ chatId, cwd: workDir(chatId) });
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

  it("points VIRTUAL_ENV at the venv nearest the command's folder", () => {
    const { id, root } = chatWithVenvs();
    expect(
      uvSubprocessEnv({ chatId: id, cwd: path.join(root, "job", "deeper") })
        .VIRTUAL_ENV,
    ).toBe(path.join(root, "job", ".venv"));
  });

  it("names no VIRTUAL_ENV where no venv is near", () => {
    expect(env.VIRTUAL_ENV).toBeUndefined();
  });

  it("redirects model/data caches to app-managed dirs without overriding HOME", () => {
    expect(env.XDG_CACHE_HOME).toBe(path.join(runtime, "caches"));
    expect(env.HF_HOME).toBe(path.join(runtime, "caches", "huggingface"));
    expect(env.U2NET_HOME).toBe(path.join(runtime, "caches", "u2net"));
    // HOME stays the real host home (or unset), never the isolated dir.
    expect(env.HOME).toBe(process.env.HOME);
  });

  it("prepends the uv binary dir and the nearest venv's bin dir to PATH", () => {
    const { id, root } = chatWithVenvs();
    const dirs = (
      uvSubprocessEnv({ chatId: id, cwd: path.join(root, "job") }).PATH ?? ""
    ).split(path.delimiter);
    expect(dirs[0]).toBe(path.dirname("/tmp/uv"));
    expect(dirs[1]).toBe(
      path.join(root, "job", ".venv", isWindows ? "Scripts" : "bin"),
    );
  });
});
