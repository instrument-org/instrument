// What the React Compiler skips in the files named, over the skips recorded
// here. The whole client takes the compiler 20 seconds, so a turn's end asks
// about the files it edited (scripts/turn-end.ts) and the test asks about all.
//
//   node scripts/react-compiler-skips.ts [file under src/client, or a path to it]...
//
// Prints one line a difference and exits 1 when there is any.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * The React Compiler skips a component or hook it cannot prove safe, and says
 * so only to a logger: a suppressed hooks rule, syntax it does not lower yet,
 * a ref read while rendering. A skipped component memoizes nothing, so every
 * list and callback it makes is new on every render and every row under it
 * renders again. react-compiler-coverage.test.ts runs the compiler over the
 * client and holds the skips to the ones named here, which only ever get fewer.
 */
export const SKIPPED: Record<string, string> = {
  "components/activity/activity-page.tsx#ActivityList": "IncompatibleLibrary",
  "components/document-viewers/archive-viewer.tsx#ArchiveViewer":
    "IncompatibleLibrary",
  "components/document-viewers/data-grid.tsx#DataGrid": "IncompatibleLibrary",
  "components/model-picker.tsx#VirtualRows": "IncompatibleLibrary",
  "components/window/chat-list.tsx#ChatList": "IncompatibleLibrary",
  "components/window/command-menu.tsx#ResultRows": "IncompatibleLibrary",
  "components/window/use-window-commands.ts#useWindowCommands": "Todo",
  "hooks/use-steady-callbacks.ts#useSteadyCallbacks": "Refs",
  "routes/_app/route.tsx#SiteView": "Suppression",
};

const CLIENT = path.join(import.meta.dirname, "../src/client");
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

/** Whether a path under src/client is one the compiler runs over. */
export const isCompiled = (file: string) =>
  /\.tsx?$/.test(file) &&
  !/\.test\.tsx?$/.test(file) &&
  !file.endsWith(".gen.ts") &&
  !file.endsWith(".d.ts");

/** The name a function is known by: its own, or the binding or key it is given to. */
function nameOf(fn: BabelPath) {
  return (
    fn.node.id?.name ??
    fn.parentPath?.node.id?.name ??
    fn.parentPath?.node.key?.name ??
    "(anonymous)"
  );
}

/** What the compiler skips in a client file, named from src/client, by `file#function`. */
export function skipsIn(file: string) {
  const code = fs.readFileSync(path.join(CLIENT, file), "utf8");
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

/** The skips no one recorded, and the recorded ones that compile. */
export function skipDifferences(files: string[]) {
  const skipped = new Map(files.flatMap((file) => [...skipsIn(file)]));
  return {
    newlySkipped: [...skipped]
      .filter(([key]) => !(key in SKIPPED))
      .map(([key, category]) => `${key} (${category})`),
    nowCompiled: Object.keys(SKIPPED).filter(
      (key) =>
        files.includes(key.slice(0, key.indexOf("#"))) && !skipped.has(key),
    ),
  };
}

if (import.meta.main) {
  const files = process.argv
    .slice(2)
    .map((file) =>
      path.isAbsolute(file)
        ? path.relative(CLIENT, file).split(path.sep).join("/")
        : file,
    )
    .filter(
      (file) =>
        !file.startsWith("..") &&
        isCompiled(file) &&
        fs.existsSync(path.join(CLIENT, file)),
    );
  const { newlySkipped, nowCompiled } = skipDifferences(files);
  for (const skip of newlySkipped) {
    console.log(
      `${skip}: the React Compiler skips this, so it memoizes nothing. Fix what the category names (a disable of a hooks rule is Suppression; reach for useEffectEvent).`,
    );
  }
  for (const key of nowCompiled) {
    console.log(
      `${key}: this compiles now; take it off SKIPPED in apps/studio/scripts/react-compiler-skips.ts.`,
    );
  }
  process.exitCode = newlySkipped.length + nowCompiled.length > 0 ? 1 : 0;
}
