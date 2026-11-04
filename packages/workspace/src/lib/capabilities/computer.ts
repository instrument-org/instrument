import { DefenseInDepthBox } from "just-bash";
import fs from "node:fs/promises";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { sleep } from "radashi";
import { z } from "zod";

import { getScreenshotsDir } from "../chat-dir-utils";
import { runDriver, showCursor } from "../computer/driver";
import {
  appOfRef,
  gatedRunningApp,
  openableApp,
  openableAppGate,
  refGate,
  rememberSnapshot,
  runningAppGate,
  isOffLimits,
  runningApps,
  setUpGate,
  windowLine,
  windowsOf,
  windowTarget,
} from "../computer/targets";
import { SnapshotDataSchema, treeText } from "../computer/tree-text";
import { getCurrentDate } from "../get-current-date";
import { appLevel } from "../permissions/apps";
import { COMPUTER_COMMAND } from "../shell-commands/computer-command";
import { workDir } from "../work-dir";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../shell-path";
import {
  type CapabilityContext,
  CapabilityFailure,
  defineCapability,
  type Where,
} from "./define";

const NAME = COMPUTER_COMMAND.name;

const WHERE: Where = {
  // The bash worker builds these commands only to send the call to the main
  // thread, which holds the host and answers for real.
  available: () =>
    !isMainThread || getWorkspaceConfig().computerUse?.isEnabled() === true,
};

const AppName = (verb: string) =>
  z
    .string({
      error: `${verb}: which app? ${NAME} apps lists the running ones.`,
    })
    .trim()
    .min(1)
    .meta({ description: "The app, by its name or bundle id." });

const Ref = z
  .string({ error: "which element? Take a snapshot and use one of its refs." })
  .regex(
    /^@[^:\s]+:e\d+$/,
    "a ref looks like @s8f3k2p9:e4, whole, from a snapshot.",
  )
  .meta({ description: "An element's ref from a snapshot." });

const WindowId = z
  .string()
  .regex(/^w-\d+$/, `a window looks like w-123, from ${NAME} windows.`)
  .optional()
  .meta({
    description: `A window from ${NAME} windows, where it has several.`,
  });

const Headed = z.boolean().optional().meta({
  description:
    "Take the person's pointer and focus, once they've said that's fine.",
});

/** What the driver reports of an action, without its step-by-step account. */
const ActionData = z.looseObject({
  disposition: z.object({ delivery: z.string().optional() }).optional(),
  surfaces: z.unknown().optional(),
});
type ActionOutput = z.output<typeof ActionData>;

function actionText(output: ActionOutput): string {
  const delivery = output.disposition?.delivery;
  const said =
    delivery === undefined
      ? "Done."
      : `Done (${delivery.replaceAll("_", " ")}).`;
  return output.surfaces === undefined
    ? said
    : `${said} It opened: ${JSON.stringify(output.surfaces)}`;
}

const AppsOutput = z.array(
  z.object({
    access: z.enum(["allowed", "ask first", "not allowed"]),
    bundle_id: z.string().optional(),
    name: z.string(),
  }),
);

const ACCESS = {
  allow: "allowed",
  ask: "ask first",
  never: "not allowed",
} as const;

const computerApps = defineCapability({
  gate: () => setUpGate(),
  input: z.object({
    all: z.boolean().optional().meta({
      description: "Include menu bar apps and other apps with no window.",
    }),
  }),
  name: "computer.apps",
  output: AppsOutput,
  async run({ all }, ctx) {
    const running = await runningApps(ctx);
    return Promise.all(
      running
        .filter((app) =>
          all === true
            ? app.presentation !== undefined
            : app.presentation === "foreground",
        )
        .filter((app) => !isOffLimits(app))
        .map(async (app) => ({
          access:
            ACCESS[
              await appLevel(ctx.chatId, {
                bundleId: app.bundle_id ?? app.name,
                name: app.name,
              })
            ],
          ...(app.bundle_id === undefined ? {} : { bundle_id: app.bundle_id }),
          name: app.name,
        })),
    );
  },
  summary: "The running apps, and what this chat may do with each.",
  surfaces: {
    cli: {
      help: "  What's running with a window, and whether each app is allowed in this chat, asks first or isn't allowed.",
      words: ["computer", "apps"],
    },
  },
  text: (apps) =>
    apps.length === 0
      ? "No apps with a window are running. --all includes the ones without."
      : apps
          .map(
            (app) => `${app.name} (${app.bundle_id ?? "no id"}): ${app.access}`,
          )
          .join("\n"),
  where: WHERE,
});

const computerWindows = defineCapability({
  gate: ({ app }, ctx) => runningAppGate(app, ctx),
  input: z.object({ app: AppName("windows") }),
  name: "computer.windows",
  output: z.array(z.object({ line: z.string() })),
  async run({ app }, ctx) {
    const gated = await gatedRunningApp(app, ctx);
    const windows = await windowsOf(gated, ctx);
    return windows.map((window) => ({ line: windowLine(window) }));
  },
  summary: "An allowed app's windows.",
  surfaces: {
    cli: {
      help: "  An allowed app's windows, each with its id.",
      positional: ["app"],
      words: ["computer", "windows"],
    },
  },
  text: (windows) =>
    windows.length === 0
      ? "It has no windows."
      : windows.map((window) => window.line).join("\n"),
  where: WHERE,
});

/** How often, and how many times, `open` looks for a new app's window. */
const WINDOW_CHECK_MS = 500;
const WINDOW_CHECKS = 4;

const LaunchData = z.looseObject({
  window: z.object({ id: z.string(), title: z.string().optional() }).optional(),
});

const computerOpen = defineCapability({
  gate: ({ app }, ctx) => openableAppGate(app, ctx),
  input: z.object({
    app: AppName("open"),
    headed: Headed,
  }),
  name: "computer.open",
  output: LaunchData,
  async run({ app, headed }, ctx) {
    const found = await openableApp(app, ctx);
    if (found === undefined) {
      throw new CapabilityFailure(`no app called ${app} is on this computer.`);
    }
    const data = await runDriver(
      ["launch", found.bundleId, ...(headed === true ? ["--activate"] : [])],
      ctx,
    );
    const launched = LaunchData.parse(data);
    if (launched.window !== undefined || headed === true) {
      return launched;
    }
    // The driver answers once the process runs, and the window follows a moment
    // later. Saying there's none would send the agent to --headed, which takes
    // the person's focus, for a window that was about to show up.
    for (let tried = 0; tried < WINDOW_CHECKS; tried++) {
      await DefenseInDepthBox.runTrustedAsync(() => sleep(WINDOW_CHECK_MS));
      const [window] = await windowsOf(found, ctx);
      if (window !== undefined) {
        return { ...launched, window };
      }
    }
    return launched;
  },
  summary: "Starts an allowed app.",
  surfaces: {
    cli: {
      help: "  Starts an allowed app, or finds it already running, and leaves the person's focus where it is.",
      positional: ["app"],
      words: ["computer", "open"],
    },
  },
  text: ({ window }) =>
    window === undefined
      ? "It's running, with no window yet. --headed brings it forward and waits for one, so pass it only once the person has said that's fine."
      : `It's running, with window ${window.id} ${JSON.stringify(window.title ?? "")}.`,
  where: WHERE,
});

/** How long a snapshot may walk a window, which Chess's board takes seconds to. */
const SNAPSHOT_DEADLINE_MS = 10_000;

/** How long `--wait-for` waits for what it names. */
const WAIT_MS = 15_000;

const computerSnapshot = defineCapability({
  gate: ({ app, root }, ctx) =>
    root === undefined ? runningAppGate(app ?? "", ctx) : refGate(root, ctx),
  input: z.object({
    all: z.boolean().optional().meta({
      description: "Include the text between controls, not only the controls.",
    }),
    app: AppName("snapshot").optional(),
    root: Ref.optional().meta({
      description: "Read only inside this element, from an earlier snapshot.",
    }),
    skeleton: z.boolean().optional().meta({
      description: "A shallow map of a big window, to drill into with --root.",
    }),
    surface: z
      .enum(["menu", "menubar", "sheet", "popover", "alert"])
      .optional()
      .meta({ description: "Read what's open over the window instead of it." }),
    wait_for: z.string().optional().meta({
      description: "Wait until an element like button:Save shows up first.",
    }),
    window: WindowId,
  }),
  name: "computer.snapshot",
  output: SnapshotDataSchema,
  async run({ all, app, root, skeleton, surface, wait_for, window }, ctx) {
    const rooted = root === undefined ? undefined : appOfRef(ctx.chatId, root);
    const target = rooted ?? (await gatedRunningApp(app ?? "", ctx));
    const data = SnapshotDataSchema.parse(
      await runDriver(
        [
          "snapshot",
          ...(root === undefined
            ? await windowTarget(target, window, ctx)
            : ["--root", root]),
          "--compact",
          "--timeout-ms",
          String(SNAPSHOT_DEADLINE_MS),
          ...(all === true ? [] : ["-i"]),
          ...(skeleton === true ? ["--skeleton"] : []),
          ...(surface === undefined ? [] : ["--surface", surface]),
          ...(wait_for === undefined
            ? []
            : ["--wait-for", wait_for, "--wait-timeout", String(WAIT_MS)]),
        ],
        ctx,
      ),
    );
    rememberSnapshot(ctx.chatId, data.snapshot_id, target);
    return data;
  },
  summary: "An allowed app's window as a tree of elements with refs.",
  surfaces: {
    cli: {
      flagNames: { wait_for: "wait-for" },
      help: "  An allowed app's window as a tree of elements, each with a ref to act on. A big window reads better as --skeleton, then --root on a part of it.",
      positional: ["app"],
      words: ["computer", "snapshot"],
    },
  },
  text: ({ complete, tree, window }) =>
    [
      window === undefined ? undefined : `Window ${window.id}`,
      tree === undefined ? "Nothing to show." : treeText(tree),
      complete === false
        ? "This is only part of the window: it didn't finish in time."
        : undefined,
    ]
      .filter((part) => part !== undefined)
      .join("\n"),
  where: WHERE,
});

const computerGet = defineCapability({
  gate: ({ ref }, ctx) => refGate(ref, ctx),
  input: z.object({
    property: z
      .enum(["text", "value", "title", "bounds", "role", "states"])
      .optional()
      .meta({ description: "What to read; text unless you say." }),
    ref: Ref,
  }),
  name: "computer.get",
  output: z.unknown(),
  run: ({ property, ref }, ctx) =>
    runDriver(["get", ref, "--property", property ?? "text"], ctx),
  summary: "Reads one element's text, value or state.",
  surfaces: {
    cli: {
      help: "  Reads one element's text, value or state, whole.",
      positional: ["ref"],
      words: ["computer", "get"],
    },
  },
  text: (output) => {
    const parsed = z.looseObject({ value: z.unknown() }).safeParse(output);
    const value = parsed.success ? parsed.data.value : output;
    return typeof value === "string" ? value : JSON.stringify(value);
  },
  where: WHERE,
});

/** A ref action as the registry holds it, one per word the driver has for it. */
function refAction({ summary, word }: { summary: string; word: string }) {
  return defineCapability({
    gate: ({ ref }, ctx) => refGate(ref, ctx),
    input: z.object({ headed: Headed, ref: Ref }),
    name: `computer.${word.replaceAll("-", "_")}`,
    output: ActionData,
    async run({ headed, ref }, ctx) {
      return act([word, ref], headed, ctx);
    },
    summary,
    surfaces: {
      cli: {
        help: `  ${summary}`,
        positional: ["ref"],
        words: ["computer", word],
      },
    },
    text: actionText,
    where: WHERE,
  });
}

async function act(
  args: readonly string[],
  headed: boolean | undefined,
  ctx: CapabilityContext,
): Promise<ActionOutput> {
  await showCursor(ctx);
  return ActionData.parse(
    await runDriver([...args, ...(headed === true ? ["--headed"] : [])], ctx),
  );
}

const computerClick = refAction({
  summary: "Presses a button, row or link.",
  word: "click",
});
const computerDoubleClick = refAction({
  summary: "Double-clicks an element, which needs --headed.",
  word: "double-click",
});
const computerRightClick = refAction({
  summary: "Opens an element's context menu.",
  word: "right-click",
});
const computerClear = refAction({
  summary: "Empties a field.",
  word: "clear",
});
const computerFocus = refAction({
  summary: "Puts the app's own focus on an element.",
  word: "focus",
});
const computerToggle = refAction({
  summary: "Flips a switch or checkbox.",
  word: "toggle",
});
const computerCheck = refAction({
  summary: "Turns a checkbox on.",
  word: "check",
});
const computerUncheck = refAction({
  summary: "Turns a checkbox off.",
  word: "uncheck",
});
const computerExpand = refAction({
  summary: "Opens a disclosure or tree row.",
  word: "expand",
});
const computerCollapse = refAction({
  summary: "Closes a disclosure or tree row.",
  word: "collapse",
});
const computerScrollTo = refAction({
  summary: "Scrolls an element into view.",
  word: "scroll-to",
});
const computerHover = refAction({
  summary: "Rests the pointer on an element, which needs --headed.",
  word: "hover",
});

const computerType = defineCapability({
  gate: ({ ref }, ctx) => refGate(ref, ctx),
  input: z.object({
    headed: Headed,
    ref: Ref,
    text: z.string({ error: "type: what text?" }).meta({
      description: "What to type, from the words after the ref or stdin.",
    }),
  }),
  name: "computer.type",
  output: ActionData,
  run: ({ headed, ref, text }, ctx) => act(["type", ref, text], headed, ctx),
  summary: "Types into a field at its cursor.",
  surfaces: {
    cli: {
      help: "  Types into a field at its cursor.",
      positional: ["ref", "text"],
      rest: true,
      stdin: "text",
      words: ["computer", "type"],
    },
  },
  text: actionText,
  where: WHERE,
});

const computerSetValue = defineCapability({
  gate: ({ ref }, ctx) => refGate(ref, ctx),
  input: z.object({
    ref: Ref,
    value: z.string({ error: "set-value: what value?" }).meta({
      description: "The field's whole new value.",
    }),
  }),
  name: "computer.set_value",
  output: ActionData,
  run: ({ ref, value }, ctx) => act(["set-value", ref, value], false, ctx),
  summary: "Replaces a field's or slider's whole value.",
  surfaces: {
    cli: {
      help: "  Replaces a field's or slider's whole value.",
      positional: ["ref", "value"],
      rest: true,
      words: ["computer", "set-value"],
    },
  },
  text: actionText,
  where: WHERE,
});

const computerSelect = defineCapability({
  gate: ({ ref }, ctx) => refGate(ref, ctx),
  input: z.object({
    option: z.string({ error: "select: which option?" }).meta({
      description: "The option's name as the menu shows it.",
    }),
    ref: Ref,
  }),
  name: "computer.select",
  output: ActionData,
  run: ({ option, ref }, ctx) => act(["select", ref, option], false, ctx),
  summary: "Picks an option in a list or pop-up menu.",
  surfaces: {
    cli: {
      help: "  Picks an option in a list or pop-up menu.",
      positional: ["ref", "option"],
      rest: true,
      words: ["computer", "select"],
    },
  },
  text: actionText,
  where: WHERE,
});

const computerScroll = defineCapability({
  gate: ({ ref }, ctx) => refGate(ref, ctx),
  input: z.object({
    amount: z.number().int().positive().optional().meta({
      description: "How far, in scroll units; 3 unless you say.",
    }),
    direction: z.enum(["up", "down", "left", "right"]).optional().meta({
      description: "Which way; down unless you say.",
    }),
    headed: Headed,
    ref: Ref,
  }),
  name: "computer.scroll",
  output: ActionData,
  run: ({ amount, direction, headed, ref }, ctx) =>
    act(
      [
        "scroll",
        ref,
        ...(direction === undefined ? [] : ["--direction", direction]),
        ...(amount === undefined ? [] : ["--amount", String(amount)]),
      ],
      headed,
      ctx,
    ),
  summary: "Scrolls inside an element.",
  surfaces: {
    cli: {
      help: "  Scrolls inside an element.",
      positional: ["ref"],
      words: ["computer", "scroll"],
    },
  },
  text: actionText,
  where: WHERE,
});

const computerDrag = defineCapability({
  // Both ends are the driver's to touch, so both are asked about.
  async gate({ ref, to }, ctx) {
    const from = await refGate(ref, ctx);
    return from.kind === "allowed" ? refGate(to, ctx) : from;
  },
  input: z.object({
    ref: Ref,
    to: Ref.meta({ description: "The element to drop on." }),
  }),
  name: "computer.drag",
  output: ActionData,
  run: ({ ref, to }, ctx) =>
    act(["drag", "--from", ref, "--to", to], true, ctx),
  summary: "Drags one element onto another with the person's pointer.",
  surfaces: {
    cli: {
      help: "  Drags one element onto another, which takes the person's pointer and focus.",
      positional: ["ref"],
      words: ["computer", "drag"],
    },
  },
  text: actionText,
  where: WHERE,
});

const computerPress = defineCapability({
  gate: ({ app }, ctx) => runningAppGate(app, ctx),
  input: z.object({
    app: AppName("press"),
    headed: Headed,
    keys: z.string({ error: "press: which keys? return, cmd+s, ..." }).meta({
      description: "The keys: return, escape, cmd+s, shift+tab, ...",
    }),
    window: WindowId,
  }),
  name: "computer.press",
  output: ActionData,
  async run({ app, headed, keys, window }, ctx) {
    const gated = await gatedRunningApp(app, ctx);
    const target =
      window === undefined
        ? ["--app", gated.name]
        : await windowTarget(gated, window, ctx);
    return act(["press", keys, ...target], headed, ctx);
  },
  summary: "Sends keys to an allowed app without bringing it forward.",
  surfaces: {
    cli: {
      help: "  Sends keys to an allowed app without bringing it forward: return, escape, cmd+s. Quitting shortcuts are refused.",
      positional: ["app", "keys"],
      words: ["computer", "press"],
    },
  },
  text: actionText,
  where: WHERE,
});

const SHOT_NAME = /[:.]/g;

const computerScreenshot = defineCapability({
  gate: ({ app }, ctx) => runningAppGate(app, ctx),
  input: z.object({ app: AppName("screenshot"), window: WindowId }),
  name: "computer.screenshot",
  output: z.object({ path: z.string() }),
  async run({ app, window }, ctx) {
    const gated = await gatedRunningApp(app, ctx);
    const target = await windowTarget(gated, window, ctx);
    const dir = getScreenshotsDir(workDir(ctx.chatId));
    const file = path.join(
      dir,
      `computer-${getCurrentDate().toISOString().replaceAll(SHOT_NAME, "-")}.png`,
    );
    await DefenseInDepthBox.runTrustedAsync(() =>
      fs.mkdir(dir, { recursive: true }),
    );
    await runDriver(["screenshot", file, ...target], ctx);
    return { path: shellPath(file) };
  },
  summary: "Saves a picture of an allowed app's window.",
  surfaces: {
    cli: {
      help: "  Saves a picture of an allowed app's window, for what the tree can't say. Open it with the read tool.",
      positional: ["app"],
      words: ["computer", "screenshot"],
    },
  },
  text: ({ path: saved }) => `Saved ${saved}. Read it with the read tool.`,
  where: WHERE,
});

/** In the order `instrument computer help` lists them. */
export const COMPUTER_CAPABILITIES = [
  computerApps,
  computerOpen,
  computerWindows,
  computerSnapshot,
  computerGet,
  computerScreenshot,
  computerClick,
  computerType,
  computerSetValue,
  computerClear,
  computerSelect,
  computerPress,
  computerToggle,
  computerCheck,
  computerUncheck,
  computerExpand,
  computerCollapse,
  computerFocus,
  computerRightClick,
  computerDoubleClick,
  computerHover,
  computerDrag,
  computerScroll,
  computerScrollTo,
] as const;
