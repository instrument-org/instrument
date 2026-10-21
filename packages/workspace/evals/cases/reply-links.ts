/**
 * Do the links in a reply open?
 *
 * Every files fence line, file link and app address (`instrument://memory/…`)
 * a reply writes is read back through the same check the end of a turn runs
 * (`brokenLinksIn`), so a run scores what the user could click. These are the
 * places a link has gone dead: a file made after a `cd` the reply's relative
 * path never saw, a file a task made that the chat names, and a memory or
 * skill the reply links by a name it was never saved under.
 *
 * Two scores, because the correction step is one of the things measured:
 * whether every link the user was shown opens (the reply as first written,
 * and any correction after it), and whether the turn's last reply's do. And
 * no turn takes more than one correction step.
 */
import { brokenLinksIn } from "../../src/lib/broken-links";
import { isToolPart } from "../../src/lib/is-tool-part";
import { filesNamedIn } from "../../src/lib/parse-files-block";
import { type ChatId } from "../../src/schemas/chat-id";
import { type Session } from "../../src/schemas/session";
import { type SessionMessage } from "../../src/schemas/session/message";
import { type Assertion, defineEval } from "../harness";

export function textOf(message: SessionMessage.WithParts): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

/** A step that ended a turn: it wrote and called nothing. */
export function finishedReply(message: SessionMessage.WithParts): boolean {
  return (
    message.role === "assistant" &&
    message.metadata.error === undefined &&
    !message.parts.some((part) => isToolPart(part)) &&
    textOf(message).trim() !== ""
  );
}

/** Each turn's assistant steps, the chat's and every task's. */
export async function turnsOf(ctx: {
  childSessions: () => Promise<{ sessions: Session.WithMessagesAndParts[] }[]>;
  sessions: Session.WithMessagesAndParts[];
}): Promise<SessionMessage.WithParts[][]> {
  const children = (await ctx.childSessions()).flatMap(
    (child) => child.sessions,
  );
  return [...ctx.sessions, ...children].flatMap((session) => {
    const turns: SessionMessage.WithParts[][] = [];
    for (const message of session.messages) {
      if (message.role === "user") {
        turns.push([]);
      } else if (message.role === "assistant") {
        turns.at(-1)?.push(message);
      }
    }
    return turns.filter((turn) => turn.some(finishedReply));
  });
}

export async function linksIn(
  messages: SessionMessage.WithParts[],
  chatId: ChatId,
): Promise<{ broken: string[]; files: number }> {
  const text = messages.map(textOf).join("\n\n");
  const broken = await brokenLinksIn({ chatId, text });
  return {
    broken: broken.map(({ link, reason }) => `${link} (${reason})`),
    files: filesNamedIn(text).length,
  };
}

const assertEveryLinkShownOpens: Assertion = {
  check: async ({ chatId, childSessions, sessions }) => {
    const text = "Every link the user was shown opens";
    const turns = await turnsOf({ childSessions, sessions });
    const { broken, files } = await linksIn(turns.flat(), chatId);
    return {
      evidence:
        broken.length === 0
          ? `${files} fence line(s), none broken`
          : broken.join(" | "),
      passed: broken.length === 0,
      text,
    };
  },
  text: "Every link the user was shown opens",
};

const assertLastReplyLinksOpen: Assertion = {
  check: async ({ chatId, childSessions, sessions }) => {
    const text = "Each turn's last reply has links that open";
    const turns = await turnsOf({ childSessions, sessions });
    const broken = (
      await Promise.all(
        turns.map(async (turn) => {
          const last = turn.findLast(finishedReply);
          return last ? (await linksIn([last], chatId)).broken : [];
        }),
      )
    ).flat();
    return {
      evidence: broken.length === 0 ? "none broken" : broken.join(" | "),
      passed: broken.length === 0,
      text,
    };
  },
  text: "Each turn's last reply has links that open",
};

const assertAtMostOneCorrection: Assertion = {
  check: async ({ childSessions, sessions }) => {
    const text = "No turn took more than one correction step";
    const turns = await turnsOf({ childSessions, sessions });
    // Every finished reply after a turn's first is a correction.
    const corrections = turns.map(
      (turn) => turn.filter(finishedReply).length - 1,
    );
    return {
      evidence: `corrections per turn: ${corrections.join(", ")}`,
      passed: corrections.every((count) => count <= 1),
      text,
    };
  },
  text: "No turn took more than one correction step",
};

/** The reply handed over at least one file in a fence, so the link score is about something. */
export const assertHandedOverAFile: Assertion = {
  check: async ({ chatId, childSessions, sessions }) => {
    const text = "Handed over a file in a fence";
    const turns = await turnsOf({ childSessions, sessions });
    const { files } = await linksIn(turns.flat(), chatId);
    return {
      evidence: `${files} fence line(s)`,
      passed: files > 0,
      text,
    };
  },
  text: "Handed over a file in a fence",
};

/**
 * Each turn the end-of-turn check corrected, read back from the transcript:
 * the note is never stored, but a turn has a second finished reply only when
 * the check asked for one. What the turn linked up to its first reply is
 * checked again at scoring time, beside what the correction step ran, since
 * a link that opens now was either flagged falsely or made to open by that
 * step.
 */
async function firingsIn(ctx: {
  chatId: ChatId;
  childSessions: () => Promise<{ sessions: Session.WithMessagesAndParts[] }[]>;
  sessions: Session.WithMessagesAndParts[];
}): Promise<{ brokenNow: string[]; correctionCalls: string[] }[]> {
  const turns = await turnsOf(ctx);
  return Promise.all(
    turns
      .filter((turn) => turn.filter(finishedReply).length > 1)
      .map(async (turn) => {
        const first = turn.findIndex(finishedReply);
        const correctionCalls = turn.slice(first + 1).flatMap((message) =>
          message.parts.flatMap((part) => {
            if (!isToolPart(part)) {
              return [];
            }
            const command: unknown =
              part.type === "tool-bash" ? part.input?.command : undefined;
            return [
              typeof command === "string"
                ? `bash: ${command.replaceAll("\n", " ").slice(0, 160)}`
                : part.type.replace("tool-", ""),
            ];
          }),
        );
        return {
          brokenNow: (await linksIn(turn.slice(0, first + 1), ctx.chatId))
            .broken,
          correctionCalls,
        };
      }),
  );
}

/** Fails whenever the check fired, so a run's table counts the firings. */
export const assertCheckDidNotFire: Assertion = {
  check: async (ctx) => {
    const text = "The end-of-turn link check did not fire";
    const firings = await firingsIn(ctx);
    return {
      evidence:
        firings.length === 0
          ? "no turn corrected"
          : firings
              .map(
                ({ brokenNow, correctionCalls }, i) =>
                  `firing ${i + 1}: still broken before it: ${brokenNow.join(", ") || "none"}; correction ran: ${correctionCalls.join(" ; ") || "nothing"}`,
              )
              .join(" || "),
      passed: firings.length === 0,
      text,
    };
  },
  text: "The end-of-turn link check did not fire",
};

/**
 * A firing whose links all open now, after a correction step that ran
 * nothing, flagged links that opened all along. One whose step ran something
 * is left to the transcript, since that step may have made them open.
 */
export const assertNoFalseFiring: Assertion = {
  check: async (ctx) => {
    const text = "No firing flagged links that opened";
    const firings = await firingsIn(ctx);
    const suspect = firings.filter(({ brokenNow }) => brokenNow.length === 0);
    const falseOnes = suspect.filter(
      ({ correctionCalls }) => correctionCalls.length === 0,
    );
    return {
      evidence:
        suspect.length === 0
          ? `${firings.length} firing(s), each with a link still broken`
          : `${falseOnes.length} false, ${suspect.length - falseOnes.length} to read in the transcript (their correction ran tools)`,
      passed: falseOnes.length === 0,
      text,
    };
  },
  text: "No firing flagged links that opened",
};

export const LINK_ASSERTIONS = [
  assertEveryLinkShownOpens,
  assertLastReplyLinksOpen,
  assertAtMostOneCorrection,
  assertCheckDidNotFire,
  assertNoFalseFiring,
];

export const REPLY_LINKS_EVALS = [
  defineEval({
    // The known dead link: a script run from inside the output folder
    // (`cd "$INSTRUMENT_OUTPUT" && python make.py`), then the CSV named by
    // its bare name, which reads against the work folder.
    assertions: [...LINK_ASSERTIONS, assertHandedOverAFile],
    kind: "chat",
    name: "reply-links-script-output",
    prompt:
      "Write a small Python script that makes a CSV of the numbers 1 to 20 and their squares, run it, and give me both the script and the CSV.",
  }),
  defineEval({
    // A file a task made, which the chat names when the task reports.
    assertions: [...LINK_ASSERTIONS, assertHandedOverAFile],
    kind: "chat",
    name: "reply-links-task-deliverable",
    prompt:
      "In the background, make me a loan amortization schedule as a spreadsheet: $25,000 at 6.5% over 5 years, monthly payments. Let me know when it's ready.",
  }),
  defineEval({
    // What the reply links is the memory and the skill it just saved, by
    // whatever names it saved them under.
    assertions: LINK_ASSERTIONS,
    kind: "chat",
    name: "reply-links-new-memory-and-skill",
    prompt:
      "Two things. Remember that I never want stevia in anything you suggest. And make me a skill for writing my weekly status update: three sections, Done, Next and Blocked, under 150 words.",
  }),
];
