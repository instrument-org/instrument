/**
 * Does the agent keep what it found out about an app in the app's guide?
 *
 * Two Notion apps are connected, the same service under two accounts, and
 * nothing in the listing says which workspace each reaches. The Reading list
 * lives only in the second. Finding it takes trying both, and the next chat
 * would have to try both again unless the body of an `APP.md` says where it
 * is. The case asks for the list and is scored on the answer and on whether
 * a guide mentions the Reading list once the run is over, whether the chat
 * found it itself or a task told it in its report.
 */
import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { listApps, readAppGuide } from "../../src/lib/apps/store";
import { type Session } from "../../src/schemas/session";
import { type AppFixture, type StandInService } from "../lib/connected-app";
import { type Assertion, defineEval } from "../harness";

const BOOKS = [
  { author: "Ursula K. Le Guin", title: "The Dispossessed" },
  { author: "Kazuo Ishiguro", title: "Klara and the Sun" },
  { author: "Patrick Radden Keefe", title: "Say Nothing" },
];

const ENDPOINTS = [
  "- `GET /search?query=<words>` -- databases whose title matches, as `{ results: [{ id, title }] }`.",
  "- `GET /databases/<id>/rows` -- every row of one database, as `{ rows: [...] }`.",
];

/** A Notion workspace holding only the databases it is given. */
function notionWorkspace(
  databases: Record<string, { rows: unknown[]; title: string }>,
): StandInService {
  return {
    about: "Notion: the person's notes and databases.",
    endpoints: ENDPOINTS,
    respond: (method, pathname, { query }) => {
      if (method !== "GET") {
        return undefined;
      }
      if (pathname === "/search") {
        const words = (query.get("query") ?? "").toLowerCase();
        return {
          results: Object.entries(databases)
            .filter(([, database]) =>
              database.title.toLowerCase().includes(words),
            )
            .map(([id, database]) => ({ id, title: database.title })),
        };
      }
      const rows = /^\/databases\/([^/]+)\/rows$/.exec(pathname);
      const database = rows ? databases[rows[1] ?? ""] : undefined;
      return database ? { rows: database.rows } : undefined;
    },
  };
}

const APPS: AppFixture[] = [
  {
    kind: "api",
    name: "Notion",
    service: notionWorkspace({
      "db-meetings": { rows: [], title: "Meeting notes" },
    }),
    slug: "notion",
  },
  {
    kind: "api",
    name: "Notion",
    service: notionWorkspace({
      "db-reading": { rows: BOOKS, title: "Reading" },
    }),
    slug: "notion-2",
  },
];

function assistantText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

const ANSWERED = "says the Reading list has three books";

const answered: Assertion = {
  check: ({ sessions }) => {
    const text = assistantText(sessions);
    const passed = /\b(?:3|three)\b/i.test(text);
    return {
      evidence: text.slice(-300) || "no reply",
      passed,
      text: ANSWERED,
    };
  },
  text: ANSWERED,
};

const KEPT = "a Notion guide says where the Reading list is";

const keptInGuide: Assertion = {
  check: async () => {
    const { appsDir } = getWorkspaceConfig();
    const { apps } = await listApps(appsDir);
    const guides = await Promise.all(
      apps.map(async (app) => ({
        guide: (await readAppGuide(app.dir)) ?? "",
        slug: app.slug,
      })),
    );
    const kept = guides.filter(({ guide }) => /reading/i.test(guide));
    return {
      evidence:
        kept
          .map(({ guide, slug }) => `${slug}: ${guide.trim().slice(-300)}`)
          .join(" | ") || "no guide mentions Reading",
      passed: kept.length > 0,
      text: KEPT,
    };
  },
  text: KEPT,
};

export const APP_GUIDE_MEMORY_EVALS = [
  defineEval({
    apps: APPS,
    assertions: [answered, keptInGuide],
    kind: "chat",
    name: "app-guide-keeps-which-account",
    prompt: "How many books are on my Reading list in Notion?",
  }),
];
