#!/usr/bin/env node
// Writes the `returning-user` workspace fixture and scenario into a Studio
// checkout (a worktree of the harness's own, never the primary one): five
// short everyday chats from weeks to months back, answered by Instrument's
// Auto model, for a person who used an earlier build.
//
//   node make-fixture.mjs <studio checkout>

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const checkout = path.resolve(process.argv[2]);
const DAY = 24 * 60;

const AUTO = {
  author: "instrument",
  canonicalId: "auto",
  features: ["inputFile", "inputImage", "inputText", "outputText", "tools"],
  name: "Auto",
  params: { provider: "instrument", providerConfigId: "instrument" },
  providerId: "auto",
  providerName: "Instrument",
  tags: ["recommended"],
  uri: "instrument/auto?provider=instrument&providerConfigId=instrument",
};

const CHATS = [
  {
    agedMinutes: 19 * DAY,
    key: "holiday-rates-text",
    name: "Text to clients about holiday rates",
    turns: [
      [
        "I want to text my regular clients that walks cost a bit more over the holidays. Most of them have been with me for years. Can you help me word it so it doesn't feel like a cash grab?",
        "Here are a few that stay friendly:\n\n1. Hi! Quick heads-up for the holidays: walks between Dec 20 and Jan 2 are $5 more, since I'm covering a lot of extra visits. Book early if you'll be away. Thank you for another great year!\n2. Holiday bookings are open. Rates go up a little from Dec 20 to Jan 2, and spots fill fast, so let me know your dates soon.\n3. Happy holidays from me and all the dogs! Holiday walks are $5 extra this year. Reply with your dates and I'll hold a spot.\n\nIf your clients know you well, 3 tends to land best, because it sounds like a note from you rather than a notice.",
      ],
      [
        "I like 3. Can you make it shorter?",
        "A shorter take:\n\n> Happy holidays from me and the dogs! Walks are $5 extra Dec 20 to Jan 2. Send me your dates and I'll hold a spot.\n\nThat fits on one phone screen without scrolling.",
      ],
    ],
  },
  {
    agedMinutes: 34 * DAY,
    key: "overnight-rate-question",
    name: "How much to charge for overnights",
    turns: [
      [
        "A client asked if I do overnight house-sits. I've only ever done walks and drop-ins. What do people usually charge?",
        "There are two common ways to price it:\n\n**A flat nightly rate.** One price covers the evening, the night and a morning walk. In many US neighborhoods that lands somewhere between $60 and $120 a night, depending on the area and how many pets.\n\n**A base rate plus extras.** A lower nightly price, with extra walks or a second pet added on.\n\nWorth pinning down before you name a number:\n\n- How many pets, and do any need medicine?\n- How long can the pets be alone during the day?\n- Do they expect you there all evening, or just overnight?\n- What happens if their flight is late?\n\nTell me a bit about this client and I can help you draft a reply.",
      ],
      [
        "One cat, no medicine, four nights. I'd be out during the day.",
        "Then a flat nightly rate is simplest for both of you. A reply could go like this:\n\n> Thanks for asking! For one cat, I charge $___ a night, which covers the evening, the night and breakfast. For four nights that's $___. I'm out during the day but always back by six.\n\nSaying when you'll be back answers the question most people are too shy to ask.",
      ],
    ],
  },
  {
    agedMinutes: 52 * DAY,
    key: "about-page-rewrite",
    name: "Rewrite my business's About page",
    turns: [
      [
        "Can you tidy this up for my website's About page? \"hi i walk dogs and look after pets in the neighborhood. been doing it on my own for six years. I know most of the dogs around here by name lol\"",
        "Here's a tidied version that keeps your voice:\n\n> Hi, I walk dogs and look after pets in the neighborhood. I have been doing it on my own for six years, and I know most of the dogs on these streets by name.\n\nI kept it short on purpose. If you want a second paragraph, the most useful thing to add is what people can do next: book a walk, ask about house-sits, or see your rates.",
      ],
    ],
  },
  {
    agedMinutes: 78 * DAY,
    key: "house-sit-packing-list",
    name: "Packing list for a house-sit",
    turns: [
      [
        "I'm doing my first long weekend house-sit next month, two dogs. What should I bring?",
        "A first house-sit list, grouped so you can pack by bag:\n\n**For the dogs**\n- Your own leashes as spares, poop bags, a towel for muddy paws\n- Treats you know they like\n- The vet's number and the nearest emergency vet's\n\n**For the house**\n- The house keys, plus a photo of the alarm instructions\n- A lint roller and a small notebook for anything odd\n\n**For you**\n- Phone charger, a book, your own pillow if you sleep badly elsewhere\n\nThe thing first-timers most often forget is the emergency vet's address, and it matters most at night.",
      ],
    ],
  },
  {
    agedMinutes: 113 * DAY,
    key: "late-invoice-reminder",
    name: "Reminder about a late invoice",
    turns: [
      [
        "A family I walk for is three weeks late paying an invoice. I like them and don't want to make it weird. Help me write a reminder?",
        "Here's one that's warm and still clear:\n\n> Hi ___,\n>\n> Hope you're all doing well. I'm doing my books and noticed invoice #___ from ___ is still open. Could you let me know when I can expect it? I've attached it again in case it got buried.\n>\n> Thanks so much, and give the dogs a scratch from me.\n>\n> ___\n\nAttaching the invoice again matters more than the wording. Most late payments are a lost email, and this makes it a one-click fix for them.",
      ],
    ],
  },
];

// Ids only have to be well-formed: the seeder mints fresh ones.
let minted = 0;
const ulid = () => `01M3SGAC3W${String(minted++).padStart(16, "0")}`;

/** One chat as the seeder reads it: superjson, with every time marked as a date. */
function session(chat) {
  const dates = {};
  const mark = (at) => {
    dates[at] = ["Date"];
  };
  const base = Date.parse("2026-06-01T15:00:00.000Z");
  const sessionId = `ses_${ulid()}`;
  const messages = [];
  let clock = base;
  const stamp = () => new Date((clock += 1500)).toISOString();
  for (const [ask, reply] of chat.turns) {
    clock += 90_000;
    const user = messages.length;
    const asked = stamp();
    const userId = `msg_${ulid()}`;
    messages.push({
      id: userId,
      metadata: { createdAt: asked, sessionId },
      parts: [
        {
          metadata: {
            createdAt: asked,
            id: `prt_${ulid()}`,
            messageId: userId,
            sessionId,
          },
          text: ask,
          type: "text",
        },
      ],
      role: "user",
    });
    mark(`messages.${user}.metadata.createdAt`);
    mark(`messages.${user}.parts.0.metadata.createdAt`);

    const assistant = messages.length;
    const started = stamp();
    const stepped = stamp();
    const texted = stamp();
    const ended = stamp();
    const finished = stamp();
    const assistantId = `msg_${ulid()}`;
    messages.push({
      id: assistantId,
      metadata: {
        aiGatewayModel: AUTO,
        createdAt: started,
        finishedAt: finished,
        finishReason: "stop",
        modelId: "auto",
        msToFinish: 6000,
        msToFirstChunk: 1500,
        providerId: "instrument",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: stepped,
            id: `prt_${ulid()}`,
            messageId: assistantId,
            sessionId,
            stepCount: 1,
          },
          type: "step-start",
        },
        {
          metadata: {
            createdAt: texted,
            endedAt: ended,
            id: `prt_${ulid()}`,
            messageId: assistantId,
            sessionId,
          },
          text: reply,
          type: "text",
        },
      ],
      role: "assistant",
    });
    mark(`messages.${assistant}.metadata.createdAt`);
    mark(`messages.${assistant}.metadata.finishedAt`);
    mark(`messages.${assistant}.parts.0.metadata.createdAt`);
    mark(`messages.${assistant}.parts.1.metadata.createdAt`);
    mark(`messages.${assistant}.parts.1.metadata.endedAt`);
  }
  const first = new Date(base).toISOString();
  const last = new Date(clock).toISOString();
  return {
    json: {
      createdAt: first,
      id: sessionId,
      messages,
      title: chat.name,
      titleSettledAt: last,
      updatedAt: last,
    },
    meta: {
      values: {
        createdAt: ["Date"],
        titleSettledAt: ["Date"],
        updatedAt: ["Date"],
        ...dates,
      },
    },
  };
}

const fixture = path.join(checkout, "fixtures/workspaces/returning-user");
for (const chat of CHATS) {
  const dir = path.join(fixture, "chats", chat.key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "session.json"), `${JSON.stringify(session(chat), null, 2)}\n`);
}
writeFileSync(
  path.join(fixture, "manifest.yaml"),
  [
    "description: >-",
    "  Five short everyday chats from weeks to months back, for a person coming",
    "  back to the app after using an earlier build.",
    "settings:",
    "  preferences:",
    // As a released build has it for a person who never turned it on.
    "    developerMode: false",
    // The harness runs the app inside a Seatbelt profile of its own, where the
    // app's own Seatbelt for the programs its agent runs cannot start. This is
    // the app's switch for running them anyway; the outer profile holds them.
    "    runProgramsWithoutSandbox: true",
    "chats:",
    ...CHATS.flatMap((chat) => [
      `  - key: ${chat.key}`,
      `    name: ${JSON.stringify(chat.name)}`,
      `    agedMinutes: ${chat.agedMinutes}`,
    ]),
    "",
  ].join("\n"),
);
writeFileSync(
  path.join(checkout, "fixtures/scenarios/returning-user.yaml"),
  [
    "description: A person who used an earlier build a few times, months ago, on the first launch of this one. Five old chats in a workspace in the app's own data, finished work in the folder an earlier build used in Documents, and no setup record. Setup opens on Welcome back.",
    "workspace: returning-user",
    "outputFolder: documents",
    "notifications: not-asked",
    "",
  ].join("\n"),
);
console.log(`wrote ${fixture} and fixtures/scenarios/returning-user.yaml`);
