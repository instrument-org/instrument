// What the React Compiler skips in the files named, over the skips recorded
// here, and the scopes it lets go of in the components named in PRUNED. The
// whole client takes the compiler 20 seconds, so a turn's end asks about the
// files it edited (scripts/turn-end.ts) and the test asks about all.
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

/**
 * The scopes the React Compiler works out in a component and then lets go of,
 * which is silent where a skip is loud: a value made ahead of a later hook
 * call, a value built inline in the returned tree beside one that changes on
 * every render, each is made anew on every render, and everything it reaches
 * renders again. The count also takes in scopes let go of harmlessly, one
 * inside a loop or one whose value nothing reads, so a rise is a scope to
 * look at, not always a value made anew. These components hand values to
 * every screen of the window or every turn of a chat, so each is held to the
 * count it has, which only ever gets lower. Only these: elsewhere such scopes
 * come and go with ordinary edits, perf fixes among them.
 */
export const PRUNED: Record<string, number> = {
  "components/task/chat.tsx#ChatConversation": 8,
  "components/transcript/transcript.tsx#Transcript": 2,
  "components/window/app-window.tsx#WindowShell": 1,
};

const CLIENT = path.join(import.meta.dirname, "../src/client");
const require = createRequire(import.meta.url);

type CompilerEvent = {
  detail?: { category?: string; options?: { category?: string } };
  fnLoc?: { start?: { index?: number } } | null;
  kind: string;
  /** On `CompileSuccess`: the scopes worked out and then let go. */
  prunedMemoBlocks?: number;
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

/**
 * What the compiler skips in a client file, named from src/client, and how
 * many scopes it lets go of in each function it compiles, by `file#function`.
 */
export function compilerReport(file: string) {
  const code = fs.readFileSync(path.join(CLIENT, file), "utf8");
  const names = new Map<number, string>();
  const events: CompilerEvent[] = [];
  // Every function's name, read ahead of the compiler, which replaces each
  // function it compiles as it goes.
  const recordNames = {
    visitor: {
      Program(program: { traverse: (visitor: object) => void }) {
        program.traverse({
          "ArrowFunctionExpression|FunctionDeclaration|FunctionExpression"(
            fn: BabelPath,
          ) {
            if (typeof fn.node.start === "number") {
              names.set(fn.node.start, nameOf(fn));
            }
          },
        });
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
  const pruned = new Map<string, number>();
  for (const event of events) {
    const start = event.fnLoc?.start?.index;
    const name =
      (start === undefined ? undefined : names.get(start)) ?? "(unknown)";
    const key = `${file}#${name}`;
    if (event.kind === "CompileSuccess") {
      pruned.set(key, (pruned.get(key) ?? 0) + (event.prunedMemoBlocks ?? 0));
    }
    if (event.kind !== "CompileError") {
      continue;
    }
    const category =
      event.detail?.options?.category ?? event.detail?.category ?? "Unknown";
    skipped.set(key, category);
  }
  return { pruned, skipped };
}

/**
 * The skips no one recorded and the recorded ones that compile, and the
 * components in PRUNED letting go of more scopes or fewer than recorded.
 */
export function skipDifferences(files: string[]) {
  const reports = files.map((file) => compilerReport(file));
  const skipped = new Map(reports.flatMap((report) => [...report.skipped]));
  const pruned = new Map(reports.flatMap((report) => [...report.pruned]));
  const prunedNow = (bound: (now: number, recorded: number) => boolean) =>
    Object.entries(PRUNED).flatMap(([key, recorded]) => {
      const now = pruned.get(key);
      return now !== undefined && bound(now, recorded)
        ? [{ key, now, recorded }]
        : [];
    });
  return {
    fewerPruned: prunedNow((now, recorded) => now < recorded),
    missingPruned: Object.keys(PRUNED).filter(
      (key) =>
        files.includes(key.slice(0, key.indexOf("#"))) &&
        !pruned.has(key) &&
        !skipped.has(key),
    ),
    morePruned: prunedNow((now, recorded) => now > recorded),
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
  const { fewerPruned, missingPruned, morePruned, newlySkipped, nowCompiled } =
    skipDifferences(files);
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
  for (const { key, now, recorded } of morePruned) {
    console.log(
      `${key}: the React Compiler lets go of ${now.toString()} of its scopes, past the ${recorded.toString()} recorded, so a value it made once may be made on every render, and whatever reads it renders again. Move the hook calls above the values worked out before them, or make the value a hook of its own; if the new scope is in a loop, reads nothing that changes or has to go, raise its count in PRUNED in apps/studio/scripts/react-compiler-skips.ts and say why in the commit.`,
    );
  }
  for (const { key, now } of fewerPruned) {
    console.log(
      `${key}: the React Compiler lets go of ${now.toString()} of its scopes now; lower its count in PRUNED in apps/studio/scripts/react-compiler-skips.ts to ${now.toString()}.`,
    );
  }
  for (const key of missingPruned) {
    console.log(
      `${key}: the React Compiler compiles no such function; move or remove its entry in PRUNED in apps/studio/scripts/react-compiler-skips.ts.`,
    );
  }
  process.exitCode =
    newlySkipped.length +
      nowCompiled.length +
      morePruned.length +
      fewerPruned.length +
      missingPruned.length >
    0
      ? 1
      : 0;
}
