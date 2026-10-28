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
import { getWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";
import { knowChat } from "../../test/helpers/mock-chat-config";

// Whether the model has the app's guide, which the hand-off tests turn off;
// the rest are about what a call prints once it goes out.
const guide = vi.hoisted(() => ({ handedOver: true }));
vi.mock("../apps/guide-hand-off", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apps/guide-hand-off")>()),
  anyAppGuideHandedOver: () => guide.handedOver,
  appGuideHandedOver: () => guide.handedOver,
}));

vi.mock("../apps/preflight", () => ({
  mcpSignInSupport: vi.fn(() => Promise.resolve("unknown")),
  packageExists: vi.fn(() => Promise.resolve("unknown")),
}));

const chatId = ChatIdSchema.parse("app-call-task");
const slug = "tracker";
let server: http.Server;
let fs = new InMemoryFs();

// A real MCP server on loopback, so a call goes through the same client and
// transport it does for a connected app.
beforeAll(async () => {
  server = http.createServer((req, res) => {
    void (async () => {
      const mcp = new McpServer(
        { name: "tracker", version: "1.0.0" },
        { instructions: "Search before creating, so issues are not doubled." },
      );
      mcp.registerResource(
        "conventions",
        "tracker://docs/conventions",
        { description: "How issues are named.", mimeType: "text/markdown" },
        (uri) => ({
          contents: [
            { text: "# Conventions\nTitles start with a verb.", uri: uri.href },
          ],
        }),
      );
      mcp.registerTool(
        "issues",
        {
          annotations: { readOnlyHint: true },
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
      mcp.registerTool(
        "trash",
        {
          annotations: { destructiveHint: true },
          description: "Move pages to Trash",
          inputSchema: { page_ids: z.array(z.string()) },
        },
        () => ({
          content: [{ text: "Confirm with the user first.", type: "text" }],
          isError: true,
        }),
      );
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

  knowChat(chatId);
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
  guide.handedOver = true;
  knowChat(chatId);
  fs = new InMemoryFs();
  await fs.mkdir("/Users/sam/chat", { recursive: true });
});

async function app(...args: string[]) {
  return createAppCommand({
    chatId,
    role: "chat",
    sessionId: StoreId.newSessionId(),
  }).execute(
    args,
    createCommandContext({
      cwd: "/Users/sam/chat",
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
      "Wrote issues.json: JSON, an object with keys "issues", "total", 56 bytes.
      "
    `);
    expect(
      JSON.parse(await fs.readFile("/Users/sam/chat/issues.json")),
    ).toEqual({
      issues: ["one", "two"],
      total: 2,
    });
  });

  it.each([
    ["json_text", "JSON, an array of 3"],
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
    expect(await fs.exists("/Users/sam/chat/out.json")).toBe(false);
  });

  it("prints a structured result as JSON without --out", async () => {
    const result = await app("call", slug, "issues");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      issues: ["one", "two"],
      total: 2,
    });
  });

  it("prints prose as the service sent it", async () => {
    const result = await app("call", slug, "prose");
    expect(result.stdout).toBe("line one\nline two\n");
  });

  it("prints the whole result as JSON with --json", async () => {
    const result = await app("call", slug, "prose", "--json");
    expect(result.stdout).toBe('"line one\\nline two"\n');
  });
});

describe("app call refusals", () => {
  it("prints the schema where the arguments do not fit it", async () => {
    const result = await app(
      "call",
      slug,
      "trash",
      '{"page_or_database_ids":["a"]}',
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument app: MCP error -32602: Input validation error: Invalid arguments for tool trash: Invalid input: expected array, received undefined at page_ids
      The arguments do not fit what trash takes (data must have required property 'page_ids'). It takes:
      {
        "type": "object",
        "properties": {
          "page_ids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "page_ids"
        ],
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
      "
    `);
  });

  it("keeps the schema out where the arguments fit it", async () => {
    const result = await app("call", slug, "trash", '{"page_ids":["a"]}');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument app: Confirm with the user first.
      The tool refused the call. If the arguments were the problem, \`instrument app tool tracker trash\` shows the JSON it takes.
      "
    `);
  });
});

/** The loopback server's port, which changes every run, out of a snapshot. */
function withoutPort(text: string) {
  return text.replaceAll(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
}

describe("the app's guide", () => {
  it("opens the first listing with the guide and the server's words", async () => {
    guide.handedOver = false;
    const result = await app("tools", slug);
    expect(result.stderr).toBe("");
    expect(withoutPort(result.stdout)).toMatchInlineSnapshot(`
      "Reached through its MCP server at http://127.0.0.1:<port>/mcp: \`instrument app tools <slug>\` lists what it can do, \`instrument app call <slug> <tool> '<json>'\` runs one.

      What the Tracker server says about using it:
      <server_instructions>
      Search before creating, so issues are not doubled.
      </server_instructions>

      The server also offers documents: \`instrument app resources tracker\` lists them, \`instrument app read tracker <uri>\` reads one.

      5 tools on tracker. \`instrument app tool tracker <name>\` shows one with the JSON it takes; \`instrument app call tracker <name> '<json>'\` runs it, and in a script \`await instrument.apps["tracker"].<name>({...})\` (Node) or \`instrument.app("tracker").<name>(...)\` (Python) returns it as a value. [read-only] and [destructive] are the server's own marks.
      - issues [read-only]: List issues
      - json_text: JSON as text
      - prose: Plain text
      - broken: Always refuses
      - trash [destructive]: Move pages to Trash
      "
    `);
  });

  it("leaves the guide out of a listing once the model has it", async () => {
    const result = await app("tools", slug);
    expect(result.stdout).not.toContain("server_instructions");
  });

  it("sends nothing on a first call and hands back the guide", async () => {
    guide.handedOver = false;
    const result = await app("call", slug, "issues");
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(withoutPort(result.stderr)).toMatchInlineSnapshot(`
      "Not sent (exit 3): before the first request to "tracker", its guide. Read it, then repeat the request. A guide counts as read only where its output is shown: this one, or \`instrument app guide <slug>\` printed whole. One sent to /dev/null or cut with head does not count, and the next request stops here again.

      Reached through its MCP server at http://127.0.0.1:<port>/mcp: \`instrument app tools <slug>\` lists what it can do, \`instrument app call <slug> <tool> '<json>'\` runs one.

      What the Tracker server says about using it:
      <server_instructions>
      Search before creating, so issues are not doubled.
      </server_instructions>

      The server also offers documents: \`instrument app resources tracker\` lists them, \`instrument app read tracker <uri>\` reads one.
      "
    `);
  });
});

describe("app resources and read", () => {
  it("lists the server's documents", async () => {
    const result = await app("resources", slug);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "1 document on tracker. \`instrument app read tracker <uri>\` reads one.
      - tracker://docs/conventions (conventions, text/markdown): How issues are named.
      "
    `);
  });

  it("reads one", async () => {
    const result = await app("read", slug, "tracker://docs/conventions");
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "# Conventions
      Titles start with a verb.
      "
    `);
  });
});

describe("app call in a pipeline", () => {
  it("hands jq the service's JSON", async () => {
    await mkdir(chatDir(chatId), { recursive: true });
    const bash = await createLocalBashEnv({
      sessionId: StoreId.newSessionId(),
      chatId,
    });
    const result = await bash.exec(
      `instrument app call ${slug} json_text | jq 'length'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("3\n");
  });
});

describe("node instrument.apps", () => {
  async function script(code: string, id = chatId) {
    await mkdir(chatDir(id), { recursive: true });
    const bash = await createLocalBashEnv({
      sessionId: StoreId.newSessionId(),
      chatId: id,
    });
    return bash.exec(`node --input-type=module <<'EOF'
${code}
EOF`);
  }

  it("hands a structured result back as a value", async () => {
    const result = await script(
      `const { issues, total } = await instrument.apps.${slug}.issues({});
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
      `const r = await instrument.apps["${slug}"].${tool}();
${use}`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(out);
  });

  it("throws a refusal into the script", async () => {
    const result = await script(
      `try { await instrument.apps.${slug}.broken({ project: 1 }); } catch (error) { console.log(error.name, error.message); }`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
  "InstrumentError project is required
  The tool refused the call. If the arguments were the problem, \`instrument app tool tracker broken\` shows the JSON it takes.
  "
`);
  });
});
