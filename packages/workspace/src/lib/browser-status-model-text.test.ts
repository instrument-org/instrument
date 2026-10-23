import { describe, expect, it } from "vitest";

import { browserStatusModelNote } from "./browser-status-model-text";

describe("browserStatusModelNote", () => {
  it("says where each tab stands and what it costs", () => {
    expect(
      browserStatusModelNote({
        status: "tabs",
        tabs: [
          {
            id: "t1",
            memoryMb: 120,
            onScreen: true,
            openedBy: "handed",
            title: "Inbox",
            url: "https://mail.example.com/",
          },
          {
            asleep: true,
            cpuPercent: 7,
            id: "t2",
            memoryMb: 310,
            onScreen: false,
            openedBy: "task",
            title: "Play these",
            unloadsInMin: 15,
            url: "https://music.example.com/",
          },
          {
            id: "t3",
            memoryMb: 80,
            onScreen: false,
            openedBy: "task",
            sharedWith: ["t4"],
            unloadsInMin: 5,
            url: "https://example.com/",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your browser is these tabs of the user's chat, first one first: t1 at https://mail.example.com/ ("Inbox"), on the user's screen, using 120 MB, handed to you: it is the user's, so work in it and never close it; t2 at https://music.example.com/ ("Play these"), which you opened, out of the user's sight and asleep, using 310 MB and 7% CPU, its page unloads in about 15 min unless used; t3 at https://example.com/, which you opened, out of the user's sight, using 80 MB (one process with t4), its page unloads in about 5 min unless used. \`agent-browser\` starts on the first; \`agent-browser tab <id>\` switches to another, and \`agent-browser tab list\` shows them all. A tab asleep draws nothing and runs its timers slowly until a command reaches it, which wakes it with its page as it was. A page unloaded out of sight comes back from its address the next time the tab is used, without what was typed or scrolled in it.
      </instrument-system-note>"
    `);
  });

  it("says which tabs the app closed, and why", () => {
    expect(
      browserStatusModelNote({
        closed: [
          {
            id: "t9",
            reason: "tabCap",
            title: "Old results",
            url: "https://example.com/old",
          },
        ],
        status: "tabs",
        tabs: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your browser has no tabs of the user's chat now. The app closed a tab you opened, t9 at https://example.com/old ("Old results"): the chat had more than 20 tabs its agents opened out of the user's sight, and the one hidden longest closes first.
      </instrument-system-note>"
    `);
  });

  it("reads a picture stored before tabs had a standing", () => {
    expect(
      browserStatusModelNote({
        status: "tabs",
        tabs: [{ id: "t1", openedBy: "task", url: "https://example.com/" }],
      }),
    ).toContain("t1 at https://example.com/, which you opened.");
  });
});
