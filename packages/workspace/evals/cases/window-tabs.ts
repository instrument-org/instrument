/**
 * Does the conversation arrange the user's tabs the way it is told to?
 *
 * The conversation acts on the window's tabs with `tab` (open, replace, close,
 * show), and hands a tab already open to a task with `--tab`. A task opens the
 * pages it works on itself, so `tab open` is for showing the user something
 * and never a step in handing work over. Every case here starts from a note
 * naming the tabs the user has open, answered by the harness's stand-in
 * window, and scores the commands the conversation ran.
 *
 * - **A new page is the task's to open.** The failure that prompted this: a
 *   conversation ran `open` and `task new` in one command, wrote a brief that
 *   said the tab id would come from `open`, and passed no `--tab`, so the
 *   task had nothing and stopped.
 * - **A page on screen is handed over, not opened again.**
 * - **Closing is exact.** It closes the tabs named, and nothing else of the
 *   user's.
 * - **A tab already open is brought forward**, not opened a second time.
 * - **A result the user asks to see goes on screen.**
 * - **A result left on a page is that page.** A task that filled a cart in a
 *   tab of its own finished, and the conversation said the cart was "waiting
 *   in" a link to the task, whose chip opens the transcript over the page.
 *   The task here is a stand-in (`finishesAs`), so the case scores only the
 *   reply to its finish note.
 */
import { type Session } from "../../src/schemas/session";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { type Assertion, defineEval } from "../harness";

const JAR = "https://en.wikipedia.org/wiki/Jar";
const JAR_TAB = "ses_01M3AX9RF3C2E9RTATMB602W0C";
const EXAMPLE_TAB = "ses_01M3AX9RF3C2E9RTATMB602W0D";
const IANA_TAB = "ses_01M3AX9RF3C2E9RTATMB602W0E";
const HOME_TAB = "screen-3c1d7e0a-5a1b-4c2e-9f11-0a6c1f2b7d10";
const CART = "https://unscentedco.com/en-us/cart";
const CART_TAB = "ses_01M3AX9RF3C2E9RTATMB602W0F";

/** Every bash command the conversation ran, in order. */
function bashCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

/** The `tab <verb>` invocations in a command, each with its arguments. */
function tabCalls(command: string): { args: string[]; verb: string }[] {
  return [...command.matchAll(/(?:^|[\n;&|])\s*tab\s+(\w+)([^\n;&|]*)/g)].map(
    (match) => ({
      args: (match[2] ?? "").trim().split(/\s+/).filter(Boolean),
      verb: match[1] ?? "",
    }),
  );
}

const STARTS_A_TASK = /(?:^|[\n;&|])\s*task new\b/;

const delegated: Assertion = {
  check: ({ sessions }) => {
    const started = bashCommands(sessions).filter((command) =>
      STARTS_A_TASK.test(command),
    );
    return {
      evidence: started.length > 0 ? started.join("\n---\n") : "no task new",
      passed: started.length > 0,
      text: "Started a task for the work",
    };
  },
  text: "Started a task for the work",
};

const startedNoTask: Assertion = {
  check: ({ sessions }) => {
    const started = bashCommands(sessions).filter((command) =>
      STARTS_A_TASK.test(command),
    );
    return {
      evidence: started.length > 0 ? started.join("\n---\n") : "no task new",
      passed: started.length === 0,
      text: "Did it without a task",
    };
  },
  text: "Did it without a task",
};

/**
 * Never opened a page and started a task in the same command, where the brief
 * is written before the tab id exists, and never passed a `--tab` it had not
 * yet been told.
 */
const neverOpenedToHandOver: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCommands(sessions);
    const both = commands.filter(
      (command) =>
        STARTS_A_TASK.test(command) &&
        tabCalls(command).some(({ verb }) => verb === "open"),
    );
    return {
      evidence:
        both.length > 0
          ? both.join("\n---\n")
          : `${commands.length} commands, none opening a tab beside task new`,
      passed: both.length === 0,
      text: "Never opened a tab and started a task in one command",
    };
  },
  text: "Never opened a tab and started a task in one command",
};

function handedTab(tabId: string): Assertion {
  const text = `Handed the task tab ${tabId}`;
  return {
    check: ({ sessions }) => {
      const handed = bashCommands(sessions).filter(
        (command) =>
          STARTS_A_TASK.test(command) &&
          new RegExp(`--tab[ =]['"]?${tabId}`).test(command),
      );
      return {
        evidence:
          handed.length > 0
            ? handed.join("\n---\n")
            : bashCommands(sessions).join("\n---\n") || "no commands",
        passed: handed.length > 0,
        text,
      };
    },
    text,
  };
}

/** Everything the conversation said, in order. */
function replies(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      ),
    )
    .join("\n");
}

const neverLinkedATask: Assertion = {
  check: ({ sessions }) => {
    const links = replies(sessions).match(/\]\(instrument:\/\/task\/[^)]*\)/g);
    return {
      evidence: links ? links.join("\n") : "no task links",
      passed: !links,
      text: "Never pointed the user at a task for its result",
    };
  },
  text: "Never pointed the user at a task for its result",
};

/** Put the page in front of the user, or linked it by its address. */
function pointedAtPage(tabId: string, url: string): Assertion {
  const text = `Showed tab ${tabId} or linked ${url}`;
  return {
    check: ({ sessions }) => {
      const shown = bashCommands(sessions)
        .flatMap(tabCalls)
        .filter((call) => call.verb === "show" && call.args.includes(tabId));
      const said = replies(sessions);
      const linked = said.includes(`](${url}`);
      return {
        evidence:
          shown.length > 0
            ? `tab show ${tabId}`
            : linked
              ? `linked ${url}`
              : said.slice(-600) || "no reply",
        passed: shown.length > 0 || linked,
        text,
      };
    },
    text,
  };
}

/** The new-tab page on screen, with the user's other tabs open behind it. */
function homeWith(
  tabs: { at: string; id: string; title: string }[],
): SessionMessageDataPart.ViewContextDataPart {
  return {
    screen: "home",
    tabs: [{ at: "/new-tab", id: HOME_TAB, title: "New tab" }, ...tabs],
    url: "/new-tab",
  };
}

function neverRanTab(verb: string): Assertion {
  const text = `Never ran tab ${verb}`;
  return {
    check: ({ sessions }) => {
      const calls = bashCommands(sessions)
        .flatMap(tabCalls)
        .filter((call) => call.verb === verb);
      return {
        evidence:
          calls.length > 0
            ? calls
                .map((call) => `tab ${verb} ${call.args.join(" ")}`)
                .join("\n")
            : "none",
        passed: calls.length === 0,
        text,
      };
    },
    text,
  };
}

function ranTab(
  verb: string,
  { exactly, matching }: { exactly?: string[]; matching?: RegExp } = {},
): Assertion {
  const text = exactly
    ? `Ran tab ${verb} on exactly ${exactly.join(", ")}`
    : `Ran tab ${verb}${matching ? ` on ${String(matching)}` : ""}`;
  return {
    check: ({ sessions }) => {
      const calls = bashCommands(sessions)
        .flatMap(tabCalls)
        .filter((call) => call.verb === verb);
      const args = calls.flatMap((call) => call.args);
      const passed = exactly
        ? exactly.every((id) => args.includes(id)) &&
          args.every((arg) => exactly.includes(arg))
        : matching
          ? args.some((arg) => matching.test(arg))
          : calls.length > 0;
      return {
        evidence:
          calls.length > 0
            ? calls
                .map((call) => `tab ${verb} ${call.args.join(" ")}`)
                .join("\n")
            : bashCommands(sessions).join("\n---\n") || "no commands",
        passed,
        text,
      };
    },
    text,
  };
}

export const WINDOW_TABS_EVALS = [
  defineEval({
    // The run that prompted this, in the words it was typed in.
    assertions: [pointedAtPage(CART_TAB, CART), neverLinkedATask],
    finishesAs: {
      leavesOpen: [{ at: CART, id: CART_TAB }],
      said: [
        "I left this one-time-purchase cart ready in the store, without starting checkout or subscribing:",
        "",
        "| Qty. | Item | Price | Price/oz |",
        "|---:|---|---:|---:|",
        "| 2 | Body Soap, 2L Refill Pouch | $67.00 | $0.50 |",
        "| 1 | Daily Shampoo, 2L Refill Pouch | $33.50 | $0.50 |",
        "| 1 | Daily Conditioner, 500 ml | $6.50 | $0.38 |",
        "| | Subtotal | $107.00 | $0.49 |",
        "",
        "The cart confirms the $105 free-shipping threshold is met. Subscribe and save takes 15% off the first order of eligible items; I left it unselected.",
      ].join("\n"),
    },
    kind: "chat",
    name: "window-tabs-result-on-a-page",
    prompt:
      "https://unscentedco.com/\n\nAlright, I want to purchase unscented body wash at the best price from here based on price per ounce. And I'm also interested in getting a cart that's at least $105 because that's a subscription, and I think we also use their conditioner and their shampoo. So we might as well do a set if there's an incentive for savings. Also, I'm willing to consider the subscribe and save stuff too",
    viewing: homeWith([]),
  }),

  defineEval({
    // The Windows run that started this, in the words it was typed in.
    assertions: [delegated, neverOpenedToHandOver],
    kind: "chat",
    name: "window-tabs-new-page",
    prompt:
      "go to wikipedia to the Jar page, then navigate to 5 other pages from there",
    viewing: homeWith([]),
  }),

  defineEval({
    assertions: [delegated, handedTab(JAR_TAB), neverRanTab("open")],
    kind: "chat",
    name: "window-tabs-hands-open-page",
    prompt: "follow five links from this page, one after another",
    viewing: {
      page: {
        tab: JAR_TAB,
        tabs: [
          { id: JAR_TAB, title: "Jar - Wikipedia", url: JAR },
          {
            id: EXAMPLE_TAB,
            title: "Example Domain",
            url: "https://example.com/",
          },
        ],
        text: "A jar is a rigid, cylindrical or slightly conical container, typically made of glass, ceramic, or plastic.",
        title: "Jar - Wikipedia",
        url: JAR,
      },
      screen: "browser",
      url: JAR,
    },
  }),

  defineEval({
    assertions: [
      startedNoTask,
      ranTab("close", { exactly: [EXAMPLE_TAB, IANA_TAB] }),
    ],
    kind: "chat",
    name: "window-tabs-close-named",
    prompt: "Close the example.com and IANA tabs.",
    viewing: homeWith([
      { at: "https://example.com/", id: EXAMPLE_TAB, title: "Example Domain" },
      {
        at: "https://www.iana.org/help/example-domains",
        id: IANA_TAB,
        title: "Example Domains - IANA",
      },
      { at: JAR, id: JAR_TAB, title: "Jar - Wikipedia" },
    ]),
  }),

  defineEval({
    assertions: [
      startedNoTask,
      ranTab("show", { exactly: [JAR_TAB] }),
      neverRanTab("open"),
    ],
    kind: "chat",
    name: "window-tabs-show-open",
    prompt: "Pull up the Jar article again.",
    viewing: homeWith([
      { at: "https://example.com/", id: EXAMPLE_TAB, title: "Example Domain" },
      { at: JAR, id: JAR_TAB, title: "Jar - Wikipedia" },
    ]),
  }),

  defineEval({
    // A page, which only means something on screen: a few lines of text the
    // conversation can fairly quote instead.
    assertions: [delegated, ranTab("open", { matching: /\.html$/ })],
    followUps: ["Put it on my screen."],
    kind: "chat",
    name: "window-tabs-show-result",
    prompt:
      "Make a small HTML page about jars, with a heading and three facts, in my Instrument folder.",
    viewing: homeWith([]),
  }),
];
