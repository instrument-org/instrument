import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { z } from "zod";

/**
 * An issue tracker served over MCP, the shape a hosted one like Linear has:
 * a paginated issue list with structured output, one issue in full, its
 * comments, and the people issues are assigned to. Big enough (120 issues,
 * a few hundred comments) that a question across it takes more calls than a
 * turn each is worth, which is what a case scoring how the agent fans out
 * needs. The data is generated from a fixed seed, so a case can compute its
 * expected answer from `TRACKER` rather than hard-code it.
 */
export interface TrackerIssue {
  assigneeId: null | string;
  comments: TrackerComment[];
  createdAt: string;
  description: string;
  id: string;
  labels: string[];
  priority: "high" | "low" | "medium" | "urgent";
  state: "closed" | "open";
  title: string;
}

interface TrackerComment {
  authorId: string;
  body: string;
  createdAt: string;
}

interface TrackerUser {
  email: string;
  id: string;
  name: string;
  team: string;
}

const PAGE_SIZE = 25;

const USERS: TrackerUser[] = [
  ["Maya Chen", "Platform"],
  ["Tomás Rivera", "Platform"],
  ["Priya Natarajan", "Platform"],
  ["Jonah Field", "Apps"],
  ["Aiko Sato", "Apps"],
  ["Lena Fischer", "Apps"],
  ["Sam Okafor", "Design"],
  ["Ruth Abebe", "Design"],
].map(([name = "", team = ""], index) => ({
  email: `${(name.split(" ")[0] ?? "").toLowerCase()}@beacon.example`,
  id: `u${index + 1}`,
  name,
  team,
}));

const LABELS = [
  "bug",
  "feature",
  "performance",
  "ux",
  "docs",
  "security",
  "infra",
];

const SUBJECTS = [
  "sign-in",
  "folder picker",
  "sync",
  "search index",
  "export",
  "notifications",
  "settings page",
  "onboarding",
  "billing",
  "attachments",
  "dark mode",
  "keyboard shortcuts",
];

const PROBLEMS = [
  "loops on Windows",
  "is slow with large workspaces",
  "forgets its last state",
  "crashes after an update",
  "shows stale data",
  "needs a clearer empty state",
  "should support bulk actions",
  "drops the first keystroke",
  "leaks memory overnight",
  "is missing from the docs",
];

const REMARKS = [
  "I can reproduce this on the latest build.",
  "Is this still happening after the last fix?",
  "Added logs from my machine.",
  "This blocks the release, bumping priority.",
  "Took a first pass, PR is up.",
  "Can we split this into two issues?",
  "Same as what a customer reported yesterday.",
  "Not seeing it anymore on my side.",
];

/** mulberry32: a small seeded generator, so every run serves the same data. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function generate(): TrackerIssue[] {
  const random = seeded(20_261_006);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] as T;
  // Weighted so the label counts come out apart rather than tied.
  const labelWeights = [9, 6, 4, 4, 2, 2, 3];
  const labelPool = LABELS.flatMap((label, index) =>
    Array.from({ length: labelWeights[index] ?? 1 }, () => label),
  );
  const start = Date.UTC(2026, 6, 1);
  return Array.from({ length: 120 }, (_unused, index) => {
    const labels = [pick(labelPool)];
    if (random() < 0.35) {
      const second = pick(labelPool);
      if (!labels.includes(second)) {
        labels.push(second);
      }
    }
    const created = start + index * 9 * 3_600_000;
    const commentCount = Math.floor(random() * random() * 8);
    const comments = Array.from({ length: commentCount }, (_, at) => ({
      authorId: pick(USERS).id,
      body: pick(REMARKS),
      createdAt: new Date(created + (at + 1) * 5 * 3_600_000).toISOString(),
    }));
    const subject = pick(SUBJECTS);
    const problem = pick(PROBLEMS);
    return {
      assigneeId: random() < 0.85 ? pick(USERS).id : null,
      comments,
      createdAt: new Date(created).toISOString(),
      description: `The ${subject} ${problem}. Steps and logs are in the thread.`,
      id: `BCN-${index + 1}`,
      labels,
      priority: pick(["urgent", "high", "medium", "medium", "low"] as const),
      state: random() < 0.6 ? "open" : "closed",
      title: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${problem}`,
    };
  });
}

export const TRACKER = { issues: generate(), users: USERS };

const IssueSummarySchema = z.object({
  assigneeId: z.string().nullable(),
  id: z.string(),
  labels: z.array(z.string()),
  priority: z.string(),
  state: z.string(),
  title: z.string(),
});

function summary(issue: TrackerIssue) {
  return {
    assigneeId: issue.assigneeId,
    id: issue.id,
    labels: issue.labels,
    priority: issue.priority,
    state: issue.state,
    title: issue.title,
  };
}

function text(value: unknown) {
  return [{ text: JSON.stringify(value, null, 2), type: "text" as const }];
}

function buildServer(): McpServer {
  const mcp = new McpServer({ name: "beacon", version: "1.0.0" });
  mcp.registerTool(
    "list_issues",
    {
      annotations: { readOnlyHint: true },
      description: `List issues, newest first, ${PAGE_SIZE} to a page. Filter by state, label, or assignee. Pass the returned nextCursor as cursor for the next page; it is null on the last page. Comments are not included; use list_comments.`,
      inputSchema: {
        assigneeId: z.string().optional(),
        cursor: z.string().optional(),
        label: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
      },
      outputSchema: {
        issues: z.array(IssueSummarySchema),
        nextCursor: z.string().nullable(),
      },
    },
    ({ assigneeId, cursor, label, state }) => {
      const matching = TRACKER.issues
        .filter(
          (issue) =>
            (state === undefined || issue.state === state) &&
            (label === undefined || issue.labels.includes(label)) &&
            (assigneeId === undefined || issue.assigneeId === assigneeId),
        )
        .toReversed();
      const offset = cursor === undefined ? 0 : Number(cursor) || 0;
      const page = matching.slice(offset, offset + PAGE_SIZE).map(summary);
      const next =
        offset + PAGE_SIZE < matching.length
          ? String(offset + PAGE_SIZE)
          : null;
      const result = { issues: page, nextCursor: next };
      return { content: text(result), structuredContent: result };
    },
  );
  mcp.registerTool(
    "get_issue",
    {
      annotations: { readOnlyHint: true },
      description:
        "Get one issue in full by its id (BCN-12): description, labels, priority, assignee, and how many comments it has.",
      inputSchema: { id: z.string() },
    },
    ({ id }) => {
      const issue = TRACKER.issues.find((candidate) => candidate.id === id);
      if (!issue) {
        return {
          content: [{ text: `No issue ${id}.`, type: "text" }],
          isError: true,
        };
      }
      const { comments, ...rest } = issue;
      return {
        content: text({ ...rest, commentCount: comments.length }),
      };
    },
  );
  mcp.registerTool(
    "list_comments",
    {
      annotations: { readOnlyHint: true },
      description: "List the comments on one issue, oldest first.",
      inputSchema: { issueId: z.string() },
      outputSchema: {
        comments: z.array(
          z.object({
            authorId: z.string(),
            body: z.string(),
            createdAt: z.string(),
          }),
        ),
      },
    },
    ({ issueId }) => {
      const issue = TRACKER.issues.find(
        (candidate) => candidate.id === issueId,
      );
      if (!issue) {
        return {
          content: [{ text: `No issue ${issueId}.`, type: "text" }],
          isError: true,
        };
      }
      const result = { comments: issue.comments };
      return { content: text(result), structuredContent: result };
    },
  );
  mcp.registerTool(
    "list_users",
    {
      annotations: { readOnlyHint: true },
      description: "List the workspace's members: id, name, email, and team.",
    },
    () => ({ content: text(TRACKER.users) }),
  );
  return mcp;
}

/** Serves the tracker on loopback, a fresh stateless server per request. */
export async function startMcpTracker(): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const mcp = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      response.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk as Buffer);
      }
      await transport.handleRequest(
        request,
        response,
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
    throw new Error("the MCP tracker has no port");
  }
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
    url: `http://127.0.0.1:${address.port}/mcp`,
  };
}
