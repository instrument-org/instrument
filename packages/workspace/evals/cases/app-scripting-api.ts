/**
 * How a task works a connected API app, and Python, when a question takes
 * many calls: the baseline the capability layer is measured against.
 *
 * `instrument app request` runs one request per command, so a fan-out over an
 * API app in the shell is a turn per request, a bash loop, or requests written
 * to files and read back; a script makes the same requests as values through
 * `instrument`, in Node or Python. These cases score the answer and record
 * which of those the model reached for, beside `app-scripting.ts`, which asks
 * the same questions of an MCP app. Run with `--bash-only` for the arm with no
 * script surface.
 *
 * Lantern serves the same generated tracker as Beacon over REST, so the
 * expected answers are the ones `app-scripting.ts` computes. The errand is
 * shaped like a real transcript: Google-like Drive, Docs, Calendar and Gmail
 * stand-ins, three documents made and edited, an event and a draft. Each
 * stand-in keeps what it was sent in this process, under ids no model would
 * guess, so a case finds its own records by the ids its transcript names.
 *
 * Run each group on its own (`lantern`, `python`, `errand`): one apps
 * directory serves a whole run, so every app a run declares is listed in
 * every case of it.
 */
import { randomBytes } from "node:crypto";

import { type Session } from "../../src/schemas/session";
import {
  type AppFixture,
  type StandInService,
  StandInStatus,
} from "../lib/connected-app";
import { TRACKER, type TrackerIssue } from "../lib/mcp-tracker";
import { type Assertion, defineEval } from "../harness";
import {
  answers,
  bashCommands,
  COUNTS_URGENT_BY_TEAM,
  LISTS_BUSY_BUGS,
  NAMES_TOP_LABELS,
  scriptedCalls,
  toolInputs,
} from "./app-scripting";

const PAGE_SIZE = 25;

function issueSummary(issue: TrackerIssue) {
  return {
    assignee_id: issue.assigneeId,
    id: issue.id,
    labels: issue.labels,
    priority: issue.priority,
    state: issue.state,
    title: issue.title,
  };
}

const LANTERN_SERVICE: StandInService = {
  about: "Lantern tracks the team's issues.",
  endpoints: [
    "- `GET /issues` -- issues newest first, 25 a page, as `{ issues: [{ id, title, state, labels, priority, assignee_id }], next_cursor }`. Query: `state` (open, closed), `label`, `assignee_id`, `cursor` (the last page's `next_cursor`; null on the last page).",
    "- `GET /issues/<id>` -- one issue in full: description, labels, priority, assignee_id, and `comment_count`.",
    "- `GET /issues/<id>/comments` -- its comments, oldest first, as `{ comments: [{ author_id, body, created_at }] }`.",
    "- `GET /users` -- the workspace's members, as `{ users: [{ id, name, email, team }] }`.",
  ],
  respond: (method, pathname, { query }) => {
    if (method !== "GET") {
      return new StandInStatus(405, { error: "Lantern is read-only here." });
    }
    if (pathname === "/users") {
      return { users: TRACKER.users };
    }
    if (pathname === "/issues") {
      const state = query.get("state");
      const label = query.get("label");
      const assignee = query.get("assignee_id");
      const matching = TRACKER.issues
        .filter(
          (issue) =>
            (state === null || issue.state === state) &&
            (label === null || issue.labels.includes(label)) &&
            (assignee === null || issue.assigneeId === assignee),
        )
        .toReversed();
      const offset = Number(query.get("cursor") ?? 0) || 0;
      return {
        issues: matching.slice(offset, offset + PAGE_SIZE).map(issueSummary),
        next_cursor:
          offset + PAGE_SIZE < matching.length
            ? String(offset + PAGE_SIZE)
            : null,
      };
    }
    const match = /^\/issues\/([\w-]+)(\/comments)?$/.exec(pathname);
    const issue = TRACKER.issues.find(
      (candidate) => candidate.id === match?.[1],
    );
    if (!issue) {
      return undefined;
    }
    if (match?.[2]) {
      return {
        comments: issue.comments.map((comment) => ({
          author_id: comment.authorId,
          body: comment.body,
          created_at: comment.createdAt,
        })),
      };
    }
    const { comments, ...rest } = issue;
    return {
      assignee_id: rest.assigneeId,
      comment_count: comments.length,
      created_at: rest.createdAt,
      description: rest.description,
      id: rest.id,
      labels: rest.labels,
      priority: rest.priority,
      state: rest.state,
      title: rest.title,
    };
  },
};

const LANTERN: AppFixture = {
  kind: "api",
  name: "Lantern",
  service: LANTERN_SERVICE,
  slug: "lantern",
};

const BEACON: AppFixture = { kind: "mcp", name: "Beacon", slug: "beacon" };

// ---------------------------------------------------------------------------
// The errand's stand-ins: what each was sent, kept for the assertions.

interface StoredDoc {
  edits: number;
  id: string;
  readAfterEdit: boolean;
  text: string;
  title: string;
}

interface StoredEvent {
  end: string;
  id: string;
  start: string;
  summary: string;
}

interface StoredDraft {
  id: string;
  raw: string;
}

const DOCS = new Map<string, StoredDoc>();
const EVENTS = new Map<string, StoredEvent>();
const DRAFTS = new Map<string, StoredDraft>();

/** An id no model would guess, so a transcript that names it got it from the service. */
function freshId(prefix: string): string {
  return `${prefix}${randomBytes(9).toString("base64url")}`;
}

function docLink(id: string): string {
  return `https://docs.google.com/document/d/${id}/edit`;
}

function newDoc(title: string): StoredDoc {
  const doc: StoredDoc = {
    edits: 0,
    id: freshId("1d"),
    readAfterEdit: false,
    text: "",
    title,
  };
  DOCS.set(doc.id, doc);
  return doc;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DRIVE_SERVICE: StandInService = {
  about:
    "Google Drive: the person's files. Create a Google Doc here, then write in it with the Google Docs app.",
  endpoints: [
    '- `POST /files` -- create a file, as `{ "name": "...", "mimeType": "application/vnd.google-apps.document" }` for a Google Doc. Returns `{ id, name, mimeType, webViewLink }`.',
    "- `GET /files` -- the files made here, as `{ files: [{ id, name, mimeType, webViewLink }] }`.",
  ],
  respond: (method, pathname, { body }) => {
    if (pathname !== "/files") {
      return undefined;
    }
    if (method === "GET") {
      return {
        files: [...DOCS.values()].map((doc) => ({
          id: doc.id,
          mimeType: "application/vnd.google-apps.document",
          name: doc.title,
          webViewLink: docLink(doc.id),
        })),
      };
    }
    if (method !== "POST") {
      return new StandInStatus(405, { error: { message: "Use GET or POST." } });
    }
    if (!isRecord(body) || typeof body.name !== "string" || body.name === "") {
      return new StandInStatus(400, {
        error: { message: "The body needs a name." },
      });
    }
    if (body.mimeType !== "application/vnd.google-apps.document") {
      return new StandInStatus(400, {
        error: {
          message:
            "Only Google Docs (application/vnd.google-apps.document) can be made here.",
        },
      });
    }
    const doc = newDoc(body.name);
    return {
      id: doc.id,
      mimeType: "application/vnd.google-apps.document",
      name: doc.title,
      webViewLink: docLink(doc.id),
    };
  },
};

const DOCS_SERVICE: StandInService = {
  about:
    "Google Docs: the text of the person's documents. Make a new one with the Google Drive app, or here.",
  endpoints: [
    '- `POST /documents` -- create a document, as `{ "title": "..." }`. Returns `{ documentId, title }`.',
    "- `GET /documents/<documentId>` -- one document, as `{ documentId, title, body: { text } }`.",
    '- `POST /documents/<documentId>:batchUpdate` -- edit it, as `{ "requests": [{ "insertText": { "text": "...", "endOfSegmentLocation": {} } }] }`, which adds the text at the end. Returns `{ documentId, replies }`.',
  ],
  respond: (method, pathname, { body }) => {
    if (pathname === "/documents" && method === "POST") {
      if (!isRecord(body) || typeof body.title !== "string") {
        return new StandInStatus(400, {
          error: { message: "The body needs a title." },
        });
      }
      const doc = newDoc(body.title);
      return { documentId: doc.id, title: doc.title };
    }
    const match = /^\/documents\/([\w-]+)(:batchUpdate)?$/.exec(pathname);
    const doc = match ? DOCS.get(match[1] ?? "") : undefined;
    if (!doc) {
      return new StandInStatus(404, {
        error: { message: "Requested entity was not found." },
      });
    }
    if (!match?.[2]) {
      if (method !== "GET") {
        return new StandInStatus(405, { error: { message: "Use GET." } });
      }
      if (doc.edits > 0) {
        doc.readAfterEdit = true;
      }
      return { body: { text: doc.text }, documentId: doc.id, title: doc.title };
    }
    const requests = isRecord(body) ? body.requests : undefined;
    const inserts = Array.isArray(requests)
      ? requests.flatMap((request) =>
          isRecord(request) &&
          isRecord(request.insertText) &&
          typeof request.insertText.text === "string"
            ? [request.insertText.text]
            : [],
        )
      : [];
    if (inserts.length === 0) {
      return new StandInStatus(400, {
        error: {
          message: "requests needs at least one insertText with its text.",
        },
      });
    }
    doc.text += inserts.join("");
    doc.edits += 1;
    return { documentId: doc.id, replies: inserts.map(() => ({})) };
  },
};

const CALENDAR_SERVICE: StandInService = {
  about: "Google Calendar: the person's primary calendar.",
  endpoints: [
    '- `POST /calendars/primary/events` -- add an event, as `{ "summary": "...", "start": { "dateTime": "2026-10-06T14:00:00", "timeZone": "America/Chicago" }, "end": { ... } }`, the dateTime in the person\'s local time with its zone, or with an offset. Returns the event with its `id` and `htmlLink`.',
    "- `GET /calendars/primary/events` -- the events added here.",
  ],
  respond: (method, pathname, { body }) => {
    if (pathname !== "/calendars/primary/events") {
      return undefined;
    }
    if (method === "GET") {
      return { items: [...EVENTS.values()] };
    }
    const start =
      isRecord(body) && isRecord(body.start) ? body.start.dateTime : undefined;
    const end =
      isRecord(body) && isRecord(body.end) ? body.end.dateTime : undefined;
    if (
      !isRecord(body) ||
      typeof body.summary !== "string" ||
      typeof start !== "string" ||
      typeof end !== "string"
    ) {
      return new StandInStatus(400, {
        error: {
          message: "An event needs a summary, start.dateTime and end.dateTime.",
        },
      });
    }
    const event: StoredEvent = {
      end,
      id: freshId("ev"),
      start,
      summary: body.summary,
    };
    EVENTS.set(event.id, event);
    return {
      ...event,
      end: body.end,
      htmlLink: `https://calendar.google.com/calendar/event?eid=${event.id}`,
      start: body.start,
    };
  },
};

const GMAIL_SERVICE: StandInService = {
  about: "Gmail: the person's mailbox.",
  endpoints: [
    '- `POST /users/me/drafts` -- save a draft, as `{ "message": { "raw": "<the whole RFC 2822 message, base64url-encoded>" } }`, the message carrying its To, Subject and body. Returns `{ id, message: { id } }`. A draft is not sent.',
    "- `GET /users/me/drafts` -- the drafts saved here.",
  ],
  respond: (method, pathname, { body }) => {
    if (pathname !== "/users/me/drafts") {
      return undefined;
    }
    if (method === "GET") {
      return { drafts: [...DRAFTS.values()].map(({ id }) => ({ id })) };
    }
    const raw =
      isRecord(body) && isRecord(body.message) ? body.message.raw : undefined;
    if (typeof raw !== "string" || raw === "") {
      return new StandInStatus(400, {
        error: { message: "message.raw is required." },
      });
    }
    const draft: StoredDraft = {
      id: freshId("r-"),
      raw: Buffer.from(raw, "base64url").toString("utf8"),
    };
    DRAFTS.set(draft.id, draft);
    return { id: draft.id, message: { id: freshId("m") } };
  },
};

const ERRAND_APPS: AppFixture[] = [
  {
    kind: "api",
    name: "Google Drive",
    service: DRIVE_SERVICE,
    slug: "google-drive",
  },
  {
    kind: "api",
    name: "Google Docs",
    service: DOCS_SERVICE,
    slug: "google-docs",
  },
  {
    kind: "api",
    name: "Google Calendar",
    service: CALENDAR_SERVICE,
    slug: "google-calendar",
  },
  { kind: "api", name: "Gmail", service: GMAIL_SERVICE, slug: "gmail" },
];

// ---------------------------------------------------------------------------
// Reading a run.

/** Every part of every session, as text: what the run was told and what it sent. */
function transcriptText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .map((part) => JSON.stringify(part))
    .join("\n");
}

const PYTHON_RUN = /(?:^|[\s;&|(])python3?\b/;
// Matched against JSON-quoted tool input, where a script's quotes arrive escaped.
const SUBPROCESS_INSTRUMENT =
  /subprocess[\s\S]{0,300}?\\?["']instrument\\?["']|os\.system\(\s*\\?["']instrument\b/;
const NOT_A_PROGRAM =
  /No such file or directory: '(?:instrument|\.\/instrument)'/g;
// What the `instrument` program on a script's PATH says before it exits 127.
/** What every tool call printed, as text: where a refusal or the stub's answer shows. */
function outputsText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type.startsWith("tool-") && "output" in part
        ? [JSON.stringify(part.output)]
        : [],
    )
    .join("\n");
}

const STUB_ANSWERED =
  /Instrument's commands run in its shell, not from a program/g;
const READ_GUIDE_FIRST = /ReadGuideFirst/g;
const LOOPBACK_CURL = /\bcurl\b[^|;]{0,200}127\.0\.0\.1/;

/**
 * Always passes: the evidence line is the record of how the calls were made,
 * which is what comparing runs reads.
 */
const mechanism: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCommands(sessions);
    const inputs = toolInputs(sessions);
    const appCalls = commands.filter((command) =>
      /\bapp (?:call|request)\b/.test(command),
    );
    const requests = commands.filter((command) =>
      /\bapp request\b/.test(command),
    ).length;
    const loops = appCalls.filter((command) =>
      /\b(?:for|while)\b/.test(command),
    ).length;
    const outs = appCalls.filter((command) =>
      /--out\b|(?<![\d&])>\s*[^&\s]/.test(command),
    ).length;
    const scripted = scriptedCalls(sessions);
    const python = commands.filter((command) =>
      PYTHON_RUN.test(command),
    ).length;
    const subprocess = inputs.filter((input) =>
      SUBPROCESS_INSTRUMENT.test(input),
    ).length;
    const transcript = transcriptText(sessions);
    const notFound = transcript.match(NOT_A_PROGRAM)?.length ?? 0;
    const outputs = outputsText(sessions);
    const stub = outputs.match(STUB_ANSWERED)?.length ?? 0;
    const guideFirst = outputs.match(READ_GUIDE_FIRST)?.length ?? 0;
    const curl = commands.filter((command) =>
      LOOPBACK_CURL.test(command),
    ).length;
    return {
      evidence: `bash ${commands.length}, app commands ${appCalls.length} (${requests} request, ${loops} in a loop, ${outs} to a file), scripts calling instrument ${scripted.node + scripted.python} (node ${scripted.node}, python ${scripted.python}), ReadGuideFirst thrown ${guideFirst}, python runs ${python}, scripts running instrument as a program ${subprocess} (${stub} told how by the stub, ${notFound} not found), curl to the stand-in ${curl}`,
      passed: true,
      text: "records the mechanism",
    };
  },
  text: "records the mechanism",
};

/** The records a store kept whose id this run's transcript names. */
function ownRecords<T extends { id: string }>(
  store: Map<string, T>,
  sessions: Session.WithMessagesAndParts[],
): T[] {
  const text = transcriptText(sessions);
  return [...store.values()].filter((record) => text.includes(record.id));
}

const TOPICS = ["pricing", "onboarding", "hiring"] as const;

/**
 * The docs this run made for each topic, every one whose title names it: a
 * stray duplicate is a doc like any other, so a check passes when any doc
 * of the topic satisfies it.
 */
function errandDocs(sessions: Session.WithMessagesAndParts[]) {
  const docs = ownRecords(DOCS, sessions);
  return TOPICS.map((topic) => ({
    docs: docs.filter((doc) => doc.title.toLowerCase().includes(topic)),
    topic,
  }));
}

/** The topics no doc of which passes `check`. */
function topicsFailing(
  sessions: Session.WithMessagesAndParts[],
  check: (doc: StoredDoc) => boolean,
): string[] {
  return errandDocs(sessions)
    .filter(({ docs }) => !docs.some(check))
    .map(({ topic }) => topic);
}

const madeThreeDocs: Assertion = {
  check: ({ sessions }) => {
    const text = "made a doc for each of pricing, onboarding and hiring";
    const missing = topicsFailing(sessions, () => true);
    return {
      evidence:
        missing.length === 0
          ? errandDocs(sessions)
              .flatMap(({ docs }) => docs.map((doc) => doc.title))
              .join(" | ")
          : `missing: ${missing.join(", ")}`,
      passed: missing.length === 0,
      text,
    };
  },
  text: "made a doc for each of pricing, onboarding and hiring",
};

const editedEach: Assertion = {
  check: ({ sessions }) => {
    const text = "wrote a summary paragraph into each doc";
    const empty = topicsFailing(
      sessions,
      (doc) => doc.text.trim().length >= 40,
    );
    return {
      evidence:
        empty.length === 0
          ? "all three have text"
          : `no summary: ${empty.join(", ")}`,
      passed: empty.length === 0,
      text,
    };
  },
  text: "wrote a summary paragraph into each doc",
};

const checkedEach: Assertion = {
  check: ({ sessions }) => {
    const text = "read each doc back after editing it";
    const unread = topicsFailing(sessions, (doc) => doc.readAfterEdit);
    return {
      evidence:
        unread.length === 0
          ? "all three read back"
          : `not read back: ${unread.join(", ")}`,
      passed: unread.length === 0,
      text,
    };
  },
  text: "read each doc back after editing it",
};

/**
 * Always passes: how many docs past one each topic got, which a correct
 * run can still leave behind and comparing runs reads.
 */
const extraDocs: Assertion = {
  check: ({ sessions }) => {
    const extra = errandDocs(sessions).map(
      ({ docs, topic }) => `${topic} ${Math.max(0, docs.length - 1)}`,
    );
    return {
      evidence: `extra docs per title: ${extra.join(", ")}`,
      passed: true,
      text: "records extra docs per title",
    };
  },
  text: "records extra docs per title",
};

/** The Thursday after `now` (today, when today is a Thursday), as YYYY-MM-DD in local time. */
function comingThursday(now = new Date()): string {
  const day = new Date(now);
  day.setDate(day.getDate() + ((4 - day.getDay() + 7) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

const addedTheEvent: Assertion = {
  check: ({ sessions }) => {
    const text = "added the review this Thursday at 2pm for an hour";
    const thursday = comingThursday();
    const events = ownRecords(EVENTS, sessions);
    const right = events.find(
      (event) =>
        event.start.startsWith(`${thursday}T14:00`) &&
        event.end.startsWith(`${thursday}T15:00`),
    );
    return {
      evidence: right
        ? `${right.summary}: ${right.start} to ${right.end}`
        : events.map((event) => `${event.start} to ${event.end}`).join(" | ") ||
          "no event",
      passed: right !== undefined,
      text,
    };
  },
  text: "added the review this Thursday at 2pm for an hour",
};

const draftedTheEmail: Assertion = {
  check: ({ sessions }) => {
    const text = "drafted the email to Aiko linking all three docs";
    const topics = errandDocs(sessions);
    const drafts = ownRecords(DRAFTS, sessions);
    const right = drafts.find(
      (draft) =>
        /^to:.*aiko@example\.com/im.test(draft.raw) &&
        topics.every(({ docs }) =>
          docs.some((doc) => draft.raw.includes(doc.id)),
        ),
    );
    return {
      evidence: right
        ? right.raw.slice(0, 200)
        : drafts.map((draft) => draft.raw.slice(0, 160)).join(" | ") ||
          "no draft",
      passed: right !== undefined,
      text,
    };
  },
  text: "drafted the email to Aiko linking all three docs",
};

const gaveTheTitleAndAssignee = (() => {
  const issue = TRACKER.issues.find((candidate) => candidate.id === "BCN-42");
  const assignee = TRACKER.users.find((user) => user.id === issue?.assigneeId);
  return answers("gives the issue's title and assignee", (reply) => ({
    missing: [
      ...(/dark mode/i.test(reply) ? [] : ["title"]),
      ...(assignee && reply.includes(assignee.name)
        ? []
        : [assignee?.name ?? "assignee"]),
    ],
    wrong: [],
  }));
})();

export const APP_SCRIPTING_API_EVALS = [
  defineEval({
    apps: [LANTERN],
    assertions: [NAMES_TOP_LABELS, LISTS_BUSY_BUGS, mechanism],
    name: "app-scripting-lantern-fans-out",
    prompt:
      "Using our Lantern tracker: which three labels have the most open issues (with counts), and which open bugs have more than 3 comments?",
  }),
  defineEval({
    apps: [LANTERN],
    assertions: [gaveTheTitleAndAssignee, mechanism],
    name: "app-scripting-lantern-single-lookup",
    prompt: "In Lantern, what is BCN-42 and who is it assigned to?",
  }),
  defineEval({
    apps: [LANTERN],
    assertions: [COUNTS_URGENT_BY_TEAM, mechanism],
    name: "app-scripting-lantern-joins",
    prompt:
      "In Lantern, how many open urgent issues does each team have assigned to its members?",
  }),
  defineEval({
    apps: [LANTERN],
    assertions: [NAMES_TOP_LABELS, LISTS_BUSY_BUGS, mechanism],
    name: "app-scripting-python-lantern-fans-out",
    prompt:
      "Write a Python script that works this out from our Lantern tracker, run it, and tell me the answer: which three labels have the most open issues (with counts), and which open bugs have more than 3 comments?",
  }),
  defineEval({
    apps: [BEACON],
    assertions: [NAMES_TOP_LABELS, LISTS_BUSY_BUGS, mechanism],
    name: "app-scripting-python-beacon-fans-out",
    prompt:
      "Write a Python script that works this out from our Beacon tracker, run it, and tell me the answer: which three labels have the most open issues (with counts), and which open bugs have more than 3 comments?",
  }),
  defineEval({
    apps: ERRAND_APPS,
    assertions: [
      madeThreeDocs,
      editedEach,
      checkedEach,
      addedTheEvent,
      draftedTheEmail,
      extraDocs,
      mechanism,
    ],
    name: "app-scripting-errand-google",
    prompt:
      "Make three Google Docs: a pricing plan, an onboarding checklist, and a hiring plan. Write a short summary paragraph in each, then check that each one has it. Put a Plan review on my Google Calendar this Thursday at 2pm for an hour, and draft an email in Gmail to Aiko (aiko@example.com) with links to all three docs. Don't send it.",
  }),
];
