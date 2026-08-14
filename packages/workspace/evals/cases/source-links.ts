/**
 * Does a reply carry the links for the things it names?
 *
 * A research answer is only as useful as the user's ability to go check it.
 * Naming a product, a listing, or a page and leaving the URL behind makes them
 * search for what the turn already found -- and the failure is invisible,
 * because the answer still reads as complete.
 *
 * Two shapes this is measured in, both taken from turns that dropped their
 * links in practice: a comparison that names several things, and a research
 * answer whose sources went into a written deliverable instead of the reply.
 * The third case guards the other direction, since the cure for a missing link
 * is not a remembered one.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

// ---------------------------------------------------------------------------
// Reading links back out of a transcript
// ---------------------------------------------------------------------------

/** A Markdown link whose target carries a scheme, i.e. names a web page. */
const WEB_LINK = /\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)/giu;

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
  return [...text.matchAll(WEB_LINK)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * Everything the turn saw that it did not write itself: tool inputs, tool
 * results, and the search results inside them. A URL the reply carries has to
 * come from in here, so this is what a link is checked against.
 */
function toolText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" ? [] : [JSON.stringify(part)],
        ),
      ),
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * The links verbatim, because how many is less interesting than which ones,
 * and a pass/fail column cannot show that.
 */
const assertLinkedSeveral: Assertion = {
  check: ({ sessions }) => {
    const urls = linkedUrls(assistantText(sessions));
    return {
      evidence:
        urls.length === 0 ? "No web links in the reply" : urls.join(" | "),
      passed: urls.length >= 2,
      text: "Linked the things it named, not just one of them",
    };
  },
  text: "Linked the things it named, not just one of them",
};

/**
 * Every link in the reply points somewhere the turn actually went. This is the
 * half of the rule that has to hold while the other half is being pushed on:
 * the answer to a missing link is one from a result, never a plausible address.
 */
const assertLinksAreGrounded: Assertion = {
  check: ({ sessions }) => {
    const seen = toolText(sessions);
    const urls = linkedUrls(assistantText(sessions));
    const ungrounded = urls.filter((url) => {
      const key = comparable(url);
      return key === null || !seen.toLowerCase().includes(key);
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
 * A deliverable's own sources do not reach the user. The reply that summarizes
 * it has to carry links for the claims the reply itself makes.
 */
const assertRepliedWithLinksNotJustTheFile: Assertion = {
  check: ({ sessions }) => {
    const urls = linkedUrls(assistantText(sessions));
    return {
      evidence:
        urls.length > 0
          ? urls.join(" | ")
          : "Reply named its sources only inside the written file, if at all",
      passed: urls.length > 0,
      text: "Put links in the reply, not only in the deliverable",
    };
  },
  text: "Put links in the reply, not only in the deliverable",
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
    assertions: [assertRepliedWithLinksNotJustTheFile, assertLinksAreGrounded],
    // The research shape: a written deliverable is the natural home for the
    // sources, and the reply is where they went missing.
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
