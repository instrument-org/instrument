/**
 * Does the agent think a decision through with the user when that is what
 * they came for?
 *
 * A reply sized like a work update hands the thinking back: after laying out
 * their business's money, a person wrote "I need to think this through" and
 * the chat answered "Okay. Take the time you need." Each case is scored on
 * the reply to the user's last message alone:
 *
 * - `think-it-through-after-numbers`: the reported shape, a decision laid
 *   out, then the ask to think it through as its own message.
 * - `think-it-through-brain-dump`: one loose message thinking out loud, with
 *   no question in it.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

type Sessions = Session.WithMessagesAndParts[];

/** What the chat wrote after the user's last message, its tasks aside. */
function lastReply(sessions: Sessions): string {
  const messages = sessions
    .filter((session) => !session.parentId)
    .flatMap((session) => session.messages);
  const lastUser = messages.findLastIndex(
    (message) =>
      message.role === "user" &&
      message.parts.some(
        (part) => part.type === "text" && part.text.trim() !== "",
      ),
  );
  return messages
    .slice(lastUser + 1)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === "text" && part.text.trim() !== "" ? [part.text.trim()] : [],
    )
    .join("\n\n");
}

/**
 * The number is loose on purpose: what is caught is a line that hands the
 * thinking back, where taking it up runs to a few paragraphs.
 */
const TOOK_IT_UP: Assertion = {
  check: ({ sessions }) => {
    const reply = lastReply(sessions);
    return {
      evidence: `${reply.length} chars: ${JSON.stringify(reply.slice(0, 600))}`,
      passed: reply.length >= 300,
      text: TOOK_IT_UP.text,
    };
  },
  text: "the last reply takes the thinking up (at least 300 characters)",
};

const ASKED_BACK: Assertion = {
  check: ({ sessions }) => {
    const paragraphs = lastReply(sessions).split(/\n\s*\n/);
    const closing = paragraphs.at(-1) ?? "";
    return {
      evidence: JSON.stringify(closing),
      passed: closing.includes("?"),
      text: ASKED_BACK.text,
    };
  },
  text: "the last reply ends on a question back to the user",
};

export const THINKING_OUT_LOUD_EVALS = [
  defineEval({
    assertions: [TOOK_IT_UP, ASKED_BACK],
    followUps: [{ prompt: "I need to think this through.", settled: true }],
    kind: "chat",
    name: "think-it-through-after-numbers",
    prompt:
      "ok here's where the studio is this month. 62k in the operating account, 38k left on the line of credit at 9.5%, payroll is 14k twice a month, and two clients owe us 27k between them, one of them 60 days late. trying to decide whether to pay down the line now or sit on the cash.",
  }),
  defineEval({
    assertions: [TOOK_IT_UP, ASKED_BACK],
    kind: "chat",
    name: "think-it-through-brain-dump",
    prompt:
      "brain dump, bear with me. I keep going back and forth on hiring a second designer. we have enough work booked for maybe six months but I'm scared of the commitment if it dries up, and Priya has been stretched thin since summer and I think she's starting to burn out. part of me wants to just raise prices and take on less instead. not sure what I want yet",
  }),
];
