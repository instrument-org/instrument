// The sequence half of `tabs:drive` (tab-drive.ts), run inside a booted
// instance by `studio-drive run`: random sequences of menu commands against
// the real window, each followed by what must be true on screen.
//
// Steps are named after the model's actions in tab-sequences.ts and checked
// against its rules where one says the same thing; the rest are rules only a
// running window can break (what the strip and panes show, page errors).

import fc from "fast-check";
import fs from "node:fs";
import { z } from "zod";

const J = JSON.stringify;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What `studio-drive run` hands a sequence, as far as this one uses it. */
type App = {
  eval: (source: string) => Promise<unknown>;
  press: (key: string) => Promise<unknown>;
  type: (text: string) => Promise<unknown>;
};
type Args = {
  inspect: string;
  replay?: string[];
  seconds: number;
  seed: number;
  /** A file each step is appended to, so a run that stops says where. */
  progress?: string;
  site: string;
};
type Broken = { detail: string; rule: string }[];

const LookSchema = z.object({
  errors: z.array(z.string()),
  focused: z.number(),
  g: z.string().optional(),
  groups: z.number(),
  ids: z.array(z.string()),
  panes: z.array(z.string().nullable()),
  sides: z.array(
    z.object({ tabs: z.array(z.string()), up: z.string().optional() }),
  ),
  strips: z.array(
    z.array(z.object({ k: z.string().nullable(), on: z.boolean() })),
  ),
  want: z.object({
    panes: z.array(z.string().nullable().optional()),
    strips: z.array(z.array(z.object({ k: z.string(), on: z.boolean() }))),
  }),
});
type Look = z.output<typeof LookSchema>;

// The inspector socket is closed however the run ends: one left open keeps
// studio-drive's process alive after a failed step.
export default async (app: App, args: Args) => {
  let socket: WebSocket | undefined;
  try {
    return await drive(app, args, (opened) => {
      socket = opened;
    });
  } finally {
    socket?.close();
  }
};

async function drive(
  app: App,
  args: Args,
  opened: (socket: WebSocket) => void,
) {
  const [target] = z
    .array(z.object({ webSocketDebuggerUrl: z.string() }))
    .parse(await (await fetch(`http://127.0.0.1:${args.inspect}/json`)).json());
  if (!target) {
    throw new Error(`nothing to inspect on port ${args.inspect}`);
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  opened(socket);
  await new Promise((resolve) => {
    socket.onopen = resolve;
  });
  let nextId = 0;
  const MessageSchema = z.object({
    id: z.number().optional(),
    result: z
      .object({ result: z.object({ value: z.unknown() }).optional() })
      .optional(),
  });
  const waiting = new Map<number, (value: unknown) => void>();
  socket.onmessage = (event: MessageEvent<string>) => {
    const message = MessageSchema.parse(JSON.parse(event.data));
    if (message.id !== undefined) {
      waiting.get(message.id)?.(message.result?.result?.value);
      waiting.delete(message.id);
    }
  };
  const inMain = (expression: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(
          new Error(
            `the main process did not answer: ${expression.slice(0, 120)}`,
          ),
        );
      }, 10_000);
      waiting.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      socket.send(
        J({
          id,
          method: "Runtime.evaluate",
          params: {
            expression,
            includeCommandLineAPI: true,
            returnByValue: true,
          },
        }),
      );
    });

  // A menu item clicked as the app menu would, for the first window, whether
  // or not it has focus (an instance booted for a run is never in front).
  const menu = (label: string) =>
    inMain(`(() => {
      const { Menu, BrowserWindow } = process.mainModule ? process.mainModule.require("electron") : require("electron");
      const find = (m) => { for (const i of m.items) { if (i.label === ${J(label)}) return i; if (i.submenu) { const f = find(i.submenu); if (f) return f; } } };
      const item = find(Menu.getApplicationMenu());
      if (!item) return "none";
      if (!item.enabled) return "off";
      const w = BrowserWindow.getAllWindows()[0];
      const focused = BrowserWindow.getFocusedWindow;
      BrowserWindow.getFocusedWindow = () => w;
      try { item.click({}, w, w.webContents); } finally { BrowserWindow.getFocusedWindow = focused; }
      return "ok";
    })()`);

  await app.eval(`(() => {
    window.__tabDrive = { errors: [] };
    addEventListener("error", (e) => __tabDrive.errors.push(e.message));
    addEventListener("unhandledrejection", (e) => __tabDrive.errors.push(String(e.reason)));
    return 1;
  })()`);

  // The group on screen as state has it and as the window draws it. Pages
  // are named by their `?x=` tag, so `p12` is the twelfth page opened.
  const look = async (): Promise<Look> =>
    LookSchema.parse(
      JSON.parse(
        z.string().parse(
          await app.eval(`(() => {
        const { errors } = __tabDrive;
        const { group: g, layout = { focused: 0, sides: [] }, tabs: s } = __studioDrive.windowTabs();
        const name = (t) => (t.kind === "page" ? (t.url || "").replace(/^.*\\?x=/, "p") : (t.href || "").slice(0, 30));
        const byId = (id) => { const t = s.tabs.find((each) => each.id === id); return t && name(t); };
        const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
        const strips = [...document.querySelectorAll("[data-group-tabs]")].filter(visible).map((e) =>
          [...e.querySelectorAll("[data-tab-key]")].filter(visible).map((k) => ({
            k: k.getAttribute("data-tab-key"),
            on: k.matches("[aria-selected=true]") || !!k.querySelector("[aria-selected=true]"),
          })));
        const panes = [...document.querySelectorAll("[data-tab-up]")].filter(visible).map((e) => e.getAttribute("data-tab-up"));
        const key = (t) => t.stripKey ?? t.id;
        return JSON.stringify({
          g,
          groups: new Set(s.tabs.map((t) => t.group).filter((x) => x && !x.startsWith("page:"))).size,
          focused: layout.focused,
          sides: layout.sides.map((x) => ({ tabs: x.tabs.map(name), up: byId(x.up) })),
          want: {
            strips: layout.sides.map((x) => x.tabs.map((t) => ({ k: key(t), on: t.id === x.up }))),
            panes: layout.sides.map((x) => x.up),
          },
          strips,
          panes,
          ids: s.tabs.map((t) => t.id),
          errors: errors.splice(0),
        });
      })()`),
        ),
      ),
    );
  // Read until nothing has changed for a moment, or three seconds pass.
  const settle = async (): Promise<Look> => {
    let was = "";
    let since = Date.now();
    const start = since;
    for (;;) {
      const latest = await look();
      const now = J(latest);
      if (now !== was) {
        was = now;
        since = Date.now();
      }
      if (Date.now() - since > 160 || Date.now() - start > 3000) {
        return latest;
      }
      await sleep(25);
    }
  };

  let page = Date.now() % 1e6;
  const seen = (l: Look) => ({ focused: l.focused, sides: l.sides });
  // Types the next page's address into the focused address field.
  const go = async () => {
    page++;
    await sleep(60);
    await app.type(`${args.site}?x=${page}`);
    await app.press("Enter");
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const l = await look();
      if (l.sides.some((s) => s.tabs.includes(`p${page}`))) {
        return settle();
      }
      await sleep(40);
    }
    return settle();
  };
  const broke = (rule: string, detail: string): Broken => [{ detail, rule }];
  const was = (b: Look, l: Look) => `${J(seen(b))} -> ${J(seen(l))}`;
  const tabsOf = (l: Look) => l.sides.flatMap((s) => s.tabs);

  // Each step returns undefined when it does not apply to what is on screen,
  // else the rules it broke.
  const STEPS: Record<string, (before: Look) => Promise<Broken | undefined>> = {
    newTab: async () => {
      if ((await menu("New Tab")) !== "ok") return undefined;
      await settle();
      const l = await go();
      return l.sides[l.focused]?.up === `p${page}`
        ? []
        : broke("frontComesUp", `p${page} in ${J(seen(l))}`);
    },
    split: async (b) => {
      if (b.sides.length > 1 || (await menu("New Tab in Split")) !== "ok")
        return undefined;
      await settle();
      const l = await go();
      return l.sides.length === 2 && l.sides[l.focused]?.up === `p${page}`
        ? []
        : broke("splitOpens", J(seen(l)));
    },
    next: async () => ((await menu("Show Next Tab")) === "ok" ? [] : undefined),
    focusLeft: async (b) => {
      if (b.sides.length < 2 || (await menu("Focus Left Side")) !== "ok")
        return undefined;
      const l = await settle();
      return J(seen(l)) === J({ ...seen(b), focused: 0 })
        ? []
        : broke("focusSide", was(b, l));
    },
    focusRight: async (b) => {
      if (b.sides.length < 2 || (await menu("Focus Right Side")) !== "ok")
        return undefined;
      const l = await settle();
      return J(seen(l)) === J({ ...seen(b), focused: 1 })
        ? []
        : broke("focusSide", was(b, l));
    },
    close: async (b) => {
      if (tabsOf(b).length < 2) return undefined;
      const up = b.sides[b.focused]?.up;
      if ((await menu("Close Tab")) !== "ok") return undefined;
      const l = await settle();
      const want = b.sides
        .map((s, i) => s.tabs.filter((x) => i !== b.focused || x !== up))
        .filter((x) => x.length);
      return J(l.sides.map((s) => s.tabs)) === J(want)
        ? []
        : broke("closeKeepsRest", was(b, l));
    },
    closeReopen: async (b) => {
      const up = b.sides[b.focused]?.up ?? "";
      if (tabsOf(b).length < 2 || !up.startsWith("p")) return undefined;
      if ((await menu("Close Tab")) !== "ok") return undefined;
      await settle();
      await menu("Reopen Closed Tab");
      await sleep(100);
      const l = await settle();
      return J(seen(l)) === J(seen(b)) ? [] : broke("reopenTab", was(b, l));
    },
    backForward: async (b) => {
      const up = b.sides[b.focused]?.up ?? "";
      if (!up.startsWith("p") || (await menu("Back")) !== "ok")
        return undefined;
      await settle();
      if ((await menu("Forward")) !== "ok") return [];
      await sleep(300);
      const l = await settle();
      return J(seen(l)) === J(seen(b))
        ? []
        : broke("backThenForward", was(b, l));
    },
    closeSide: async (b) => {
      if (b.sides.length < 2 || (await menu("Close Split")) !== "ok")
        return undefined;
      const l = await settle();
      const other = b.sides[1 - b.focused];
      return J(l.sides) === J([other])
        ? []
        : broke("closeSplitKeepsOther", was(b, l));
    },
    sideReopen: async (b) => {
      if (b.sides.length < 2 || (await menu("Close Split")) !== "ok")
        return undefined;
      await settle();
      await menu("Reopen Closed Tab");
      await sleep(100);
      const l = await settle();
      return J(l.sides) === J(b.sides) ? [] : broke("reopenSide", was(b, l));
    },
    groupAndBack: async (b) => {
      if (b.groups < 2 || (await menu("Next Tab Group")) !== "ok")
        return undefined;
      await settle();
      await menu("Previous Tab Group");
      const l = await settle();
      return J(seen(l)) === J(seen(b)) ? [] : broke("groupAndBack", was(b, l));
    },
  };

  // What must hold after every step, whatever the step was.
  const always = (l: Look) => {
    const bad: Broken = [];
    if (new Set(l.ids).size !== l.ids.length)
      bad.push({ detail: J(l.ids), rule: "unique" });
    if (l.errors.length) bad.push({ detail: J(l.errors), rule: "noErrors" });
    // A side with one tab draws no strip.
    const strips = l.strips.filter((s) => s.length > 1);
    const want = l.want.strips.filter((s) => s.length > 1);
    if (J(strips) !== J(want))
      bad.push({
        detail: `${J(strips)} want ${J(want)}`,
        rule: "stripShowsTabs",
      });
    if (J(l.panes.toSorted()) !== J(l.want.panes.filter(Boolean).toSorted())) {
      bad.push({
        detail: `${J(l.panes)} want ${J(l.want.panes)}`,
        rule: "panesShowUp",
      });
    }
    return bad;
  };

  // A sequence's first page, opened through the window's own open: a new
  // group's screen has the keyboard in a box only some of the time, and an
  // address typed with nothing focused opens the keyboard shortcuts with its
  // `?`, which hold the window so every step after it does nothing.
  const openFirst = async () => {
    page++;
    const end = Date.now() + 4000;
    while (
      !(await app.eval(
        `__studioDrive.openPage(${J(`${args.site}?x=${page}`)})`,
      ))
    ) {
      if (Date.now() > end)
        throw new Error("the window never took the first page");
      await sleep(40);
    }
    while (Date.now() < end) {
      const l = await look();
      if (l.sides.some((s) => s.tabs.includes(`p${page}`))) {
        return settle();
      }
      await sleep(40);
    }
    throw new Error(
      `the first page of a sequence never opened: ${J(seen(await look()))}`,
    );
  };

  let sequences = 0;
  let steps = 0;
  // Each sequence starts in a new group with one page, and closes what it
  // made afterward so the next starts the same way.
  const play = async (names: string[]) => {
    sequences++;
    const groupBefore = (await look()).g;
    // Opened before the new group is on screen, the page joins the old one.
    // Right after a launch the window can miss the first menu command, so it
    // is asked again; a third miss is a finding of its own.
    for (let asked = 1; ; asked++) {
      const result = await menu("New Tab Group");
      const shown = Date.now() + 1500;
      while ((await look()).g === groupBefore && Date.now() < shown)
        await sleep(40);
      if ((await look()).g !== groupBefore) break;
      if (asked === 3)
        throw new Error(
          `New Tab Group put no new group on screen (menu: ${String(result)})`,
        );
    }
    await settle();
    await openFirst();
    const story: string[] = [];
    let bad: Broken = [];
    for (const name of names) {
      const before = await settle();
      const step = STEPS[name];
      if (!step) continue;
      const broken = await step(before);
      if (broken === undefined) continue;
      steps++;
      const after = await settle();
      if (args.progress) {
        fs.appendFileSync(
          args.progress,
          `${String(sequences)} ${name} ${J(seen(after))}\n`,
        );
      }
      bad = [...broken, ...always(after)];
      story.push(`${name} ${J(seen(after))}`);
      if (bad.length) break;
    }
    for (let i = 0; i < 12; i++) {
      const l = await look();
      if (l.groups <= 2 && tabsOf(l).length <= 1) break;
      await menu(l.sides.length > 1 ? "Close Split" : "Close Tab");
      await sleep(60);
      if ((await settle()).g !== l.g) break;
    }
    return { bad, story };
  };

  const started = Date.now();
  const report = (extra: { found: Record<string, unknown> }) => {
    socket.close();
    return {
      ...extra,
      seconds: Math.round((Date.now() - started) / 1000),
      sequences,
      steps,
    };
  };
  if (args.replay) {
    const names = args.replay.filter((name) => name in STEPS);
    const played = await play(names);
    const [first] = played.bad;
    return report({
      found: first ? { [first.rule]: { ...played, names } } : {},
    });
  }

  // One finding per rule. Shrunk by dropping one step at a time while the
  // same rule still breaks, then played once more to say whether it repeats.
  const found: Record<string, unknown> = {};
  const until = Date.now() + args.seconds * 1000;
  let seed = args.seed;
  while (Date.now() < until && Object.keys(found).length < 3) {
    const names =
      fc.sample(
        fc.array(fc.constantFrom(...Object.keys(STEPS)), {
          maxLength: 9,
          minLength: 4,
        }),
        { numRuns: 1, seed },
      )[0] ?? [];
    const first = await play(names);
    const rule = first.bad[0]?.rule;
    if (rule && !found[rule]) {
      let shortest = names;
      let last = first;
      for (
        let i = shortest.length - 1;
        i >= 0 && Date.now() < until + 60_000;
        i--
      ) {
        const fewer = shortest.filter((_, k) => k !== i);
        const tried = await play(fewer);
        if (tried.bad[0]?.rule === rule) {
          shortest = fewer;
          last = tried;
        }
      }
      const again = await play(shortest);
      found[rule] = {
        ...last,
        names: shortest,
        repeats: again.bad[0]?.rule === rule,
        seed,
      };
    }
    seed++;
  }
  return report({ found });
}
