/**
 * Does the chat read its tab group's layout and what changed in it from the
 * notes on a message? The first message asks what is open beside it, which
 * only the layout says; the follow-up comes after the person opened a page
 * beside the chat and asks what they just opened, which only the change
 * says. No window stands behind the tabs, so the notes are all it has.
 */
import {
  type LayoutRead,
  type LayoutTab,
} from "../../src/schemas/group-layout";
import { type Assertion, type EvalCase } from "../harness";
import { type Context, fail, pass, said, sentAt } from "./handoff";

const CHAT: LayoutTab = {
  address: "instrument://chat/this-chat",
  id: "this-chat",
  isThisChat: true,
  isUp: true,
  kind: "chat",
  title: "Help desk prices",
};
const ZENDESK: LayoutTab = {
  address: "https://www.zendesk.com/pricing",
  id: "tab_01KZEN0000000000000000000",
  kind: "website",
  title: "Zendesk pricing",
};
const DOWNLOADS: LayoutTab = {
  address: "/Users/mac-user/Downloads",
  id: "tab_01KDL00000000000000000000",
  kind: "folder",
  title: "Downloads",
};
const INTERCOM: LayoutTab = {
  address: "https://www.intercom.com/pricing",
  id: "tab_01KINT0000000000000000000",
  kind: "website",
  title: "Intercom pricing",
};

const GROUP = { id: "group_help" };
const FOLLOW_UP = "What did I just open?";

const FIRST: LayoutRead = {
  layout: {
    focused: 1,
    group: GROUP,
    sides: [
      { tabs: [{ ...ZENDESK, isUp: true }, DOWNLOADS] },
      { tabs: [CHAT] },
    ],
  },
  movedIn: {},
  movedOut: {},
};

const SECOND: LayoutRead = {
  layout: {
    focused: 1,
    group: GROUP,
    sides: [
      { tabs: [ZENDESK, DOWNLOADS, { ...INTERCOM, isUp: true }] },
      { tabs: [CHAT] },
    ],
  },
  movedIn: {},
  movedOut: {},
};

/** What the chat said before the follow-up, and after it. */
function replies(ctx: Context) {
  const at = sentAt(ctx.sessions, FOLLOW_UP) ?? Infinity;
  const all = said(ctx.sessions);
  const join = (each: typeof all) => each.map(({ text }) => text).join("\n");
  return {
    after: join(all.filter((each) => each.at >= at)),
    before: join(all.filter((each) => each.at < at)),
  };
}

/**
 * The window's own words, which say nothing to the user: a tab "in front" of
 * nothing in particular, or a side called a group, when a group is the whole
 * set of sides.
 */
const WINDOW_JARGON =
  /\bin front\b(?! of)|\bfront tab\b|(left|right)(-hand)? (tab )?group\b|(left|right) half'?s? group/i;

/** No reply says where things are in the window's own words. */
const inUserWords: Assertion = {
  check: (ctx) => {
    const text = "says it in the user's words, not the window's";
    const reply = said(ctx.sessions)
      .map(({ text: words }) => words)
      .join("\n");
    const match = WINDOW_JARGON.exec(reply);
    return match === null
      ? pass(text, reply.slice(0, 300))
      : fail(text, `"${match[0]}": ${reply.slice(0, 500)}`);
  },
  text: "says it in the user's words, not the window's",
};

const besideIt: EvalCase = {
  assertions: [
    {
      check: (ctx) => {
        const text =
          "names the chat's side and the website and folder beside it";
        const { before } = replies(ctx);
        const missing = [/right/i, /zendesk/i, /downloads/i].filter(
          (word) => !word.test(before),
        );
        return missing.length === 0
          ? pass(text, before.slice(0, 400))
          : fail(
              text,
              `missing ${missing.join(", ")}: ${before.slice(0, 400)}`,
            );
      },
      text: "names the chat's side and the website and folder beside it",
    },
    {
      check: (ctx) => {
        const text = "names the page opened since the last message";
        const { after } = replies(ctx);
        return /intercom/i.test(after)
          ? pass(text, after.slice(0, 400))
          : fail(text, after.slice(0, 400) || "no reply");
      },
      text: "names the page opened since the last message",
    },
    inUserWords,
  ],
  followUps: [{ layout: SECOND, prompt: FOLLOW_UP }],
  kind: "chat",
  layout: FIRST,
  name: "group-layout-beside",
  prompt:
    "Quick one before we start: which side of the window are you on, and what's open beside you?",
};

/** Every bash command the chat ran, joined. */
function commandsRun(ctx: Context): string {
  return ctx.sessions
    .flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "tool-bash" && typeof part.input?.command === "string"
            ? [part.input.command]
            : [],
        ),
      ),
    )
    .join("\n");
}

const SHOW_PROMPT =
  "Show me https://example.com in a tab, then tell me in one sentence where it is on my screen relative to this chat.";

/**
 * Where a page the chat shows lands, said back: each case lays the group out
 * one way, the stand-in window places the page as the app does, and the
 * reply must say where it went without calling a page on the other side "in
 * front of" the chat. The words a reply must and must not have are the
 * truth for that layout.
 */
function placementCase({
  layout,
  mustNot,
  must,
  name,
  truth,
}: {
  layout: LayoutRead["layout"];
  must: RegExp[];
  mustNot: RegExp[];
  name: string;
  truth: string;
}): EvalCase {
  return {
    assertions: [
      {
        check: (ctx) => {
          const text = "showed the page with instrument window show";
          const run = commandsRun(ctx);
          return /instrument\s+window\s+show\b/.test(run)
            ? pass(text, run.slice(0, 300))
            : fail(text, run.slice(0, 300) || "no commands");
        },
        text: "showed the page with instrument window show",
      },
      {
        check: (ctx) => {
          const text = `says where it is: ${truth}`;
          const reply = said(ctx.sessions)
            .map(({ text: words }) => words)
            .join("\n");
          const missing = must.filter((word) => !word.test(reply));
          const wrong = mustNot.filter((word) => word.test(reply));
          return missing.length === 0 && wrong.length === 0
            ? pass(text, reply.slice(0, 500))
            : fail(
                text,
                `${missing.length > 0 ? `missing ${missing.join(", ")}; ` : ""}${wrong.length > 0 ? `wrongly ${wrong.join(", ")}; ` : ""}${reply.slice(0, 500)}`,
              );
        },
        text: `says where it is: ${truth}`,
      },
      inUserWords,
    ],
    kind: "chat",
    layout: { layout, movedIn: {}, movedOut: {} },
    name,
    prompt: SHOW_PROMPT,
  };
}

/** Words that put the page over the chat, which is wrong when it is beside it. */
const OVER_THE_CHAT =
  /in front of (this|the|our) chat|in front of (me|you)\b|on top of (this|the|our) chat|cover(s|ing)? (this|the|our) chat|(this|the) chat is (now )?(hidden|behind)/i;

const PLACEMENT_EVALS = [
  placementCase({
    layout: { focused: 0, group: GROUP, sides: [{ tabs: [CHAT] }] },
    must: [/right/i],
    mustNot: [OVER_THE_CHAT, /\bbehind\b|hidden/i],
    name: "window-show-placement-alone",
    truth: "a new right side, beside the chat on the left",
  }),
  placementCase({
    layout: {
      focused: 0,
      group: GROUP,
      sides: [
        { tabs: [CHAT] },
        { tabs: [{ ...ZENDESK, isUp: true }, DOWNLOADS] },
      ],
    },
    must: [/right/i],
    mustNot: [OVER_THE_CHAT],
    name: "window-show-placement-beside",
    truth: "showing on the right side, beside the chat on the left",
  }),
  placementCase({
    layout: {
      focused: 1,
      group: GROUP,
      sides: [
        { tabs: [CHAT] },
        { tabs: [{ ...ZENDESK, isUp: true }, DOWNLOADS] },
      ],
    },
    must: [
      /right/i,
      /behind|hidden|background|not (showing|visible)|another tab/i,
    ],
    mustNot: [OVER_THE_CHAT],
    name: "window-show-placement-hidden",
    truth: "a hidden tab on the right side, behind Zendesk pricing",
  }),
  placementCase({
    layout: {
      focused: 1,
      group: GROUP,
      sides: [{ tabs: [{ ...ZENDESK, isUp: true }] }, { tabs: [CHAT] }],
    },
    must: [
      /right/i,
      /cover|in place of|in front of|over|hid|behind it|replac/i,
    ],
    mustNot: [],
    name: "window-show-placement-chat-right",
    truth:
      "on the right, the chat's side, covering the chat, which is now hidden behind it",
  }),
];

export const GROUP_LAYOUT_EVALS = [besideIt, ...PLACEMENT_EVALS];
