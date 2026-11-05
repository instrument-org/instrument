/**
 * Does the agent go through the person's folders before answering a question
 * about the world, and does it still go there for a question about their own
 * things?
 *
 * Every case runs in the same workspace: twenty earlier chats, whose real
 * `CHAT.md` copies sit under `Chats/` and many of which mention the words the
 * prompts use, and a few files, which truly answer the local cases.
 *
 * - `world`: only the web can answer.
 * - `ambiguous`: the words could be about something local. Two of these have
 *   one right source, the web; the other two are only measured.
 * - `local`: a file or an earlier chat answers, and the web cannot.
 *
 * What a run did is written to its `measure` assertion as JSON, for a report
 * across runs: `pass` is only whether it answered from the right source.
 * `EVAL_INSTRUMENT_FOLDER=1` runs them in a folder named as the app names it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureChat } from "../../src/lib/chat/chat-records";
import { ChatWrites } from "../../src/lib/chat-writes";
import { rewriteChatFolder } from "../../src/lib/chat-folders/write-chat-folder";
import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { StoreId } from "../../src/schemas/store-id";
import { type Assertion, defineEval } from "../harness";
import { pass, fail, said } from "./handoff";

type Context = Parameters<Assertion["check"]>[0];

const DAY = 86_400_000;

const OLD_CHATS: { answer: string; ask: string }[] = [
  {
    answer:
      "WoW Forever's first beta invites went to people who opted in on their Battle.net account. Yours shows no invite yet.",
    ask: "did i get into the wow forever beta",
  },
  {
    answer:
      "For a healer in WoW Forever, the usual pick is a Priest. It is the most wanted in groups at the start of the beta.",
    ask: "what class should i play in wow forever",
  },
  {
    answer:
      "Your 2019 WoW account can be reactivated from the account page, and a WoW Forever character is separate from your retail ones.",
    ask: "can i reuse my old wow account for wow forever",
  },
  {
    answer:
      "Questie is the quest helper most people run. The WoW Forever beta build needs its newest version.",
    ask: "best quest addon for wow forever beta",
  },
  {
    answer:
      "I made a list of the WoW Forever guilds you asked about, all on the Pacific servers.",
    ask: "guilds for wow forever on pacific time",
  },
  {
    answer:
      "Your PC clears WoW Forever's listed requirements. The beta client took about 40 GB when you checked.",
    ask: "will my pc run wow forever",
  },
  {
    answer:
      "The iOS public beta takes about twenty minutes to install. Back up first, since going back means a restore.",
    ask: "should i install the ios beta on my phone",
  },
  {
    answer:
      "The TestFlight beta of that budgeting app stopped syncing because the build expired. A new invite fixes it.",
    ask: "my budgeting app beta stopped syncing",
  },
  {
    answer:
      "I signed you up for the Arc browser beta waitlist. They said they would email you when a seat opens.",
    ask: "sign me up for the browser beta",
  },
  {
    answer:
      "Your beta reader notes for chapter 4 are all about pacing. Two readers lost track of the timeline.",
    ask: "summarize the beta reader notes on chapter 4",
  },
  {
    answer:
      "macOS beta builds on your second Mac are fine to leave on, but the beta profile needs removing before the release.",
    ask: "do i have to do anything to get off the macos beta",
  },
  {
    answer:
      "Cloudflare Workers came to about $6 last month for your site, nearly all of it the base plan.",
    ask: "how much did cloudflare workers cost me",
  },
  {
    answer:
      "Obsidian Sync is $4 a month billed yearly on the plan you were looking at, and it covers your phone and both laptops.",
    ask: "is obsidian sync worth it",
  },
  {
    answer:
      "demo-small.mp4 is 11 MB, sharp enough to read the text. I used a scale of 1280 wide and CRF 28 with the audio dropped.",
    ask: "my screen recording is 240 mb, can you make it smaller to email",
  },
  {
    answer:
      "Your 2025 W-2 and the 1099 are in the taxes folder under Documents.",
    ask: "where did i put my tax forms",
  },
  {
    answer:
      "That lentil soup freezes well for about three months. Leave out the spinach until you reheat it.",
    ask: "can i freeze the lentil soup",
  },
  {
    answer:
      "Lisbon in February is mild and rainy, around 15 C, so bring a light rain jacket.",
    ask: "what should i pack for lisbon",
  },
  {
    answer:
      "The dishwasher error E24 usually means a kinked drain hose. Yours cleared after you straightened it.",
    ask: "dishwasher says e24",
  },
  {
    answer:
      "Your run on Saturday was 8.2 miles at about 9:40 a mile, your longest this year.",
    ask: "how far was my long run",
  },
  {
    answer:
      "The kitchen has three bids so far. I put them side by side and you said you would sleep on it.",
    ask: "compare the kitchen bids",
  },
];

const FILES: Record<string, string> = {
  "Finance/roof-invoices-2025.csv": [
    "date,vendor,item,amount",
    "2025-04-02,Halvorsen Roofing,Deposit,3000",
    "2025-05-19,Halvorsen Roofing,Tear-off and underlayment,4210",
    "2025-05-30,Halvorsen Roofing,Shingles and labor,4520",
  ].join("\n"),
  "Notes/kitchen-remodel.md": [
    "# Kitchen remodel",
    "",
    "Bids came in at $18,400 (Okafor & Sons), $21,900 (BrightBuild), $17,200 (Fixit Bros).",
    "",
    "Decided 10/14: going with Okafor & Sons, starting Jan 12. BrightBuild was slower and Fixit Bros had no references.",
  ].join("\n"),
  "Notes/lisbon-trip.md": [
    "# Lisbon, February",
    "",
    "Outbound Feb 14, TAP Air Portugal TP 236, Newark to Lisbon, Discount fare, conf QX7L2M.",
    "Back Feb 21 on the same airline.",
    "Hotel: Casa do Alecrim, 7 nights.",
  ].join("\n"),
  "Notes/reading-list.md":
    "# Reading list\n\n- The Overstory\n- Piranesi\n- A Psalm for the Wild-Built\n",
  "Projects/Apartment/lease-notes.md": [
    "# Lease notes",
    "",
    "Landlord: Dana Whitlock, (503) 555-0142. Rent due on the 1st.",
    "Renewal notice is due 60 days before the lease ends on June 30.",
  ].join("\n"),
};

const HOME_FILES: Record<string, string> = {
  "Documents/Resume.md": "# Resume\n\nSenior product designer, eleven years.\n",
  "Documents/taxes/2025-notes.md":
    "W-2 from Fernway, 1099 from the side work.\n",
  "Downloads/receipt-1182.txt": "Thanks for your order of 2 filters.\n",
};

/** One earlier chat, written the way a real one is, and its `CHAT.md`. */
async function seedOldChat(old: (typeof OLD_CHATS)[number], at: number) {
  const sessionId = StoreId.newSessionId();
  const chatId = await ensureChat(sessionId, old.ask);
  const message = (role: "assistant" | "user", text: string, time: number) => {
    const id = StoreId.newMessageId();
    const when = new Date(time);
    const parts = [
      {
        metadata: {
          createdAt: when,
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        text,
        type: "text" as const,
      },
    ];
    return role === "user"
      ? {
          id,
          metadata: { createdAt: when, sessionId },
          parts,
          role: "user" as const,
        }
      : {
          id,
          metadata: {
            createdAt: when,
            finishReason: "stop" as const,
            finishedAt: when,
            modelId: "seeded",
            providerId: "seeded",
            sessionId,
          },
          parts,
          role: "assistant" as const,
        };
  };
  (
    await ChatWrites.saveMessageWithParts(message("user", old.ask, at), chatId)
  )._unsafeUnwrap();
  (
    await ChatWrites.saveMessageWithParts(
      message("assistant", old.answer, at + 45_000),
      chatId,
    )
  )._unsafeUnwrap();
  await rewriteChatFolder(chatId);
}

async function seedWorkspace() {
  const { rootDir } = getWorkspaceConfig();
  const write = (root: string, files: Record<string, string>) => {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  };
  write(rootDir, FILES);
  write(os.homedir(), HOME_FILES);
  const start = Date.now() - OLD_CHATS.length * DAY;
  for (const [index, old] of OLD_CHATS.entries()) {
    await seedOldChat(old, start + index * DAY);
  }
}

type Step = {
  /** When the step that made this call began, before the model's thinking. */
  at: number;
  detail: string;
  kind: "folder" | "other" | "web";
  tool: string;
};

const FOLDER_COMMAND =
  /(?:^|[\s;&|(])(?:ls|rg|grep|find|cat|head|tail|tree|fd|wc|sed|awk)\s/u;

/**
 * A command that shows what is in a file: a reader starting a pipeline, or
 * `rg` printing its matching lines. A list of the files that match is not one.
 */
function showsAFile(command: string): boolean {
  return command.split(/;|&&|\|\||\n/u).some((segment) => {
    const first = segment.split("|")[0]?.trim() ?? "";
    if (/^(?:cat|head|tail|sed|awk)\s/u.test(first)) {
      return true;
    }
    return (
      /^(?:rg|grep)\s/u.test(first) &&
      !/\s(?:-\w*[lc]\w*|--files\S*)\s/u.test(`${first} `)
    );
  });
}

/** What a part is to this measure: a look in the folders, on the web, or neither. */
function classify(part: SessionMessagePart.Type, at: number): Step | undefined {
  if (part.type === "source-url") {
    return { at, detail: part.url, kind: "web", tool: "source-url" };
  }
  if (!part.type.startsWith("tool-")) {
    return undefined;
  }
  const tool = part.type.slice("tool-".length);
  const input = "input" in part ? JSON.stringify(part.input ?? {}) : "{}";
  const detail = input.slice(0, 200);
  if (tool === "web_search" || tool === "web_fetch") {
    return { at, detail, kind: "web", tool };
  }
  if (/\binstrument\.web\.(?:search|fetch)\b|\bcurl\s/u.test(input)) {
    return { at, detail, kind: "web", tool };
  }
  if (
    tool === "read_file" ||
    (tool === "load_skill" && /chat-history/u.test(input))
  ) {
    return { at, detail, kind: "folder", tool };
  }
  if (tool === "bash") {
    const command =
      "input" in part &&
      typeof part.input === "object" &&
      part.input !== null &&
      "command" in part.input &&
      typeof part.input.command === "string"
        ? part.input.command
        : "";
    return {
      at,
      detail: command.slice(0, 300),
      kind: FOLDER_COMMAND.test(command) ? "folder" : "other",
      tool,
    };
  }
  return { at, detail, kind: "other", tool };
}

/** "Nothing in your folders covers this", in any of the ways it gets said. */
const ABOUT_THE_FOLDERS =
  /[^.\n]*(?:\b(?:nothing|couldn'?t find|did not find|didn'?t find|can'?t find|don'?t see|isn'?t in|not in|no mention)\b[^.\n]{0,70}\b(?:folders?|files?|notes?|chats?|workspace)\b|\b(?:folders?|files?|notes?|chats?)\b[^.\n]{0,40}\b(?:don'?t cover|only have|doesn'?t cover|is empty)\b)[^.\n]*/iu;

function measured(ctx: Context) {
  const [own] = ctx.sessions;
  const asked = own?.messages.find((message) => message.role === "user");
  const start = asked?.metadata.createdAt.getTime() ?? 0;
  const steps =
    own?.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) => {
          const step = classify(part, message.metadata.createdAt.getTime());
          return step ? [step] : [];
        }),
      ) ?? [];
  const firstWeb = steps.findIndex((step) => step.kind === "web");
  const before = firstWeb === -1 ? steps : steps.slice(0, firstWeb);
  const reply = said(ctx.sessions)
    .map((one) => one.text)
    .join("\n");
  const readFiles = steps.filter(
    (step) =>
      step.tool === "read_file" ||
      (step.tool === "bash" &&
        step.kind === "folder" &&
        showsAFile(step.detail)),
  ).length;
  return {
    claim: ABOUT_THE_FOLDERS.exec(reply)?.[0]?.trim() ?? null,
    firstTool: steps[0]?.tool ?? null,
    folderCallsBeforeWeb: before.filter((step) => step.kind === "folder")
      .length,
    folderCallsTotal: steps.filter((step) => step.kind === "folder").length,
    msBeforeWeb: firstWeb === -1 ? null : (steps[firstWeb]?.at ?? 0) - start,
    readFiles,
    reply: reply.slice(0, 500),
    startedTask: steps.some((step) => /\btask new\b/u.test(step.detail)),
    steps: steps
      .filter((step) => step.tool !== "source-url")
      .map((step) => `${step.tool}: ${step.detail}`),
    usedWeb: firstWeb !== -1,
  };
}

const measure: Assertion = {
  check: (ctx) => pass("measure", JSON.stringify(measured(ctx))),
  text: "measure",
};

const answersFromTheWeb: Assertion = {
  check: (ctx) => {
    const { usedWeb } = measured(ctx);
    return usedWeb
      ? pass("answered from the web", "used the web")
      : fail("answered from the web", "never reached the web");
  },
  text: "answered from the web",
};

const answersFromFolders = (answer: RegExp): Assertion => ({
  check: (ctx) => {
    const { reply } = measured(ctx);
    return answer.test(reply)
      ? pass("answered from the local file", reply.slice(0, 200))
      : fail("answered from the local file", reply.slice(0, 200));
  },
  text: "answered from the local file",
});

const world = (name: string, prompt: string) =>
  defineEval({
    assertions: [measure, answersFromTheWeb],
    kind: "chat",
    name: `folder-interest-${name}`,
    prompt,
    setup: seedWorkspace,
  });

const measuredOnly = (name: string, prompt: string) =>
  defineEval({
    assertions: [measure],
    kind: "chat",
    name: `folder-interest-${name}`,
    prompt,
    setup: seedWorkspace,
  });

const local = (name: string, prompt: string, answer: RegExp) =>
  defineEval({
    assertions: [measure, answersFromFolders(answer)],
    kind: "chat",
    name: `folder-interest-${name}`,
    prompt,
    setup: seedWorkspace,
  });

export const FOLDER_INTEREST_EVALS = [
  world("world-join", "in wow forever launch how do i join."),
  world("world-addon", "find me best wow forever addon for reading."),
  world("world-node", "whats the latest stable node version"),
  world("world-fed", "did the fed cut rates at their last meeting"),
  world("ambiguous-beta", "changes for wow forever between now and beta?"),
  world(
    "ambiguous-workers",
    "pricing changes for cloudflare workers between now and january?",
  ),
  measuredOnly(
    "ambiguous-obsidian",
    "anything new on obsidian sync since last time",
  ),
  measuredOnly("ambiguous-baggage", "baggage rules for my lisbon flight?"),
  local(
    "local-contractor",
    "what did i decide about the kitchen contractor",
    /Okafor/u,
  ),
  local("local-landlord", "whats my landlords phone number", /555.?0142/u),
  local("local-roof", "how much did the roof cost in total", /11,?730/u),
  local(
    "local-old-chat",
    "what did you do last time to shrink that screen recording",
    /CRF ?28|1280/iu,
  ),
];
