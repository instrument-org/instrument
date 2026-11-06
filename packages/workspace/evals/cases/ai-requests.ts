/**
 * Can the chat answer a question about the AI requests behind it from
 * `instrument activity`, which lists them among what the user did?
 *
 * Every case seeds the request log (`requests`). The assertions read the
 * reply for the cause, the error or the model, and `howItWent` records
 * whether the run read `instrument activity`.
 */
import { type ChatId } from "../../src/schemas/chat-id";
import {
  type Assertion,
  defineEval,
  type EvalCase,
  type SeededRequest,
} from "../harness";
import {
  howItWent,
  onChat,
  replyMatches,
  seedChat,
  writeTurns,
} from "./activity-context";
import { fail, pass, said, sentAt } from "./handoff";

/** A chat request the user's chats made, `ago` seconds before the message. */
function request(
  chatId: ChatId,
  ago: number,
  over: Partial<SeededRequest> = {},
): SeededRequest {
  return {
    ago,
    chatId,
    connectionType: "openrouter",
    durationMs: 6000,
    kind: "language",
    modelRequested: "anthropic/claude-haiku-5.5",
    purpose: "chat",
    status: "finished",
    ...over,
  };
}

const overloaded = { error: "Overloaded", status: "failed" } as const;

/**
 * `replyMatches` over what the chat said after `prompt` alone, for a case
 * whose chat holds earlier turns written before it ran.
 */
function answerMatches(
  prompt: string,
  text: string,
  wanted: RegExp,
): Assertion {
  return {
    check: (ctx) => {
      const from = sentAt(ctx.sessions, prompt) ?? 0;
      const words = said(ctx.sessions)
        .filter((one) => one.at >= from)
        .map((one) => one.text)
        .join("\n");
      return wanted.test(words)
        ? pass(text, words.slice(0, 300))
        : fail(text, `missing ${String(wanted)}: ${words.slice(0, 300)}`);
    },
    text,
  };
}

const SLOW_ANSWER = "Why did your last answer take so long?";

/**
 * The chat's own last answer took 70 seconds: nine requests, two of them
 * failing as overloaded and tried again.
 */
const slowAnswer: EvalCase = {
  assertions: [
    answerMatches(
      SLOW_ANSWER,
      "names the overloaded errors as the cause",
      /overload/i,
    ),
    howItWent,
  ],
  kind: "chat",
  name: "ai-requests-slow-answer",
  prompt: SLOW_ANSWER,
  requests: async ({ chatId, sessionId }) => {
    const now = Date.now();
    await writeTurns(chatId, sessionId, [
      {
        at: new Date(now - 200_000),
        role: "user",
        text: "Plan three days in Lisbon for late March, one neighborhood a day.",
      },
      {
        at: new Date(now - 128_000),
        role: "assistant",
        text: "Day 1, Alfama: the castle in the morning, then the Fado Museum and dinner on Rua de São Pedro.\nDay 2, Belém: the monastery, the tower and pastéis at the old bakery.\nDay 3, Príncipe Real and Bairro Alto: gardens, shops, and a miradouro at sunset.",
      },
    ]);
    const own = (ago: number, over: Partial<SeededRequest> = {}) =>
      request(chatId, ago, { sessionId, ...over });
    return [
      own(199),
      own(192, { ...overloaded, durationMs: 1200 }),
      own(189, { ...overloaded, durationMs: 1500 }),
      own(185, { durationMs: 9000 }),
      own(175, { durationMs: 7000 }),
      own(167, { durationMs: 8000 }),
      own(158),
      own(151, { durationMs: 9000 }),
      own(141, { durationMs: 12_000 }),
    ];
  },
  viewing: onChat(),
};

/** Another chat's last request failed as overloaded a minute before the message. */
const failedChat: EvalCase = {
  assertions: [
    replyMatches("names the overloaded error", /overload/i),
    howItWent,
  ],
  kind: "chat",
  name: "ai-requests-failed-chat",
  prompt: "The kitchen quotes chat failed a minute ago. What happened?",
  requests: async () => {
    const kitchen = await seedChat("Kitchen remodel quotes", 90 / 86_400, [
      {
        role: "user",
        text: "Can you compare BrightBuild, Oakline and Castillo & Sons on price and timeline?",
      },
    ]);
    return [
      request(kitchen, 88),
      request(kitchen, 80, { ...overloaded, durationMs: 1800 }),
      request(kitchen, 74, { ...overloaded, durationMs: 2100 }),
    ];
  },
  viewing: onChat(),
};

/** One chat's requests all went to GPT-6 Luna, another's to Claude Haiku 5.5. */
const modelAnswered: EvalCase = {
  assertions: [
    replyMatches("names GPT-6 Luna", /gpt[- ]?6[- ]?luna/i),
    howItWent,
  ],
  kind: "chat",
  name: "ai-requests-model",
  prompt: "Which model answered in my taxes chat?",
  requests: async () => {
    const taxes = await seedChat("Taxes 2025", 2400 / 86_400, [
      {
        role: "user",
        text: "Add up the interest on my two 1099-INTs: Chase $412.18 and Ally $1,203.55.",
      },
      { role: "assistant", text: "The two come to $1,615.73 in interest." },
    ]);
    const lisbon = await seedChat("Lisbon trip", 1200 / 86_400, [
      {
        role: "user",
        text: "What's the weather like in Lisbon in late March?",
      },
      {
        role: "assistant",
        text: "Mild: highs around 19 °C, cool evenings, and a few rainy days.",
      },
    ]);
    const luna = { modelRequested: "openai/gpt-6-luna" };
    return [
      request(taxes, 2400, luna),
      request(taxes, 2392, luna),
      request(taxes, 2385, luna),
      request(taxes, 2377, luna),
      request(lisbon, 1200),
      request(lisbon, 1193),
      request(lisbon, 1185),
    ];
  },
  viewing: onChat(),
};

export const AI_REQUESTS_EVALS = [slowAnswer, failedChat, modelAnswered].map(
  defineEval,
);
