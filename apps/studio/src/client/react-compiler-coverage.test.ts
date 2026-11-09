// land: every landing. It reads source as text, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The React Compiler skips a component or hook it cannot prove safe, and says
 * so only to a logger: a suppressed hooks rule, syntax it does not lower yet,
 * a ref read while rendering. A skipped component memoizes nothing, so every
 * list and callback it makes is new on every render and every row under it
 * renders again. This runs the compiler over the client and holds the skips
 * to the ones named here, which only ever get fewer.
 */
const SKIPPED: Record<string, string> = {
  "components/document-viewers/archive-viewer.tsx#ArchiveViewer":
    "IncompatibleLibrary",
  "components/document-viewers/data-grid.tsx#DataGrid": "IncompatibleLibrary",
  "components/markdown.tsx#useChatFileHostPaths": "Hooks",
  "components/model-picker.tsx#VirtualRows": "IncompatibleLibrary",
  "components/settings/activity-section.tsx#LogTable": "IncompatibleLibrary",
  "components/transcript/activity-row.tsx#StepDetail": "Hooks",
  "components/transcript/developer-notes-layer.tsx#DeveloperNotesLayer":
    "Hooks",
  "components/transcript/developer-notes-layer.tsx#NoteCard": "Hooks",
  "components/transcript/task-card.tsx#LiveTaskCard": "Hooks",
  "components/transcript/work-card.tsx#WorkCardView": "Hooks",
  "components/window/chat-list.tsx#ChatList": "IncompatibleLibrary",
  "components/window/command-menu.tsx#ResultRows": "IncompatibleLibrary",
  "components/window/use-window-commands.ts#useWindowCommands": "Todo",
  "hooks/use-steady-callbacks.ts#useSteadyCallbacks": "Refs",
  "routes/_app/route.tsx#SiteView": "Suppression",
};

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

type CompilerEvent = {
  detail?: { category?: string; options?: { category?: string } };
  fnLoc?: { start?: { index?: number } } | null;
  kind: string;
};
type BabelPath = {
  node: { id?: { name?: string } | null; start?: null | number };
  parentPath?: {
    node: { id?: { name?: string } | null; key?: { name?: string } };
  } | null;
};
type Babel = {
  transformSync: (code: string, options: Record<string, unknown>) => unknown;
};
// `@babel/core` ships no types; this is the one function the test calls.
const babel = require("@babel/core") as Babel;
const compiler = require.resolve("babel-plugin-react-compiler");

/** The name a function is known by: its own, or the binding or key it is given to. */
function nameOf(fn: BabelPath) {
  return (
    fn.node.id?.name ??
    fn.parentPath?.node.id?.name ??
    fn.parentPath?.node.key?.name ??
    "(anonymous)"
  );
}

function skipsIn(file: string) {
  const code = fs.readFileSync(path.join(here, file), "utf8");
  const names = new Map<number, string>();
  const events: CompilerEvent[] = [];
  const recordNames = {
    visitor: {
      "ArrowFunctionExpression|FunctionDeclaration|FunctionExpression"(
        fn: BabelPath,
      ) {
        if (typeof fn.node.start === "number") {
          names.set(fn.node.start, nameOf(fn));
        }
      },
    },
  };
  babel.transformSync(code, {
    babelrc: false,
    code: false,
    configFile: false,
    filename: file,
    parserOpts: { plugins: ["jsx", "typescript"] },
    plugins: [
      () => recordNames,
      [
        compiler,
        {
          logger: {
            logEvent: (_file: string, event: CompilerEvent) =>
              events.push(event),
          },
          panicThreshold: "none",
        },
      ],
    ],
  });
  const skipped = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "CompileError") {
      continue;
    }
    const start = event.fnLoc?.start?.index;
    const name =
      (start === undefined ? undefined : names.get(start)) ?? "(unknown)";
    const category =
      event.detail?.options?.category ?? event.detail?.category ?? "Unknown";
    skipped.set(`${file}#${name}`, category);
  }
  return skipped;
}

describe("the React Compiler", () => {
  it("compiles every component and hook in the client but the ones named", () => {
    const files = fs
      .readdirSync(here, { recursive: true, encoding: "utf8" })
      .filter(
        (file) =>
          /\.tsx?$/.test(file) &&
          !/\.test\.tsx?$/.test(file) &&
          !file.endsWith(".gen.ts") &&
          !file.endsWith(".d.ts"),
      )
      .map((file) => file.split(path.sep).join("/"))
      .sort();
    const skipped = new Map<string, string>();
    for (const file of files) {
      for (const [key, category] of skipsIn(file)) {
        skipped.set(key, category);
      }
    }
    const newlySkipped = [...skipped]
      .filter(([key]) => !(key in SKIPPED))
      .map(([key, category]) => `${key} (${category})`);
    const nowCompiled = Object.keys(SKIPPED).filter((key) => !skipped.has(key));
    // A new one: fix what the category names (an eslint-disable of a hooks
    // rule is Suppression; reach for useEffectEvent) rather than adding it.
    expect(newlySkipped).toEqual([]);
    // One that compiles now comes off the list.
    expect(nowCompiled).toEqual([]);
  }, 60_000);
});
