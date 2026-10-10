/**
 * Do the findings carry the links for the things they name?
 *
 * A research answer is only as useful as the user's ability to go check it.
 * Naming a product, a listing, or a page and leaving the URL behind makes them
 * search for what the turn already found -- and the failure is invisible,
 * because the answer still reads as complete.
 *
 * The links belong wherever the findings are. A task answers a short question
 * in its last message, and that message carries the link; findings that do not
 * fit in a message go in a file, which carries the links, and the last message
 * is a receipt naming that file. So each check reads the reply together with
 * every file its files fence names.
 *
 * Two shapes this is measured in, both taken from turns that dropped their
 * links in practice: a comparison that names several things, and a research
 * report. The third case guards the other direction, since the cure for a
 * missing link is not a remembered one.
 */
import fs from "node:fs/promises";

import { filesNamedIn } from "../../src/lib/parse-files-block";
import { resolveWorkspaceFilePath } from "../../src/lib/resolve-workspace-file-path";
import { type WorkspaceFilePath } from "../../src/schemas/paths";
import { type Session } from "../../src/schemas/session";
import { type ChatId } from "../../src/schemas/chat-id";
import { type Assertion, defineEval } from "../harness";

// ---------------------------------------------------------------------------
// Reading links back out of a transcript and its deliverables
// ---------------------------------------------------------------------------

/**
 * A Markdown link or an HTML anchor whose target carries a scheme, i.e. names a
 * web page. Anchors only, so a page's stylesheet and font `<link>`s are not
 * read as sources.
 */
const WEB_LINK =
  /\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)|<a\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"'\s]+)/giu;

/** Deliverables whose links can be read as text. */
const TEXT_DELIVERABLE = /\.(?:html?|md|markdown|txt|csv)$/iu;

function assistantText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) =>
      session.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
        ),
    )
    .join("\n\n");
}

/** The text of every readable file the reply's files fences name. */
async function deliverableText(
  sessions: Session.WithMessagesAndParts[],
  chatId: ChatId,
): Promise<{ names: string[]; text: string }> {
  const names = filesNamedIn(assistantText(sessions)).filter((name) =>
    TEXT_DELIVERABLE.test(name),
  );
  const bodies = await Promise.all(
    names.map(async (name) => {
      const resolved = await resolveWorkspaceFilePath({
        // The fence line is the path the task reached the file at; one that
        // does not resolve simply contributes no links.
        filePath: name as WorkspaceFilePath,
        chatId,
      });
      return resolved === null
        ? ""
        : await fs.readFile(resolved, "utf8").catch(() => "");
    }),
  );
  return { names, text: bodies.join("\n") };
}

/**
 * Everything the turn read rather than wrote: the user's words and every tool
 * part with its input left out. A URL in the findings has to come from in
 * here, so this is what a link is checked against. Inputs are left out because
 * the deliverable's own text arrives as the input of the call that wrote it.
 */
function retrievedText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.flatMap((part) => {
          if (part.type === "text") {
            return message.role === "user" ? [part.text] : [];
          }
          return [JSON.stringify({ ...part, input: undefined })];
        }),
      ),
    )
    .join("\n");
}

/**
 * Origin and path only. A model routinely drops a query string or a trailing
 * slash when it rewrites a result's URL into a link, and neither makes the link
 * a different page.
 */
function comparable(url: string): null | string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`
      .replace(/\/+$/u, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

function linkedUrls(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(WEB_LINK)].flatMap((match) => {
        const url = match[1] ?? match[2];
        return url === undefined ? [] : [url];
      }),
    ),
  ];
}

async function findingsLinks(
  sessions: Session.WithMessagesAndParts[],
  chatId: ChatId,
): Promise<{ files: string[]; reply: string[]; urls: string[] }> {
  const reply = linkedUrls(assistantText(sessions));
  const deliverables = await deliverableText(sessions, chatId);
  const inFiles = linkedUrls(deliverables.text);
  return {
    files: deliverables.names,
    reply,
    urls: [...new Set([...reply, ...inFiles])],
  };
}

function whereLinked(found: { files: string[]; reply: string[] }): string {
  return found.files.length === 0
    ? "reply only, no deliverable"
    : `reply (${found.reply.length}) and ${found.files.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * The links verbatim, because how many is less interesting than which ones,
 * and a pass/fail column cannot show that.
 */
const assertLinkedSeveral: Assertion = {
  check: async ({ sessions, chatId }) => {
    const found = await findingsLinks(sessions, chatId);
    return {
      evidence:
        found.urls.length === 0
          ? `No web links in the ${whereLinked(found)}`
          : `${whereLinked(found)}: ${found.urls.slice(0, 8).join(" | ")}`,
      passed: found.urls.length >= 2,
      text: "Linked the things it named, not just one of them",
    };
  },
  text: "Linked the things it named, not just one of them",
};

/**
 * Every link points somewhere the turn actually went. This is the half of the
 * rule that has to hold while the other half is being pushed on: the answer to
 * a missing link is one from a result, never a plausible address.
 */
const assertLinksAreGrounded: Assertion = {
  check: async ({ sessions, chatId }) => {
    const seen = retrievedText(sessions).toLowerCase();
    const { urls } = await findingsLinks(sessions, chatId);
    const ungrounded = urls.filter((url) => {
      const key = comparable(url);
      return key === null || !seen.includes(key);
    });
    return {
      evidence:
        ungrounded.length === 0
          ? `All ${urls.length} link(s) came from a result or a page opened`
          : `Not found in anything the turn retrieved: ${ungrounded.join(" | ")}`,
      passed: ungrounded.length === 0,
      text: "Every link came from something the turn retrieved",
    };
  },
  text: "Every link came from something the turn retrieved",
};

/**
 * A report's sources are in the report: the reader checks a claim where they
 * read it.
 */
const assertSourcesLinked: Assertion = {
  check: async ({ sessions, chatId }) => {
    const found = await findingsLinks(sessions, chatId);
    return {
      evidence:
        found.urls.length > 0
          ? `${whereLinked(found)}: ${found.urls.slice(0, 8).join(" | ")}`
          : `No web links in the ${whereLinked(found)}`,
      passed: found.urls.length > 0,
      text: "Linked its sources where its findings are",
    };
  },
  text: "Linked its sources where its findings are",
};

export const SOURCE_LINKS_EVALS = [
  defineEval({
    assertions: [assertLinkedSeveral, assertLinksAreGrounded],
    // The comparison shape: several named things, each of which the user's next
    // move is to go open.
    name: "source-links-product-comparison",
    prompt:
      "I want a portable SSD of at least 2TB for backing up video projects. Compare the best few on price per terabyte and tell me which to buy.",
  }),
  defineEval({
    assertions: [assertSourcesLinked, assertLinksAreGrounded],
    // The research shape: a written deliverable is the home for the sources.
    name: "source-links-research-with-deliverable",
    prompt:
      "Research what it currently costs to run CI on hosted cloud runners versus buying a machine to self-host, and write it up as a report I can share with my team.",
  }),
  defineEval({
    assertions: [assertLinksAreGrounded],
    // The other direction: a question the model can nearly answer from memory,
    // where the tempting link is a remembered one.
    name: "source-links-not-invented-from-memory",
    prompt:
      "What does the CAP theorem say, and where should I read more about it?",
  }),
];
