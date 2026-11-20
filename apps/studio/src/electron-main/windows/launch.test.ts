import { describe, expect, it } from "vitest";

import { createLaunch, type LaunchRequest } from "./launch";

// Electron hands requests over from the main module's first line, and boot
// restores the windows well after ready. Nothing handed over in between may
// open a window: one that did came up beside the restored ones, before the
// main process answered its page (a link that launched the app, 2026-11-20).
// Each test replays an order of events and reads what the launch did to the
// windows, in order.

function launch({ refused = false, newWindowOpens = true } = {}) {
  const did: string[] = [];
  const subject = createLaunch(
    {
      activate: () => did.push("activate"),
      comeForward: () => did.push("comeForward"),
      focusRefusal: () => did.push("focusRefusal"),
      log: () => {},
      openFiles: (paths) => did.push(`openFiles ${paths.join(" ")}`),
      openLink: (url) => did.push(`openLink ${url}`),
      openNewWindow: () => {
        did.push("openNewWindow");
        return newWindowOpens;
      },
      restoreWindows: ({ personAsked }) =>
        did.push(`restoreWindows personAsked=${String(personAsked)}`),
    },
    { refused },
  );
  return { did, launch: subject };
}

const link: LaunchRequest = {
  kind: "link",
  url: "instrument://files?path=a.html&path=b.html",
};
const secondLaunch = (
  over: Partial<Extract<LaunchRequest, { kind: "secondLaunch" }>> = {},
): LaunchRequest => ({
  files: [],
  kind: "secondLaunch",
  newWindow: false,
  url: undefined,
  ...over,
});

describe("createLaunch", () => {
  it("opens no window for a link that launches the app, and restores once", () => {
    const { did, launch: subject } = launch();
    subject.receive(link);
    // What the link names is shown through `showFromOutside`, which asks the
    // launch to bring a window forward before it queues the asks.
    subject.comeForward();
    expect(subject.windowsMayOpen()).toBe(false);

    subject.openWindows();
    expect(subject.windowsMayOpen()).toBe(true);
    expect(did).toMatchInlineSnapshot(`
      [
        "openLink instrument://files?path=a.html&path=b.html",
        "restoreWindows personAsked=true",
      ]
    `);
  });

  it("restores as the launch meant to when nobody asked for the app", () => {
    const { did, launch: subject } = launch();
    subject.receive({ kind: "activate" });
    subject.openWindows();
    expect(did).toEqual(["restoreWindows personAsked=false"]);
  });

  it.each<[string, LaunchRequest]>([
    ["coming forward", secondLaunch()],
    ["New Window", secondLaunch({ newWindow: true })],
  ])(
    "leaves a second launch's window to boot while booting (%s)",
    (_name, request) => {
      const { did, launch: subject } = launch();
      subject.receive(request);
      subject.openWindows();
      expect(did).toEqual(["restoreWindows personAsked=true"]);
    },
  );

  it("passes a booting second launch's link and files on to wait for the window", () => {
    const { did, launch: subject } = launch();
    subject.receive(
      secondLaunch({ files: ["/tmp/a.pdf"], url: "instrument://chats" }),
    );
    expect(did).toEqual([
      "openLink instrument://chats",
      "openFiles /tmp/a.pdf",
    ]);
  });

  it("opens a new window for the New Window task once the windows are open", () => {
    const { did, launch: subject } = launch();
    subject.openWindows();
    subject.receive(secondLaunch({ newWindow: true }));
    expect(did).toEqual(["restoreWindows personAsked=false", "openNewWindow"]);
  });

  it("comes forward where New Window cannot open one (setup is up)", () => {
    const { did, launch: subject } = launch({ newWindowOpens: false });
    subject.openWindows();
    subject.receive(secondLaunch({ newWindow: true }));
    expect(did).toEqual([
      "restoreWindows personAsked=false",
      "openNewWindow",
      "comeForward",
    ]);
  });

  it("brings a window forward and answers the Dock once the windows are open", () => {
    const { did, launch: subject } = launch();
    subject.openWindows();
    subject.receive(secondLaunch({ url: "instrument://chats" }));
    subject.receive({ kind: "activate" });
    expect(did).toEqual([
      "restoreWindows personAsked=false",
      "comeForward",
      "openLink instrument://chats",
      "activate",
    ]);
  });

  it("skips an empty hand-over of files", () => {
    const { did, launch: subject } = launch();
    subject.receive({ kind: "files", paths: [] });
    subject.receive({ kind: "files", paths: ["/tmp/a.pdf", "/tmp/b"] });
    expect(did).toEqual(["openFiles /tmp/a.pdf /tmp/b"]);
  });

  it("takes nothing on a refused workspace but brings its window forward for a second launch", () => {
    const { did, launch: subject } = launch({ refused: true });
    subject.receive(link);
    subject.receive({ kind: "files", paths: ["/tmp/a.pdf"] });
    subject.receive({ kind: "activate" });
    subject.receive(secondLaunch({ newWindow: true }));
    expect(subject.windowsMayOpen()).toBe(false);
    expect(did).toEqual(["focusRefusal"]);
    expect(() => {
      subject.openWindows();
    }).toThrow("refused");
  });

  it("opens the windows once", () => {
    const { launch: subject } = launch();
    subject.openWindows();
    expect(() => {
      subject.openWindows();
    }).toThrow("open");
  });
});
