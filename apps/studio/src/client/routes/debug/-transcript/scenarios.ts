import { MID_TURN_NOTE, StoreId } from "@instrument-org/workspace/client";

import { type CommandFacts } from "@/client/components/transcript/surface";

import { file } from "./parts";
import {
  activity,
  batch,
  call,
  type DataPart,
  emptyStep,
  fail,
  facts,
  maxSteps,
  notes,
  pause,
  prose,
  reasoning,
  type Act,
  type Scenario,
  stop,
  unknownTool,
  user,
} from "./script";
import {
  chose,
  edited,
  fetched,
  generated,
  loadedSkill,
  ran,
  ranAndFailed,
  ranInBackground,
  read,
  readImage,
  readMissing,
  searched,
  searchedForSummary,
  searchUnavailable,
  threw,
  wrote,
} from "./tools";

/** A task a scenario's chat starts: what its card and tab play out. */
interface DebugTask {
  /** The line its card ends on. */
  ended: string;
  script: Act[];
  title: string;
}

/** A scenario, with the tasks it starts and whether it arrives a page at a time. */
export type DebugScenario = Scenario & {
  /** What the registry says of the commands its calls started. */
  commands?: Omit<CommandFacts, "sessionId" | "startedAt">[];
  /** Turns shown at first, with the rest asked for as the reader nears the top. */
  pageTurns?: number;
  tasks?: Record<string, DebugTask>;
};

const browse = (command: string, explanation: string) =>
  ran({ command: `agent-browser ${command}`, explanation });

const startsTask = (sessionId: string, name: string) =>
  call({
    input: {
      command: `instrument task new --name '${name}'`,
      explanation: `Starting ${name}`,
    },
    output: {
      command: `instrument task new --name '${name}'`,
      commands: ["task"],
      durationMs: 60,
      exitCode: 0,
      handOffs: [
        { kind: "created", sessionId: StoreId.SessionSchema.parse(sessionId) },
      ],
      omittedBytes: 0,
      output: `Created ${name}. It is running now.`,
    },
    type: "tool-bash",
  });

const SHOPIFY_TASK = "ses_01M0000000000000000000TASK";

const assignment = (text: string): Act =>
  user("", {
    data: { kind: "assignment", text },
    type: "data-fromChat",
  });

/** The work the Shopify task does while the chat waits. */
const shopifyWork: Act[] = [
  assignment(
    "Compare Shopify's Hydrogen starter with Next.js Commerce for a small store.\n\n1. Read each one's current docs.\n2. Check whether either is still maintained.\n3. Build the store's home page on the better one.\n4. Check it in the browser.\n5. Say which you would pick and why.",
  ),
  activity("Reading the two starters' docs"),
  searched({
    explanation: "Searching for Hydrogen's current starter",
    query: "Shopify Hydrogen starter template 2026",
    results: [
      {
        title: "Hydrogen: Shopify's headless stack",
        url: "https://hydrogen.shopify.dev",
      },
      {
        title: "Getting started with Hydrogen",
        url: "https://shopify.dev/docs/storefronts/headless",
      },
    ],
  }),
  fetched({
    explanation: "Reading Next.js Commerce's page",
    text: "# Next.js Commerce\n\nThis repository was archived on October 20.",
    url: "https://vercel.com/templates/next.js/nextjs-commerce",
  }),
  activity("Building the home page"),
  wrote({
    content:
      "<!doctype html>\n<html>\n  <head>\n    <title>Harbor Coffee</title>\n  </head>\n  <body>\n    <h1>Roasted on the coast</h1>\n  </body>\n</html>\n",
    explanation: "Writing the store's home page",
    filePath: "harbor/index.html",
  }),
  activity("Checking the page"),
  browse("open file:///work/harbor/index.html", "Opening the page"),
  browse("click @e3", "Opening the first product"),
  browse("get title", "Reading the title"),
  browse("back", "Going back to the home page"),
];

const taskOnly = (name: string): DebugTask => ({
  ended: "Built the store on Hydrogen and checked it in the browser",
  script: shopifyWork,
  title: name,
});

const longChat = (turns: number): Act[] =>
  Array.from({ length: turns }, (_, index) => {
    const turn = (index + 1).toString();
    return [
      user(`Message ${turn}: what changed on the page this time?`),
      activity(`Looking at the page, pass ${turn}`),
      browse("open https://example.com", "Opening the page"),
      browse("get title", "Reading its title"),
      prose(
        `Pass ${turn}: the title is the same, and the second section moved up.\n\nNothing else changed since the last time you asked.`,
      ),
      stop(),
    ];
  }).flat();

const THROUGH = StoreId.MessageSchema.parse("msg_01M0000000000000000000000T");

const memoryNote = (count: number): DataPart => ({
  data: {
    forgotten: [],
    memories: Array.from({ length: count }, (_, index) => ({
      at: 0,
      name: `memory-${index.toString()}`,
      text: `Remembered thing ${index.toString()}`,
    })),
    more: 0,
    sentAt: 0,
    tells: "whole",
    told: {},
  },
  type: "data-memory",
});
const dateNote: DataPart = {
  data: { date: "Friday, November 6, 2026" },
  type: "data-dateChange",
};
const gapNote: DataPart = { data: { minutes: 5640 }, type: "data-messageGap" };
const skillsNote: DataPart = {
  data: { names: ["launch-plans"] },
  type: "data-skillMentions",
};
const clearedNote: DataPart = {
  data: { results: 38, through: THROUGH },
  type: "data-toolResultsCleared",
};
const rolloverNote: DataPart = {
  data: { droppedMessages: 41, retainedUserMessages: 12 },
  type: "data-contextRollover",
};
const limitNote: DataPart = {
  data: { continuations: 3 },
  type: "data-outputLimit",
};
const jobNote: DataPart = {
  data: {
    events: [
      {
        command: "pnpm build",
        durationMs: 120_000,
        exitCode: 1,
        id: "bg_1",
        logFilePath: "logs/bg_1.log",
        status: "failed",
      },
    ],
  },
  type: "data-jobEvent",
};

const LONG_ASK =
  "How does our pricing compare with Zendesk, Intercom and Freshdesk at the team size most of our customers are?\n\nI need the comparison for the pricing review on Thursday, so please check each one's current page rather than last year's numbers, and say which plan each of them would put a ten agent team on.";

/** Notes on messages and rows, folded and not, enough to fill both margins. */
const devNotesTurns = (name: string): Act[] => [
  user(`What changed on ${name} since last time?`, memoryNote(2), skillsNote),
  activity(`Looking at ${name}`),
  browse("open https://example.com", "Opening the page"),
  notes(clearedNote),
  browse("get title", "Reading its title"),
  prose(`The title of ${name} is the same, and the second section moved up.`),
  stop(),
];

const devNotes: Act[] = [
  ...devNotesTurns("the first page"),
  user(LONG_ASK, dateNote, gapNote, memoryNote(5), skillsNote, limitNote),
  prose("I'll read each one's pricing page first."),
  activity("Reading competitors' pricing pages"),
  searched({
    explanation: "Searching for current help desk prices",
    query: "help desk pricing 2026 Zendesk Intercom Freshdesk",
    results: [{ title: "Suite plans", url: "https://www.zendesk.com/pricing" }],
  }),
  notes(clearedNote, rolloverNote),
  fetched({
    explanation: "Reading Zendesk's plans",
    text: "# Suite plans\n\nSuite Team is $55 per agent a month.",
    url: "https://www.zendesk.com/pricing",
  }),
  activity("Writing up the comparison"),
  wrote({
    content: "# Pricing against three competitors\n",
    explanation: "Writing the comparison",
    filePath: "pricing-comparison.md",
  }),
  notes(limitNote),
  prose(
    "We're the cheapest at the team size most customers are: **$49** against Zendesk's $55 and Intercom's $74.\n\nZendesk would put a ten agent team on Suite Team, Intercom on Essential, and Freshdesk on Growth.",
    12,
  ),
  notes({
    data: { words: "Read the pricing pages and wrote the comparison" },
    type: "data-workSummary",
  }),
  stop(),
  user("", jobNote),
  prose("The build you left running failed, so the numbers page is stale."),
  stop(),
  user("Check the second one again.", memoryNote(1)),
  activity("Checking Intercom again"),
  fetched({
    explanation: "Reading Intercom's plans",
    text: "# Pricing\n\nEssential is $74 per seat a month.",
    url: "https://www.intercom.com/pricing",
  }),
  notes(rolloverNote, limitNote, clearedNote, dateNote),
  activity("Updating the comparison"),
  edited({
    explanation: "Correcting Intercom's number",
    filePath: "pricing-comparison.md",
    newString: "| Team | $49 | $55 | $74 |",
    oldString: "| Team | $49 | $55 | $47 |",
  }),
  notes(jobNote),
  prose(
    Array.from(
      { length: 40 },
      (_, index) =>
        `Line ${index.toString()} of a reply long enough to pass the top of the window as it arrives, so the transcript has to stop following it.`,
    ).join("\n\n"),
    40,
  ),
];

const devNotesLong: Act[] = Array.from({ length: 40 }, (_, index) =>
  devNotesTurns(`page ${index.toString()}`),
).flat();

/**
 * The moments the transcript has to get right, each about one thing. Scrolled
 * through a step at a time, they are how it is checked by eye: the fold, the
 * slot moving from kind to kind, a burst, a task's card, a message cutting
 * across a turn, and what a failure leaves open.
 */
export const scenarios: DebugScenario[] = [
  {
    id: "research",
    name: "Research, browsing and a document",
    script: [
      user(
        "How does our pricing compare with Zendesk, Intercom and Freshdesk?",
      ),
      prose("I'll read each one's pricing page first."),
      activity("Reading competitors' pricing pages"),
      searched({
        explanation: "Searching for current help desk prices",
        query: "help desk pricing 2026 Zendesk Intercom Freshdesk",
        results: [
          { title: "Suite plans", url: "https://www.zendesk.com/pricing" },
          {
            title: "Pricing and packaging",
            url: "https://www.intercom.com/pricing",
          },
          {
            title: "Plans",
            url: "https://www.freshworks.com/freshdesk/pricing",
          },
        ],
      }),
      fetched({
        explanation: "Reading Zendesk's plans",
        text: "Skip to main content\nSign in\n# Suite plans\n\nSuite Team is $55 per agent a month.",
        url: "https://www.zendesk.com/pricing",
      }),
      fetched({
        explanation: "Reading Intercom's plans",
        text: "Sign in\nMenu\nStart a trial",
        url: "https://www.intercom.com/pricing",
      }),
      activity("Looking at last year's pricing notes"),
      browse(
        "open https://www.notion.so/team/pricing",
        "Opening the pricing notes",
      ),
      facts({ hosts: ["notion.so"] }),
      browse("scroll down", "Reading the team plan"),
      browse("get text", "Copying the numbers"),
      activity("Writing up the comparison"),
      wrote({
        content:
          "# Pricing against three competitors\n\nWe're the cheapest at the team size most of our customers are.\n\n| Plan | Us | Zendesk | Intercom |\n| --- | --- | --- | --- |\n| Team | $49 | $55 | $74 |\n",
        explanation: "Writing the comparison",
        filePath: "pricing-comparison.md",
      }),
      edited({
        explanation: "Correcting Intercom's number",
        filePath: "pricing-comparison.md",
        newString: "| Team | $49 | $55 | $74 |",
        oldString: "| Team | $49 | $55 | $47 |",
      }),
      prose(
        "We're the cheapest at the team size most customers are: **$49** against Zendesk's $55 and Intercom's $74.\n\n```files\npricing-comparison.md\n```",
      ),
      notes({
        data: {
          words:
            "Read three pricing pages and last year's notes, and wrote the comparison",
        },
        type: "data-workSummary",
      }),
    ],
  },
  {
    id: "rating-card",
    name: "The card asking how it went",
    script: [
      user("Which of these three support tools costs least at ten agents?"),
      prose("Freshdesk, at $290 a month."),
      stop(),
      user("Check their current prices and update the comparison."),
      activity("Checking current prices"),
      read({
        explanation: "Reading the comparison",
        filePath: "pricing-comparison.md",
      }),
      prose("Freshdesk is still cheapest, and I updated the comparison."),
      notes({ data: {}, type: "data-ratingCard" }),
    ],
  },
  {
    id: "notion",
    name: "Sign-in, app calls and a count",
    script: [
      user("Make a database in Notion of the launch videos in this folder."),
      activity("Connecting Notion"),
      call({
        input: {
          explanation: "Connecting Notion",
          reason: "So I can read and write your Notion pages and databases.",
          slugs: ["notion"],
        },
        output: {
          kind: "sign-in",
          name: "Notion",
          site: "https://notion.so",
          slug: "notion",
          state: "asked",
        },
        type: "tool-connect_app",
      }),
      prose("Notion is connected. Reading the page now."),
      activity("Reading the launch page"),
      ran({
        command: 'instrument app call notion notion-fetch \'{"id":"launch"}\'',
        explanation: "Reading the launch page",
      }),
      facts({
        apps: [
          { app: "notion", calls: 1, failed: 0, ms: 700, tool: "notion-fetch" },
        ],
      }),
      activity("Creating the launch videos database"),
      ran({
        command:
          'instrument app call notion notion-create-database \'{"title":"Launch videos"}\'',
        explanation: "Creating the database",
      }),
      facts({
        apps: [
          {
            app: "notion",
            calls: 1,
            failed: 0,
            ms: 900,
            tool: "notion-create-database",
          },
        ],
      }),
      activity("Adding the videos to the new database"),
      ran({
        command: "python add_videos.py",
        explanation: "Adding each video as a row",
      }),
      facts({
        apps: [
          {
            app: "notion",
            calls: 14,
            failed: 0,
            ms: 9000,
            tool: "notion-create-pages",
          },
        ],
        counts: [{ count: 14, label: "rows added" }],
      }),
      prose("The database is ready, with all 14 videos in it."),
    ],
  },
  {
    id: "burst",
    name: "A burst of files",
    script: [
      user("Translate each product description into Spanish, one file each."),
      activity("Writing the Spanish translations"),
      ...[
        "backpack",
        "blanket",
        "candle",
        "lamp",
        "notebook",
        "scarf",
        "tent",
        "thermos",
        "towel",
        "wallet",
      ].map((name) =>
        wrote({
          content: `Una descripción de ${name}.`,
          explanation: `Writing the ${name} translation`,
          filePath: `Translations/${name}.txt`,
        }),
      ),
      prose("All ten are in the Translations folder."),
    ],
  },
  {
    id: "script",
    name: "A script that makes files",
    script: [
      user("Chart today's temperature and make it an animated GIF."),
      activity("Animating the temperature curve"),
      ran({
        command: "python chart.py",
        explanation: "Drawing each frame",
        output: "Wrote frames/ and nashville.gif\n",
      }),
      facts({
        counts: [{ count: 24, label: "frames rendered" }],
        files: [
          { change: "created", path: "/work/nashville.gif", via: "disk" },
          { change: "read", path: "/work/chart.py", via: "command" },
        ],
      }),
      activity("Checking the animation"),
      readImage({
        explanation: "Reviewing the GIF's last frame",
        filePath: "preview.png",
      }),
      readImage({
        explanation: "Reviewing the GIF's first frame",
        filePath: "preview-start.png",
      }),
      prose("Here's the animated curve.\n\n```files\nnashville.gif\n```"),
    ],
  },
  {
    commands: [
      {
        command:
          'sleep 120; osascript -e \'display notification "Your 2 minutes are up." sound name "Glass"\'',
        explanation: "2-minute timer with an alert",
        id: "bg_1",
      },
      {
        command: "fswatch ~/Downloads | ./file-contract.sh",
        explanation: "Watching Downloads for the signed contract",
        id: "bg_2",
      },
      {
        command: "sleep 30",
        explanation: "A shorter timer that went off",
        id: "bg_3",
        ranMs: 30_000,
      },
    ],
    id: "commands",
    name: "Commands left running",
    script: [
      user("Set a timer for 2 minutes, and keep an eye on my downloads."),
      activity("Setting it all going"),
      ranInBackground({
        command:
          'sleep 120; osascript -e \'display notification "Your 2 minutes are up." sound name "Glass"\'',
        explanation: "Setting a 2-minute timer",
        processId: "bg_1",
      }),
      ranInBackground({
        command: "fswatch ~/Downloads | ./file-contract.sh",
        explanation: "Watching Downloads",
        processId: "bg_2",
      }),
      ranInBackground({
        command: "sleep 30",
        explanation: "Setting a short timer",
        processId: "bg_3",
      }),
      prose("Your timer is running, and I'm watching your Downloads folder."),
    ],
  },
  {
    id: "image",
    name: "A generated image",
    script: [
      user("Generate me an image of a cat."),
      activity("Making a cat image"),
      generated({
        explanation: "Generating a playful cat portrait",
        filePath: "cat-portrait",
        prompt: "A charming, photorealistic fluffy orange tabby cat.",
      }),
      prose("Here you go.\n\n```files\ncat-portrait.png\n```"),
    ],
  },
  {
    id: "task",
    name: "A task the chat starts",
    script: [
      user(
        "Which is better for a small coffee store, Hydrogen or Next.js Commerce?",
      ),
      activity("Looking at the two starters"),
      searched({
        explanation: "Searching for the two starters",
        query: "Hydrogen vs Next.js Commerce",
        results: [{ title: "Hydrogen", url: "https://hydrogen.shopify.dev" }],
      }),
      startsTask(SHOPIFY_TASK, "Compare the storefront starters"),
      prose("I've started a task to compare them and build the home page."),
      stop(),
      user("", {
        data: {
          events: [
            {
              sessionId: StoreId.SessionSchema.parse(SHOPIFY_TASK),
              status: "done",
              summary: "Hydrogen, since Next.js Commerce was archived.",
              title: "Compare the storefront starters",
            },
          ],
        },
        type: "data-taskEvent",
      }),
      prose(
        "I'd pick **Hydrogen**: the Next.js Commerce repo was archived on October 20.",
      ),
    ],
    tasks: { [SHOPIFY_TASK]: taskOnly("Compare the storefront starters") },
  },
  {
    id: "mid-turn",
    name: "A message sent mid-turn",
    script: [
      user("Rebrand the checklist with the new name."),
      activity("Reading the checklist"),
      read({ explanation: "Reading the checklist", filePath: "checklist.md" }),
      prose("Reading it now."),
      activity("Replacing the old name"),
      edited({
        explanation: "Replacing the name",
        filePath: "checklist.md",
        newString: "Instrument",
        oldString: "Finalpoint",
      }),
      user("Also use the new logo link: https://example.com/logo", {
        data: {
          text: MID_TURN_NOTE,
        },
        type: "data-intent",
      }),
      activity("Adding the logo"),
      edited({
        explanation: "Adding the logo link",
        filePath: "checklist.md",
        newString: "![Logo](https://example.com/logo)",
        oldString: "![Logo]()",
      }),
      prose("Done, with the new name and the new logo link."),
    ],
  },
  {
    id: "failures",
    name: "Failures stay open",
    script: [
      user("Send the report to the team."),
      activity("Sending the report"),
      ranAndFailed({
        command: "python send.py",
        explanation: "Sending it",
        output: "SMTP refused the connection\n",
      }),
      prose("That didn't go through. Trying another way."),
      ran({ command: "python send.py --retry", explanation: "Trying again" }),
      fail({
        classification: "transient",
        kind: "provider",
        message: "The provider stopped answering.",
      } as never),
      user("Try once more."),
      activity("Sending the report"),
      reasoning("The mail server may be rate limiting us."),
      maxSteps(25),
    ],
  },
  {
    id: "failed-calls",
    name: "Calls that fail",
    script: [
      user("Update the notes and look up the release date."),
      activity("Reading the notes"),
      readMissing({
        explanation: "Reading the old notes",
        filePath: "notes/old.md",
      }),
      activity("Looking up the release date"),
      searchUnavailable({
        explanation: "Searching for the release date",
        query: "release date",
      }),
      activity("Writing the notes"),
      threw({
        error: "The disk is full.",
        explanation: "Saving the new notes",
        filePath: "notes/new.md",
      }),
      unknownTool({ error: "Tool 'grep' is not available", input: {} }),
      emptyStep(),
      prose("None of that worked, so the notes are as they were."),
    ],
  },
  {
    id: "asks",
    name: "A question, a skill and what was sent",
    script: [
      user("Plan the launch from this brief.", {
        data: {
          files: [file({ filePath: "brief.pdf", mimeType: "application/pdf" })],
        },
        type: "data-attachments",
      }),
      activity("Reading the brief"),
      loadedSkill({
        explanation: "Loading the launch skill",
        name: "launch-plans",
      }),
      read({ explanation: "Reading the brief", filePath: "brief.pdf" }),
      pause(),
      chose({
        answer: { selectedChoice: "Friday" },
        choices: ["Friday", "Monday"],
        explanation: "Asking which day it goes out",
        question: "Which day should it go out?",
      }),
      activity("Checking the date"),
      searchedForSummary({
        explanation: "Checking for conflicts that Friday",
        query: "major product launches this Friday",
        text: "Two larger launches are planned for that Friday.",
      }),
      prose("Friday works, though two larger launches land the same day."),
    ],
  },
  {
    id: "parallel-calls",
    name: "Calls waiting their turn",
    script: [
      user("Check these three pages."),
      activity("Reading the three pages"),
      batch(
        fetched({
          explanation: "Reading the first",
          text: "# One",
          url: "https://a.example",
        }),
        fetched({
          explanation: "Reading the second",
          text: "# Two",
          url: "https://b.example",
        }),
        fetched({
          explanation: "Reading the third",
          text: "# Three",
          url: "https://c.example",
        }),
      ),
      prose("All three say the same thing."),
    ],
  },
  {
    id: "long-chat",
    name: "A long chat, a page at a time",
    pageTurns: 20,
    script: longChat(80),
  },
  { id: "dev-notes", name: "Developer notes", script: devNotes },
  {
    id: "dev-notes-tail",
    name: "Developer notes running past the end",
    script: [
      ...Array.from({ length: 12 }, () => [
        user("Tell me about this page."),
        prose("It says the same thing as last time, with one more section."),
        stop(),
      ]).flat(),
      user("Look at the last one."),
      activity("Reading the last one"),
      read({ explanation: "Reading it", filePath: "last.md" }),
      notes(
        dateNote,
        gapNote,
        limitNote,
        clearedNote,
        rolloverNote,
        skillsNote,
        jobNote,
        memoryNote(1),
      ),
      stop(),
    ],
  },
  {
    id: "dev-notes-kinds",
    name: "Developer notes on every kind of row",
    script: [
      user("Plan the launch from this brief.", dateNote),
      activity("Reading the brief"),
      read({ explanation: "Reading the brief", filePath: "brief.pdf" }),
      notes(limitNote),
      startsTask(SHOPIFY_TASK, "Compare the storefront starters"),
      notes(clearedNote),
      chose({
        answer: { selectedChoice: "Friday" },
        choices: ["Friday", "Monday"],
        explanation: "Asking which day it goes out",
        question: "Which day should it go out?",
      }),
      notes(skillsNote),
      fail({
        classification: "transient",
        kind: "provider",
        message: "The provider stopped answering.",
      } as never),
      notes(rolloverNote),
    ],
    tasks: { [SHOPIFY_TASK]: taskOnly("Compare the storefront starters") },
  },
  { id: "dev-notes-long", name: "Developer notes, long", script: devNotesLong },
];
