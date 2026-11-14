// Drives one drag in the app window with real mouse input, and reports what
// the window's drag said at each stop (`window.__studioDrive.drag()`), with
// screenshots and frame bursts on the way.
//
//   node $DRIVE run .agents/skills/studio-chrome-devtools/scripts/drag-drive.mjs \
//     --workspace documents --args @drag.json
//
// The args:
//
//   {
//     "from": { "selector": "[data-group-side='0'] [data-tab-key]", "nth": 1 },
//     "path": [
//       { "to": { "x": 700, "y": 400 }, "steps": 16, "rest": 600, "shot": "held" },
//       { "to": { "selector": "[data-group-row]", "nth": 2, "at": [0.5, 0.5] },
//         "burst": { "count": 6, "every": 50 } }
//     ],
//     "end": "release",            // or "escape", or "hold" to leave the button down
//     "after": "dropped",          // a shot once the release has settled
//     "out": "/abs/dir",           // where shots go
//     "prefix": "strip",           // each shot's file name starts with this
//     "watch": ["window:1"]        // other windows shot beside each shot
//   }
//
// A point is { x, y } in the window's px, or an element by { selector, nth }
// (the nth visible match, 0 first) at a fraction of its box (`at`, the
// middle when left out), moved by { dx, dy } when given. `steps` is how many
// moves the way there takes, `ms` how long between them (16), `rest` how
// long the pointer then stays still, `shot` a screenshot taken there, and
// `burst` a run of screenshots taken while the pointer moves there.
//
// Native drags (files from the Finder) cannot be made with mouse input; a
// file drop is `Input.dispatchDragEvent` with the paths, which `files` in
// place of `from` does: { "files": ["/abs/a.txt"], "path": [...] }. On a Mac
// the paths also go on the system's drag pasteboard, as a Finder drag puts
// them, which the app reads to name the files while they are held.
//
// A drag carried to another window shows there, so `watch` names other app
// windows (`window:<n>`, as `--page` does) that every shot also takes, as
// `<shot>-<window>`, with what each one's drag said. The drag itself runs in
// the window `--page` picks.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { connect } from "./studio-app.mjs";

const WRITE_DRAG_PASTEBOARD = `function run(paths) {
  ObjC.import("AppKit");
  const board = $.NSPasteboard.pasteboardWithName($.NSPasteboardNameDrag);
  board.clearContents;
  board.writeObjects($(paths.map((each) => $.NSURL.fileURLWithPath(each))));
}`;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Where a point is, in the window's px. */
async function pointOf(app, point) {
  if (point.x !== undefined && point.y !== undefined) {
    return { x: point.x + (point.dx ?? 0), y: point.y + (point.dy ?? 0) };
  }
  const [fx, fy] = point.at ?? [0.5, 0.5];
  const rect = await app.eval(`(() => {
    const shown = [...document.querySelectorAll(${JSON.stringify(point.selector)})].filter((each) => {
      const box = each.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && each.checkVisibility({ visibilityProperty: true });
    });
    const element = shown[${point.nth ?? 0}];
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { height: box.height, left: box.left, top: box.top, width: box.width };
  })()`);
  if (!rect) {
    throw new Error(
      `nothing shown matches ${point.selector} (#${point.nth ?? 0})`,
    );
  }
  return {
    x: Math.round(rect.left + rect.width * fx + (point.dx ?? 0)),
    y: Math.round(rect.top + rect.height * fy + (point.dy ?? 0)),
  };
}

const DRAG_STATE = `(() => {
  const drag = window.__studioDrive?.drag?.();
  if (!drag) return null;
  const { held, hints, input, isOff, landing } = drag;
  return { held, hints, input, isOff, landing };
})()`;

export default async (app, args) => {
  const out = args.out ?? process.cwd();
  mkdirSync(out, { recursive: true });
  const prefix = args.prefix ? `${args.prefix}-` : "";
  const fileOf = (name) => path.join(out, `${prefix}${name}.png`);
  const stops = [];
  const mouse = (type, { x, y }, extra = {}) =>
    app.cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });
  const watched = [];
  for (const page of args.watch ?? []) {
    watched.push({
      page,
      window: await connect({ page, port: app.port, workspace: app.workspace }),
    });
  }
  // A window's only tab carried into another window takes its window away
  // with it, and a page gone that way never answers; what it would have said
  // is left out.
  const unlessGone = (promise) =>
    Promise.race([
      promise.catch(() => undefined),
      sleep(5000).then(() => undefined),
    ]);
  /** Shoots the driven window and every watched one, and says what each one's drag was. */
  const shoot = async (name) => {
    await unlessGone(app.shot(fileOf(name)));
    const others = {};
    for (const { page, window } of watched) {
      const file = fileOf(`${name}-${page.replace(":", "-")}`);
      await unlessGone(window.shot(file));
      others[page] = await unlessGone(window.eval(DRAG_STATE));
    }
    return watched.length > 0 ? others : undefined;
  };

  let at;
  const isFiles = Array.isArray(args.files);
  const dragData = isFiles
    ? {
        dragOperationsMask: 1,
        files: args.files,
        items: [],
      }
    : undefined;
  if (isFiles) {
    if (process.platform === "darwin") {
      execFileSync("osascript", [
        "-l",
        "JavaScript",
        "-e",
        WRITE_DRAG_PASTEBOARD,
        ...args.files,
      ]);
    }
    at = await pointOf(app, args.path[0]?.to ?? { x: 10, y: 10 });
    await app.cdp.send("Input.dispatchDragEvent", {
      data: dragData,
      type: "dragEnter",
      x: at.x,
      y: at.y,
    });
  } else {
    at = await pointOf(app, args.from);
    await mouse("mouseMoved", at);
    await mouse("mousePressed", at, { button: "left", buttons: 1, clickCount: 1 });
  }

  for (const [index, leg] of (args.path ?? []).entries()) {
    const to = await pointOf(app, leg.to);
    const steps = leg.steps ?? 12;
    const burst = leg.burst;
    const shotsEvery = burst
      ? Math.max(1, Math.floor(steps / (burst.count ?? 6)))
      : 0;
    for (let step = 1; step <= steps; step++) {
      const point = {
        x: Math.round(at.x + ((to.x - at.x) * step) / steps),
        y: Math.round(at.y + ((to.y - at.y) * step) / steps),
      };
      if (isFiles) {
        await app.cdp.send("Input.dispatchDragEvent", {
          data: dragData,
          type: "dragOver",
          x: point.x,
          y: point.y,
        });
      } else {
        await mouse("mouseMoved", point, { button: "left", buttons: 1 });
      }
      await sleep(leg.ms ?? 16);
      if (burst && step % shotsEvery === 0) {
        await app.shot(fileOf(`${leg.name ?? index}-frame-${String(step).padStart(2, "0")}`));
      }
    }
    at = to;
    if (leg.rest) {
      // A drag the system holds is heard of only as it moves, so a rest is
      // the same point told again, as the system does several times a second.
      if (isFiles) {
        for (let waited = 0; waited < leg.rest; waited += 100) {
          await app.cdp.send("Input.dispatchDragEvent", {
            data: dragData,
            type: "dragOver",
            x: at.x,
            y: at.y,
          });
          await sleep(100);
        }
      } else {
        await sleep(leg.rest);
      }
    }
    // Two frames for what the stop draws.
    await sleep(40);
    const drag = await app.eval(DRAG_STATE);
    const others = leg.shot ? await shoot(leg.shot) : undefined;
    stops.push({ at, drag, leg: leg.name ?? index, others });
  }

  const end = args.end ?? "release";
  if (end === "escape") {
    await app.press("Escape");
  } else if (end === "release") {
    if (isFiles) {
      await app.cdp.send("Input.dispatchDragEvent", {
        data: dragData,
        type: "drop",
        x: at.x,
        y: at.y,
      });
    } else {
      await mouse("mouseReleased", at, { button: "left", buttons: 0, clickCount: 1 });
    }
  }
  await sleep(args.settle ?? 500);
  const result = {
    afterDrag: await unlessGone(app.eval(DRAG_STATE)),
    after: args.after ? await shoot(args.after) : undefined,
    state: await unlessGone(app.eval(`window.__studioDrive.state()`)),
    stops,
  };
  for (const { window } of watched) {
    window.close();
  }
  return result;
};
