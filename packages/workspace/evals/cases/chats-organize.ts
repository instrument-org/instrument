/**
 * Does the chat organize the person's chats with `instrument chats` when
 * asked to, and touch only the chats the ask names?
 *
 * Each case seeds a handful of earlier chats and asks for a tidy-up in the
 * person's words. The score is what the chats' records say afterward: which
 * are filed, which are put away, and that the rest were left as they were.
 *
 * - **file-trips.** Three chats are about one trip and two are not; a project
 *   called Travel exists beside another.
 * - **archive-stale.** "Older than a month that I never came back to" takes
 *   both halves: an old chat the person returned to stays, and so does a
 *   recent one they never returned to.
 */
import { ensureChat } from "../../src/lib/chat/chat-records";
import { renameChat } from "../../src/lib/chat/chats";
import { createProject } from "../../src/lib/chat/projects";
import { ChatReads } from "../../src/lib/chat-reads";
import { type ChatId } from "../../src/schemas/chat-id";
import { StoreId } from "../../src/schemas/store-id";
import { type Assertion, defineEval } from "../harness";
import { seed } from "./chat-history";
import { fail, pass } from "./handoff";

const DAY = 86_400_000;
const MINUTE = 60_000;

/** A seeded chat, by the key its case knows it by. */
interface Seeded {
  chatId: ChatId;
  sessionId: StoreId.Session;
}

const seeded = new Map<string, Seeded>();
const projects = new Map<string, string>();

/**
 * Runs `work` with the clock at `when`. A record is stamped with the moment
 * it is written, and a chat's last activity is its newest record, so a chat
 * seeded today reads as active today whatever its messages say.
 */
async function writtenAt<T>(when: number, work: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args: unknown[]) =>
      // `Reflect.construct` answers `any`; a Date's constructor makes a Date.
      Reflect.construct(target, args.length === 0 ? [when] : args) as Date,
    get: (target, key, receiver) =>
      key === "now"
        ? () => when
        : (Reflect.get(target, key, receiver) as unknown),
  });
  try {
    return await work();
  } finally {
    globalThis.Date = RealDate;
  }
}

/**
 * An earlier chat: what the person asked and what they got, `daysAgo`, then
 * each time they came back to it, days after it began.
 */
async function earlierChat({
  ask,
  daysAgo,
  key,
  reply,
  returns = [],
  title,
}: {
  ask: string;
  daysAgo: number;
  key: string;
  reply: string;
  returns?: { ask: string; daysLater: number; reply: string }[];
  title: string;
}) {
  const start = Date.now() - daysAgo * DAY;
  const sessionId = StoreId.newSessionId();
  const chatId = await writtenAt(start, async () => {
    const id = await ensureChat(sessionId, ask);
    await seed(id, sessionId, "user", new Date(start), ask);
    await seed(id, sessionId, "assistant", new Date(start + MINUTE), reply);
    await renameChat(id, title);
    return id;
  });
  for (const back of returns) {
    const at = start + back.daysLater * DAY;
    await writtenAt(at, async () => {
      await seed(chatId, sessionId, "user", new Date(at), back.ask);
      await seed(
        chatId,
        sessionId,
        "assistant",
        new Date(at + MINUTE),
        back.reply,
      );
    });
  }
  seeded.set(key, { chatId, sessionId });
}

/** Where each seeded chat stands in its records now. */
async function standing(keys: readonly string[]) {
  const rows = new Map<string, { archived: boolean; project?: string }>();
  for (const key of keys) {
    const chat = seeded.get(key);
    if (!chat) {
      continue;
    }
    const session = await ChatReads.session(chat);
    if (session.isOk()) {
      rows.set(key, {
        archived: session.value.archivedAt !== undefined,
        ...(session.value.project && { project: session.value.project }),
      });
    }
  }
  return rows;
}

function described(
  rows: Map<string, { archived: boolean; project?: string }>,
): string {
  return [...rows]
    .map(
      ([key, row]) =>
        `${key}: ${row.archived ? "archived" : "inbox"}${row.project ? `, filed` : ""}`,
    )
    .join("; ");
}

/** Whether a bash call of the run's ran `instrument chats`. Recorded, not scored. */
const usedTheCommand: Assertion = {
  check: (ctx) => {
    const text = "how it organized them (recorded, not scored)";
    const commands = ctx.sessions.flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "tool-bash" && typeof part.input?.command === "string"
            ? [part.input.command]
            : [],
        ),
      ),
    );
    const organizing = commands.filter((command) =>
      /\binstrument chats\b|\$I chats\b/.test(command),
    );
    return pass(
      text,
      `${organizing.length} of ${commands.length} command(s) ran instrument chats${organizing[0] ? ` (first: ${organizing[0].slice(0, 120)})` : ""}`,
    );
  },
  text: "how it organized them (recorded, not scored)",
};

// ---------------------------------------------------------------------------
// file-trips
// ---------------------------------------------------------------------------

const TRIPS = ["lisbon-sights", "porto-day-trip", "lisbon-madrid"];
const NOT_TRIPS = ["groceries", "espresso"];

async function seedTrips() {
  projects.set("Travel", (await createProject({ name: "Travel" })).id);
  projects.set("Home", (await createProject({ name: "Home" })).id);
  await earlierChat({
    ask: "What should I see in Lisbon in October? We have three days.",
    daysAgo: 9,
    key: "lisbon-sights",
    reply:
      "Three days fits Alfama and the castle, Belém for the tower and the pastries, and a day out to Sintra.",
    title: "Three days in Lisbon",
  });
  await earlierChat({
    ask: "What's a good day trip from Porto?",
    daysAgo: 8,
    key: "porto-day-trip",
    reply:
      "The Douro Valley: about two hours by train to Pinhão, with a tasting at a quinta and the river on the way.",
    title: "Day out from Porto",
  });
  await earlierChat({
    ask: "Should we take the train or fly from Lisbon to Madrid?",
    daysAgo: 7,
    key: "lisbon-madrid",
    reply:
      "Fly. The train takes most of a day with a change, and the flight is a little over an hour.",
    title: "Train or plane to Madrid",
  });
  await earlierChat({
    ask: "Give me a grocery list for a week of simple dinners.",
    daysAgo: 6,
    key: "groceries",
    reply:
      "Chicken thighs, rice, canned tomatoes, onions, spinach, eggs, pasta, parmesan, lemons.",
    title: "Weeknight dinner groceries",
  });
  await earlierChat({
    ask: "How often should I descale my espresso machine?",
    daysAgo: 5,
    key: "espresso",
    reply: "Every two to three months, sooner with hard water.",
    title: "Descaling the espresso machine",
  });
}

const filedTheTrips: Assertion = {
  check: async () => {
    const text = "filed the three trip chats under Travel, and only those";
    const travel = projects.get("Travel");
    const rows = await standing([...TRIPS, ...NOT_TRIPS]);
    const missed = TRIPS.filter((key) => rows.get(key)?.project !== travel);
    const extra = NOT_TRIPS.filter((key) => rows.get(key)?.project);
    const evidence = [...rows]
      .map(
        ([key, row]) =>
          `${key}: ${row.project === travel ? "Travel" : (row.project ?? "none")}`,
      )
      .join("; ");
    return missed.length === 0 && extra.length === 0
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "filed the three trip chats under Travel, and only those",
};

const archivedNone: Assertion = {
  check: async () => {
    const text = "put no chat away";
    const rows = await standing([...TRIPS, ...NOT_TRIPS]);
    return [...rows.values()].some((row) => row.archived)
      ? fail(text, described(rows))
      : pass(text, described(rows));
  },
  text: "put no chat away",
};

// ---------------------------------------------------------------------------
// archive-stale
// ---------------------------------------------------------------------------

/** Old, and one exchange long. */
const STALE = ["paint", "tax-form"];
/** Returned to, or recent. */
const KEPT = ["sourdough", "lease", "birthday"];

async function seedStale() {
  await earlierChat({
    ask: "What's a warm white paint for a north-facing hallway?",
    daysAgo: 52,
    key: "paint",
    reply: "White Dove (OC-17) stays creamy in north light.",
    title: "Warm white for the hallway",
  });
  await earlierChat({
    ask: "Which form do I use to report freelance income?",
    daysAgo: 41,
    key: "tax-form",
    reply: "Schedule C, filed with your 1040.",
    title: "Form for freelance income",
  });
  // Old, and returned to twice: the last time inside the month.
  await earlierChat({
    ask: "My sourdough starter isn't rising. What am I doing wrong?",
    daysAgo: 47,
    key: "sourdough",
    reply: "Feed it twice a day at room temperature for a few days.",
    returns: [
      {
        ask: "It doubled! How do I know when it's ready to bake with?",
        daysLater: 4,
        reply: "Drop a spoonful in water. If it floats, it's ready.",
      },
      {
        ask: "The loaf came out dense. Longer proof next time?",
        daysLater: 27,
        reply: "Yes, and a wetter dough. Try 75 percent hydration.",
      },
    ],
    title: "Sourdough starter troubles",
  });
  // Old all the way through, but returned to.
  await earlierChat({
    ask: "Can my landlord raise the rent in the middle of a lease?",
    daysAgo: 60,
    key: "lease",
    reply: "Not unless the lease itself says so.",
    returns: [
      {
        ask: "The lease has an escalation clause. What does that change?",
        daysLater: 2,
        reply: "Then the raise it describes is allowed, on the terms it sets.",
      },
    ],
    title: "Rent increase during a lease",
  });
  await earlierChat({
    ask: "Gift ideas for my dad's 70th? He likes fishing.",
    daysAgo: 6,
    key: "birthday",
    reply: "A guided day on the river, or a good fly reel.",
    title: "Dad's 70th birthday gift",
  });
}

const archivedTheStale: Assertion = {
  check: async () => {
    const text = "put away the two old chats never returned to";
    const rows = await standing(STALE);
    return STALE.every((key) => rows.get(key)?.archived)
      ? pass(text, described(rows))
      : fail(text, described(rows));
  },
  text: "put away the two old chats never returned to",
};

const keptTheRest: Assertion = {
  check: async (ctx) => {
    const text =
      "left the returned-to, the recent and its own chat in the inbox";
    const rows = await standing(KEPT);
    const own = await ChatReads.session({
      chatId: ctx.chatId,
      sessionId: ctx.sessions[0]?.id ?? StoreId.newSessionId(),
    });
    const ownArchived = own.isOk() && own.value.archivedAt !== undefined;
    const evidence = `${described(rows)}; own: ${ownArchived ? "archived" : "inbox"}`;
    return [...rows.values()].some((row) => row.archived) || ownArchived
      ? fail(text, evidence)
      : pass(text, evidence);
  },
  text: "left the returned-to, the recent and its own chat in the inbox",
};

export const CHATS_ORGANIZE_EVALS = [
  defineEval({
    assertions: [filedTheTrips, archivedNone, usedTheCommand],
    kind: "chat",
    name: "chats-file-trips",
    prompt: "File my trip chats under Travel.",
    setup: seedTrips,
  }),
  defineEval({
    assertions: [archivedTheStale, keptTheRest, usedTheCommand],
    kind: "chat",
    name: "chats-archive-stale",
    prompt: "Archive everything older than a month that I never came back to.",
    setup: seedStale,
  }),
];
