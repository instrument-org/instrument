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
      This chat's tabs, which the chat and each of its tasks all see and drive: t1 at https://mail.example.com/ ("Inbox"), on the user's screen, using 120 MB; t2 at https://music.example.com/ ("Play these"), opened by an agent, out of the user's sight and asleep, using 310 MB and 7% CPU, its page unloads in about 15 min unless used; t3 at https://example.com/, opened by an agent, out of the user's sight, using 80 MB (one process with t4), its page unloads in about 5 min unless used. \`agent-browser tab <id>\` switches to one. A tab asleep draws nothing and runs its timers slowly until a command reaches it, which wakes it with its page as it was. A page unloaded out of sight comes back from its address the next time the tab is used, without what was typed or scrolled in it.
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
      This chat has no tabs open now. The app closed a tab this chat's agents opened, t9 at https://example.com/old ("Old results"): the chat had more than 20 tabs its agents opened out of the user's sight, and the one hidden longest that the user never used closes first. Tabs the user used stay until someone closes them, so close the tabs you opened once you are done with them.
      </instrument-system-note>"
    `);
  });

  it("says which tabs closed with the last turn, apart from the cap's", () => {
    expect(
      browserStatusModelNote({
        closed: [
          {
            id: "t2",
            reason: "turnEnd",
            title: "Field guide",
            url: "https://example.com/list",
          },
        ],
        status: "tabs",
        tabs: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      This chat has no tabs open now. The app closed a tab this chat's agents opened that nobody was working in and the user never used, t2 at https://example.com/list ("Field guide"), as your last turn ended. Open the address again if the work needs it. Tabs the user used stay until someone closes them, so close the tabs you opened once you are done with them.
      </instrument-system-note>"
    `);
  });

  it("reads a picture stored before tabs had a standing", () => {
    expect(
      browserStatusModelNote({
        status: "tabs",
        tabs: [{ id: "t1", openedBy: "task", url: "https://example.com/" }],
      }),
    ).toContain("t1 at https://example.com/, opened by an agent.");
  });
});
