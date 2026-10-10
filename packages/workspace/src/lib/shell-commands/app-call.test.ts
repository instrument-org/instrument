import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { loadApp } from "../apps/store";
import { createLocalBashEnv } from "../create-bash-env";
import { chatDir } from "../record-folders";
import { updateChatSettings } from "../chat-settings";
import { getWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";
import { knowChat } from "../../test/helpers/mock-chat-config";

vi.mock("../apps/preflight", () => ({
  mcpSignInSupport: vi.fn(() => Promise.resolve("unknown")),
  packageExists: vi.fn(() => Promise.resolve("unknown")),
}));

const taskId = ChatIdSchema.parse("app-call-task");
const slug = "tracker";
let server: http.Server;
let fs = new InMemoryFs();

// A real MCP server on loopback, so a call goes through the same client and
// transport it does for a connected app.
beforeAll(async () => {
  server = http.createServer((req, res) => {
    void (async () => {
      const mcp = new McpServer({ name: "tracker", version: "1.0.0" });
      mcp.registerTool(
        "issues",
        {
          description: "List issues",
          outputSchema: { issues: z.array(z.string()), total: z.number() },
        },
        () => ({
          content: [{ text: "2 issues: one, two", type: "text" }],
          structuredContent: { issues: ["one", "two"], total: 2 },
        }),
      );
      mcp.registerTool("json_text", { description: "JSON as text" }, () => ({
        content: [{ text: '[{"id":1},{"id":2},{"id":3}]', type: "text" }],
      }));
      mcp.registerTool("prose", { description: "Plain text" }, () => ({
        content: [{ text: "line one\nline two", type: "text" }],
      }));
      mcp.registerTool("broken", { description: "Always refuses" }, () => ({
        content: [{ text: "project is required", type: "text" }],
        isError: true,
      }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      await transport.handleRequest(
        req,
        res,
        chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : undefined,
      );
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }

  knowChat(taskId);
  const created = await app(
    "new",
    slug,
    "--name",
    "Tracker",
    "--mcp",
    `http://127.0.0.1:${address.port}/mcp`,
    "--auth",
    "none",
  );
  expect(created.stderr).toBe("");
  expect(created.exitCode).toBe(0);
  const { manifestHash } = (
    await loadApp(getWorkspaceConfig().appsDir, slug)
  )._unsafeUnwrap();
  await getWorkspaceConfig().apps.connections.set(slug, {
    manifestHash,
    status: "connected",
    updatedAt: 1,
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(async () => {
  knowChat(taskId);
  fs = new InMemoryFs();
  await fs.mkdir("/task", { recursive: true });
});

async function app(...args: string[]) {
  return createAppCommand({ taskId }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs,
      stdin: EMPTY_BYTES,
    }),
  );
}

describe("app call --out", () => {
  it("writes a structured result as JSON and prints one line", async () => {
    const result = await app("call", slug, "issues", "--out", "issues.json");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Wrote issues.json: the tool's structured result, an object with keys "issues", "total", 56 bytes.
      "
    `);
    expect(JSON.parse(await fs.readFile("/task/issues.json"))).toEqual({
      issues: ["one", "two"],
      total: 2,
    });
  });

  it.each([
    ["json_text", "JSON text, an array of 3"],
    ["prose", "text, 2 lines"],
  ])("writes %s's text as the service sent it", async (tool, shape) => {
    const result = await app("call", slug, tool, "--out", "out.txt");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Wrote out.txt: ${shape},`);
  });

  it("prints a refusal rather than writing it", async () => {
    const result = await app("call", slug, "broken", "--out", "out.json");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("project is required");
    expect(await fs.exists("/task/out.json")).toBe(false);
  });

  it("prints the result as the service sent it without --out", async () => {
    const result = await app("call", slug, "issues");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("2 issues: one, two\n");
  });
});

describe("app call in a pipeline", () => {
  it("hands jq the service's JSON", async () => {
    await mkdir(chatDir(taskId), { recursive: true });
    const bash = await createLocalBashEnv({
      sessionId: StoreId.newSessionId(),
      taskId,
    });
    const result = await bash.exec(`app call ${slug} json_text | jq 'length'`);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("3\n");
  });
});

describe("js-exec tools.*", () => {
  async function script(code: string, id = taskId) {
    await mkdir(chatDir(id), { recursive: true });
    const bash = await createLocalBashEnv({
      sessionId: StoreId.newSessionId(),
      taskId: id,
    });
    return bash.exec(`js-exec <<'EOF'
${code}
EOF`);
  }

  it("hands a structured result back as a value", async () => {
    const result = await script(
      `const { issues, total } = await tools.${slug}.issues({});
console.log(total, issues.join("+"));`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("2 one+two\n");
  });

  it.each([
    ["json_text", "console.log(r.length, r[2].id)", "3 3\n"],
    ["prose", "console.log(typeof r, r.split('\\n').length)", "string 2\n"],
  ])("hands %s's text back parsed where it is JSON", async (tool, use, out) => {
    const result = await script(
      `const r = await tools["${slug}"].${tool}();
${use}`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(out);
  });

  it("throws a refusal into the script", async () => {
    const result = await script(
      `try { await tools.${slug}.broken({ project: 1 }); } catch (error) { console.log(error.message); }`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "tools.tracker.broken: project is required
      The tool refused the call. If the arguments were the problem, \`app tool tracker broken\` shows the JSON it takes.
      "
    `);
  });

  it("refuses an app the task was not handed", async () => {
    const scoped = ChatIdSchema.parse("app-call-scoped-task");
    knowChat(scoped);
    (await updateChatSettings(scoped, { apps: ["notes"] }))._unsafeUnwrap();
    const result = await script(`await tools.${slug}.issues();`, scoped);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatchInlineSnapshot(`
      "at <stdin>:1:26: tools.tracker.issues: this task was not handed the app "tracker". Apps it has: notes.
      "
    `);
  });
});
