import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { withShellOutputSink } from "./shell-commands/output-sink";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * A native program's stdout reaching a redirect, a builtin, or another
 * program through the shell: every byte as the program wrote it, on the
 * streamed path and on the buffered one (`INSTRUMENT_NATIVE_PIPES=0`), where
 * every stage's output passes through the shell. The uutils cases need the
 * binaries Studio's postinstall vendors.
 */
const UUTILS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../apps/studio/resources/uutils",
);
const vendored = existsSync(
  path.join(
    UUTILS_DIR,
    process.platform === "win32" ? "coreutils.exe" : "coreutils",
  ),
);

/** Every byte value, then the start of a PNG, whose second byte is not UTF-8. */
const BINARY = Buffer.concat([
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
]);

/** A node program that writes `bytes` to stdout. */
const writes = (bytes: Buffer) =>
  `node -e 'process.stdout.write(Buffer.from("${bytes.toString("base64")}", "base64"))'`;

const sessionId = StoreId.newSessionId();
let tmpDir: string;
let chatRoot: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({ chatId, sessionId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

async function buffered(command: string) {
  process.env.INSTRUMENT_NATIVE_PIPES = "0";
  try {
    return await run(command);
  } finally {
    delete process.env.INSTRUMENT_NATIVE_PIPES;
  }
}

const paths = [
  ["streamed", run],
  ["buffered", buffered],
] as const;

const read = (name: string) => fs.readFile(path.join(chatRoot, name));

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-binary-output-"));
  chatRoot = path.join(tmpDir, "chats", "binary-output");
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.writeFile(path.join(chatRoot, "binary.bin"), BINARY);
  await fs.writeFile(
    path.join(chatRoot, "secret.txt"),
    "password=hunter2\nhttps://user:token@example.com\n",
  );
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  const { uutilsDir: _, ...config } = getWorkspaceConfig();
  setWorkspaceConfig(
    vendored
      ? { ...config, uutilsDir: AbsolutePathSchema.parse(UUTILS_DIR) }
      : config,
  );
});

afterAll(async () => {
  const { uutilsDir: _, ...config } = getWorkspaceConfig();
  setWorkspaceConfig(config);
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.each(paths)("a native program's binary stdout, %s", (name, exec) => {
  it("reaches a file through a redirect", async () => {
    const result = await exec(`${writes(BINARY)} > ${name}-redirect.bin`);
    expect(result.exitCode).toBe(0);
    expect(await read(`${name}-redirect.bin`)).toEqual(BINARY);
  });

  it("reaches a builtin through a pipe", async () => {
    const result = await exec(`${writes(BINARY)} | base64 -w0`);
    expect(result.stdout).toBe(BINARY.toString("base64"));
  });

  it("reaches sha256sum through a pipe", async () => {
    const result = await exec(`${writes(BINARY)} | sha256sum`);
    expect(result.stdout).toBe(
      `${createHash("sha256").update(BINARY).digest("hex")}  -\n`,
    );
  });

  it("carries a builtin's bytes through a program to a file", async () => {
    const result = await exec(
      `cat binary.bin | node -e 'process.stdin.pipe(process.stdout)' > ${name}-cat.bin`,
    );
    expect(result.exitCode).toBe(0);
    expect(await read(`${name}-cat.bin`)).toEqual(BINARY);
  });

  it.runIf(vendored)("comes from uutils head -c into a file", async () => {
    const result = await exec(`head -c 260 binary.bin > ${name}-head.bin`);
    expect(result.exitCode).toBe(0);
    expect(await read(`${name}-head.bin`)).toEqual(BINARY.subarray(0, 260));
  });

  it.runIf(vendored).each([
    ["gzip", "czf", "binary.bin"],
    // An uncompressed ustar archive of text is UTF-8 (macOS' default pax
    // format adds binary attributes), which the shell would otherwise take as
    // text and redact the URL inside the archive.
    ["ustar", "--format=ustar -cf", "secret.txt"],
  ])(
    "comes from the system's tar into a file: %s",
    async (kind, flags, file) => {
      const dir = `${name}-${kind}`;
      const result = await exec(
        `tar ${flags} - ${file} > ${dir}.tar && mkdir ${dir} && tar xf ${dir}.tar -C ${dir}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(await read(path.join(dir, file))).toEqual(await read(file));
    },
  );
});

describe("a native program's stdout shown as the shell's output", () => {
  it("shows UTF-8 text as written", async () => {
    const result = await run(`node -e 'console.log("héllo ✓ 日本")'`);
    expect(result.stdout).toBe("héllo ✓ 日本\n");
  });

  it("still redacts credentials in text", async () => {
    const result = await run(
      `node -e 'console.log("https://user:secret@example.com")'`,
    );
    expect(result.stdout).toBe("https://***@example.com\n");
  });

  // A file it reaches holds the bytes themselves; the shell's output shows
  // the UTF-8 around a stray byte as text, and the byte as its Latin-1 char.
  const MIXED = Buffer.concat([
    Buffer.from("héllo "),
    Buffer.from([0x89, 0x0a]),
  ]);
  const MIXED_SHOWN = `héllo ${String.fromCharCode(0x89)}\n`;

  it("shows text with a stray byte as text and the byte alone", async () => {
    const result = await run(writes(MIXED));
    expect(result.stdout).toBe(MIXED_SHOWN);
  });

  it("shows a stray byte on stderr the same way", async () => {
    const result = await run(
      `node -e 'process.stderr.write(Buffer.from("${MIXED.toString("base64")}", "base64"))'`,
    );
    expect(result.stderr).toBe(MIXED_SHOWN);
  });

  it("shows a background run's live view as its final output", async () => {
    const chunks: string[] = [];
    const result = await withShellOutputSink(
      (text) => {
        chunks.push(text);
      },
      () => run(writes(MIXED)),
    );
    expect(result.stdout).toBe(MIXED_SHOWN);
    expect(chunks.join("")).toBe(MIXED_SHOWN);
  });

  it("has printf write the bytes its escapes name", async () => {
    const result = await run("printf '\\x89\\303\\251' > printf.bin");
    expect(result.exitCode).toBe(0);
    expect([...(await read("printf.bin"))]).toEqual([0x89, 0xc3, 0xa9]);
  });
});
