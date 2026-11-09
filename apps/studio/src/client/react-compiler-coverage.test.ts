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
  "components/add-provider/form.tsx#AddProviderForm": "Todo",
  "components/branch-from-reply.tsx#BranchFromReply": "Todo",
  "components/code-editor/code-file-editor.tsx#LiveCodeDocument": "Suppression",
  "components/document-viewers/archive-viewer.tsx#ArchiveViewer":
    "IncompatibleLibrary",
  "components/document-viewers/csv-editor.tsx#LiveTable": "Suppression",
  "components/document-viewers/data-grid.tsx#DataGrid": "IncompatibleLibrary",
  "components/document-viewers/use-fit-width.ts#useFitWidth": "Todo",
  "components/document-viewers/use-visible-page.ts#useVisiblePage": "Todo",
  "components/document-viewers/xlsx-viewer.tsx#XlsxViewer": "Suppression",
  "components/draft-staging.ts#useFolderItems": "Suppression",
  "components/excalidraw-editor/excalidraw-file-editor.tsx#LiveCanvas":
    "Suppression",
  "components/file-viewer.tsx#useFileType": "Todo",
  "components/markdown-editor/markdown-editor.tsx#LiveDocument": "Suppression",
  "components/markdown-editor/markdown-value-editor.tsx#MarkdownValueEditor":
    "Suppression",
  "components/markdown.tsx#(anonymous)": "Todo",
  "components/markdown.tsx#useChatFileHostPaths": "Hooks",
  "components/media-player.tsx#usePlayerSession": "Suppression",
  "components/model-picker.tsx#VirtualRows": "Suppression",
  "components/permission-asks.tsx#PermissionAskCard": "Suppression",
  "components/settings/activity-section.tsx#LogTable": "IncompatibleLibrary",
  "components/settings/general-section.tsx#Notifications": "Todo",
  "components/setup/hero-morph.ts#useHeroPieces": "Immutability",
  "components/setup/kit/folder-row.tsx#FolderNote": "Todo",
  "components/setup/steps/folder.tsx#FolderStep": "Todo",
  "components/setup/steps/lost-folder.tsx#LostFolderPage": "Todo",
  "components/setup/steps/notifications.tsx#NotificationsStep": "Todo",
  "components/transcript/activity-row.tsx#StepDetail": "Hooks",
  "components/transcript/developer-notes-layer.tsx#DeveloperNotesLayer":
    "Hooks",
  "components/transcript/developer-notes-layer.tsx#NoteCard": "Hooks",
  "components/transcript/task-card.tsx#LiveTaskCard": "Hooks",
  "components/transcript/work-card.tsx#WorkCardView": "Hooks",
  "components/window/ask-marks.ts#useAskMarks": "Suppression",
  "components/window/browser-panel.tsx#BrowserPanel": "Suppression",
  "components/window/browser-tabs.tsx#BrowserTabs": "Suppression",
  "components/window/chat-folder-trash.tsx#ChatFolderDialog": "Todo",
  "components/window/chat-list.tsx#ChatList": "IncompatibleLibrary",
  "components/window/chat-pane.tsx#ChatPane": "Suppression",
  "components/window/command-menu.tsx#ResultRows": "IncompatibleLibrary",
  "components/window/compose-layer.tsx#ComposeLayer": "Suppression",
  "components/window/compose-window.tsx#ComposeWindow": "Suppression",
  "components/window/draft-band.ts#useBandContext": "Suppression",
  "components/window/hosted-page.ts#useHostedPage": "Suppression",
  "components/window/inbox-room.ts#useInboxRoom": "Suppression",
  "components/window/new-chat-view.tsx#NewChatView": "Suppression",
  "components/window/omnibar.tsx#Omnibar": "Suppression",
  "components/window/page-edit-state.ts#usePageEdit": "Todo",
  "components/window/page-hosts.ts#usePageHost": "Todo",
  "components/window/right-pane.tsx#RightPane": "Todo",
  "components/window/tab-carry-view.ts#useTabCarryView": "Todo",
  "components/window/use-drafts.ts#useDrafts": "Todo",
  "components/window/use-sign-in-landing.tsx#useSignInLanding": "Suppression",
  "components/window/use-window-commands.ts#useWindowCommands": "Todo",
  "components/window/window-zoom-root.tsx#WindowZoomRoot": "Todo",
  "drafts/use-composer-words.ts#useComposerWords": "Suppression",
  "hooks/use-decision.ts#useDecision": "Todo",
  "hooks/use-dictation.ts#useDictation": "Todo",
  "hooks/use-file-presence.ts#useFilePresence": "Todo",
  "hooks/use-find-target.ts#useFindTarget": "Refs",
  "hooks/use-image-panzoom.ts#useImagePanzoom": "Todo",
  "hooks/use-inline-rename.ts#useInlineRename": "Todo",
  "hooks/use-markdown-outline.ts#useActiveHeading": "Todo",
  "hooks/use-markdown-outline.ts#useMarkdownHeadings": "Todo",
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
function nameOf(path: BabelPath) {
  return (
    path.node.id?.name ??
    path.parentPath?.node.id?.name ??
    path.parentPath?.node.key?.name ??
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
