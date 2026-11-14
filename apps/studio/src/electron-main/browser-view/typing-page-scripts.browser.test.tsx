import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { ARM_SOURCE, FOCUSED_FRAME_OWNER } from "./typing-page-scripts";

// The guest runs these as source in an isolated world; here they run as source
// in the page's own world, which reads the same DOM and gets the same trusted
// events.
// oxlint-disable-next-line no-eval -- the scripts are source text by design
const run = (source: string): unknown => (0, eval)(source);

const arm = (mode: "key" | "text", last = "") =>
  run(
    `(${ARM_SOURCE})(${JSON.stringify(mode)}, ${JSON.stringify(last)}, 50, 1000)`,
  );

type Typing = {
  handled: () => Promise<string>;
  seen: () => number;
  stop: () => void;
};

function typing(): Typing {
  const state = (globalThis as { __instrumentTyping?: Typing })
    .__instrumentTyping;
  if (!state) {
    throw new Error("not armed");
  }
  return state;
}

async function frame(html: string, sandbox?: string) {
  const iframe = document.createElement("iframe");
  if (sandbox !== undefined) {
    iframe.setAttribute("sandbox", sandbox);
  }
  iframe.srcdoc = html;
  const loaded = new Promise((resolve) => {
    iframe.addEventListener("load", resolve, { once: true });
  });
  document.body.append(iframe);
  await loaded;
  return iframe;
}

function focus(selector: string, root: Document | ShadowRoot = document) {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`fixture missing ${selector}`);
  }
  el.focus();
  return el;
}

afterEach(() => {
  (globalThis as { __instrumentTyping?: Typing }).__instrumentTyping?.stop();
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.replaceChildren();
});

describe("the arm check", () => {
  it.each([
    ["nothing focused", `<input>`, undefined, "none"],
    ["a checkbox", `<input type="checkbox">`, "input", "none"],
    ["a read-only input", `<input readonly>`, "input", "none"],
    ["a button", `<button>Go</button>`, "button", "none"],
    ["a text input", `<input>`, "input", "armed"],
    ["an email input", `<input type="email">`, "input", "armed"],
    ["a textarea", `<textarea></textarea>`, "textarea", "armed"],
    ["a contenteditable", `<div contenteditable></div>`, "div", "armed"],
  ])("answers text for %s with %s", (_, html, selector, answer) => {
    document.body.innerHTML = html;
    if (selector) {
      focus(selector);
    }

    expect(arm("text")).toBe(answer);
  });

  it("arms keys with nothing focused, since a key goes to the page itself", () => {
    expect(arm("key", "keydown")).toBe("armed");
  });

  it("reaches a field inside an open shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div contenteditable></div>`;
    focus("div", shadow);

    expect(arm("text")).toBe("armed");
  });

  it("reaches a field in a same-origin frame and counts the text typed there", async () => {
    const iframe = await frame(`<textarea></textarea>`);
    focus("textarea", iframe.contentDocument!);

    expect(arm("text")).toBe("armed");
    expect(run(FOCUSED_FRAME_OWNER)).toBeNull();
    await userEvent.keyboard("hi");
    expect(typing().seen()).toBe(4);
  });

  it("answers frame for focus in a cross-origin frame, and names its owner", async () => {
    const iframe = await frame(`<textarea></textarea>`, "allow-scripts");
    iframe.focus();

    expect(arm("text")).toBe("frame");
    expect(arm("key", "keydown")).toBe("frame");
    expect(run(FOCUSED_FRAME_OWNER)).toBe(iframe);
  });

  it("names no frame owner when focus is in the page itself", () => {
    document.body.innerHTML = `<input>`;
    focus("input");

    expect(run(FOCUSED_FRAME_OWNER)).toBeNull();
  });
});

describe("what the page fires", () => {
  it("counts the trusted beforeinput and input of each character", async () => {
    document.body.innerHTML = `<input>`;
    focus("input");
    arm("text");

    await userEvent.keyboard("abc");

    expect(typing().seen()).toBe(6);
  });

  it("ignores events a page script dispatches", () => {
    document.body.innerHTML = `<input>`;
    const input = focus("input");
    arm("text");

    input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(typing().seen()).toBe(0);
  });

  it("stops the listeners of an earlier arm", async () => {
    document.body.innerHTML = `<input>`;
    focus("input");
    arm("text");
    const first = typing();
    arm("text");

    await userEvent.keyboard("a");

    expect(first.seen()).toBe(0);
    expect(typing().seen()).toBe(2);
  });

  it.each([
    ["a character's keypress", "a", "keypress", "keypress"],
    ["Enter's keypress", "{Enter}", "keypress", "keypress"],
    ["an arrow's keydown", "{ArrowLeft}", "keydown", "keydown"],
  ])(
    "answers a key once the page has handled %s",
    async (_, keys, last, how) => {
      document.body.innerHTML = `<textarea></textarea>`;
      focus("textarea");
      arm("key", last);

      await userEvent.keyboard(keys);

      await expect(typing().handled()).resolves.toBe(how);
    },
  );

  it("answers at the keydown when the page prevents the keypress", async () => {
    document.body.innerHTML = `<input>`;
    const input = focus("input");
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
    });
    arm("key", "keypress");

    await userEvent.keyboard("a");

    await expect(typing().handled()).resolves.toBe("keydown");
  });

  it("answers timeout when the key never reaches the page", async () => {
    document.body.innerHTML = `<input>`;
    focus("input");
    run(`(${ARM_SOURCE})("key", "keypress", 50, 100)`);

    await expect(typing().handled()).resolves.toBe("timeout");
  });
});
