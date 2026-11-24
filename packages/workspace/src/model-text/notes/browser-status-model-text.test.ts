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
      Pages in the user's tab group: t1 at https://mail.example.com/, 120 MB; t2 at https://music.example.com/, opened by an agent, out of sight and asleep, 310 MB, 7% CPU; t3 at https://example.com/, opened by an agent, out of sight, 80 MB (one process with t4).
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
      The user's tab group has no pages open now. The app closed a tab this chat's agents opened, t9 at https://example.com/old ("Old results"): the chat had more than 20 tabs its agents opened out of the user's sight, and the one hidden longest that the user never used closes first. Tabs the user used stay until someone closes them, so close the tabs you opened once you are done with them.
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
      The user's tab group has no pages open now. The app closed a tab this chat's agents opened that nobody was working in and the user never used, t2 at https://example.com/list ("Field guide"), as your last turn ended. Open the address again if the work needs it. Tabs the user used stay until someone closes them, so close the tabs you opened once you are done with them.
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

  it("names a tab whose page is unloaded, and says it comes back when used", () => {
    expect(
      browserStatusModelNote({
        status: "tabs",
        tabs: [
          { id: "t1", onScreen: true, url: "https://mail.example.com/" },
          {
            id: "t2",
            openedBy: "task",
            title: "Your Orders",
            unloaded: true,
            url: "https://shop.example.com/orders",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Pages in the user's tab group: t1 at https://mail.example.com/; t2 at https://shop.example.com/orders, opened by an agent, its page unloaded.
      </instrument-system-note>"
    `);
  });
});
