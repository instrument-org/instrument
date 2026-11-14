/**
 * Does the chat read its tab group's layout and what changed in it from the
 * notes on a message? The first message asks what is open beside it, which
 * only the layout says; the follow-up comes after the person opened a page
 * beside the chat and asks what they just opened, which only the change
 * says. No window stands behind the tabs, so the notes are all it has.
 */
import {
  type LayoutSent,
  type LayoutTab,
} from "../../src/schemas/group-layout";
import { type EvalCase } from "../harness";
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

const GROUP = { id: CHAT.id, title: CHAT.title };
const FOLLOW_UP = "What did I just open?";

const FIRST: LayoutSent = {
  changes: [],
  layout: {
    focused: 1,
    group: GROUP,
    sides: [
      { tabs: [{ ...ZENDESK, isUp: true }, DOWNLOADS] },
      { tabs: [CHAT] },
    ],
  },
};

const SECOND: LayoutSent = {
  changes: [{ beside: true, change: "opened", side: "left", tab: INTERCOM }],
  layout: {
    focused: 1,
    group: GROUP,
    sides: [
      { tabs: [ZENDESK, DOWNLOADS, { ...INTERCOM, isUp: true }] },
      { tabs: [CHAT] },
    ],
  },
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
  ],
  followUps: [{ layout: SECOND, prompt: FOLLOW_UP }],
  kind: "chat",
  layout: FIRST,
  name: "group-layout-beside",
  prompt:
    "Quick one before we start: which side of the window are you on, and what's open beside you?",
};

export const GROUP_LAYOUT_EVALS = [besideIt];
