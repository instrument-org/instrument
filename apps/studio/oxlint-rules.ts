import {
  type Context,
  definePlugin,
  defineRule,
  type ESTree,
  type RuleOptionsSchema,
} from "@oxlint/plugins";

/**
 * Bans that describe the shape of the running app. Each one names the
 * replacement, since the agent writing the code cannot otherwise know it.
 */

const noRawAnchor = defineRule({
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "a") {
          context.report({ messageId: "rawAnchor", node });
        }
      },
    };
  },
  meta: {
    messages: {
      rawAnchor:
        "Raw anchor tags <a> are not allowed in the Electron app. Use the ExternalLink component instead.",
    },
    schema: [],
    type: "problem",
  },
});

const oneTooltipProvider = defineRule({
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type === "JSXIdentifier" &&
          node.name.name === "TooltipProvider"
        ) {
          context.report({ messageId: "tooltipProvider", node });
        }
      },
    };
  },
  meta: {
    messages: {
      tooltipProvider:
        "TooltipProvider should only be declared once at the app root. Do not use it in other components.",
    },
    schema: [],
    type: "problem",
  },
});

// What shows the app's own tooltip over the element it wraps.
const tooltipTriggers = new Set(["ToolbarTooltip", "TooltipTrigger"]);
// Marks that bring a tooltip of their own unless told not to.
const marksWithTooltips = new Set(["Favicon", "PageFavicon"]);

/**
 * The app's tooltip trigger `node` sits on or inside in the same JSX, if any.
 * The tooltip's content is not under the trigger, so the walk stops there.
 */
function enclosingTooltipTrigger(node: ESTree.Node) {
  for (let at = node.parent; at; at = at.parent) {
    if (
      at.type !== "JSXElement" ||
      at.openingElement.name.type !== "JSXIdentifier"
    ) {
      continue;
    }
    const { name } = at.openingElement.name;
    if (name === "TooltipContent") {
      return undefined;
    }
    if (tooltipTriggers.has(name)) {
      return name;
    }
  }
  return undefined;
}

const isIntrinsic = (name: string) => /^[a-z]/.test(name);

/** Whether an element around `node` in the same JSX shows a native title. */
function insideNativeTitle(node: ESTree.Node) {
  for (let at = node.parent; at; at = at.parent) {
    if (
      at.type === "JSXElement" &&
      at.openingElement.name.type === "JSXIdentifier" &&
      isIntrinsic(at.openingElement.name.name) &&
      at.openingElement.attributes.some(
        (attribute) =>
          attribute.type === "JSXAttribute" &&
          attribute.name.type === "JSXIdentifier" &&
          attribute.name.name === "title",
      )
    ) {
      return true;
    }
  }
  return false;
}

const noTitleUnderTooltip = defineRule({
  create(context) {
    return {
      JSXAttribute(node) {
        const element = node.parent;
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "title" ||
          element?.type !== "JSXOpeningElement" ||
          element.name.type !== "JSXIdentifier" ||
          !(
            isIntrinsic(element.name.name) ||
            tooltipTriggers.has(element.name.name)
          )
        ) {
          return;
        }
        const trigger = enclosingTooltipTrigger(node);
        if (trigger) {
          context.report({
            data: { trigger: `<${trigger}>` },
            messageId: "title",
            node,
          });
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") {
          return;
        }
        const { name } = node.name;
        if (name === "title") {
          const trigger = enclosingTooltipTrigger(node);
          if (trigger) {
            context.report({
              data: { trigger: `<${trigger}>` },
              messageId: "title",
              node,
            });
          }
          return;
        }
        if (!marksWithTooltips.has(name)) {
          return;
        }
        const isQuiet = node.attributes.some(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.type === "JSXIdentifier" &&
            attribute.name.name === "hasTooltip" &&
            attribute.value?.type === "JSXExpressionContainer" &&
            attribute.value.expression.type === "Literal" &&
            attribute.value.expression.value === false,
        );
        if (isQuiet) {
          return;
        }
        const around = enclosingTooltipTrigger(node);
        const trigger =
          (around && `<${around}>`) ??
          (insideNativeTitle(node) ? "an element with a title" : undefined);
        if (trigger) {
          context.report({
            data: { mark: name, trigger },
            messageId: "markTooltip",
            node,
          });
        }
      },
    };
  },
  meta: {
    messages: {
      markTooltip:
        "<{{mark}}> shows a tooltip of its own inside {{trigger}}, so two can show at once. Pass hasTooltip={false}; see docs/principles/one-tooltip-at-a-time.md.",
      title:
        "A native title inside {{trigger}} shows beside the app's tooltip. Put what it says in the tooltip, or drop it; see docs/principles/one-tooltip-at-a-time.md.",
    },
    schema: [],
    type: "problem",
  },
});

const noRouterLink = defineRule({
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@tanstack/react-router") {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "Link"
          ) {
            context.report({ messageId: "routerLink", node: specifier });
          }
        }
      },
    };
  },
  meta: {
    messages: {
      routerLink:
        "TanStack Router's Link is not tab-aware. Use the InternalLink component instead.",
    },
    schema: [],
    type: "problem",
  },
});

/** DOM calls that make or find an element by its tag or a selector. */
const ELEMENT_LOOKUPS = new Set([
  "closest",
  "createElement",
  "getElementsByTagName",
  "matches",
  "querySelector",
  "querySelectorAll",
]);
const webviewTag = /(?:^|[^\w-])webview(?:$|[^\w-])/i;

const noRawWebview = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        const { arguments: args, callee } = node;
        const first = args[0];
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          ELEMENT_LOOKUPS.has(callee.property.name) &&
          first?.type === "Literal" &&
          typeof first.value === "string" &&
          webviewTag.test(first.value)
        ) {
          context.report({ messageId: "rawWebview", node });
        }
      },
    };
  },
  meta: {
    messages: {
      rawWebview:
        "A browser guest's <webview> belongs to the pool (client/lib/browser-pool.ts). Reach it with getGuest(targetId) or useGuest(targetId), which hand out a GuestHandle only once the guest is ready.",
    },
    schema: [],
    type: "problem",
  },
});

const transitionColors = /(?:^|\s)transition-colors(?:\s|$)/;

const noTransitionColors = defineRule({
  create(context) {
    return {
      Literal(node) {
        if (
          typeof node.value === "string" &&
          transitionColors.test(node.value)
        ) {
          context.report({ messageId: "transitionColors", node });
        }
      },
    };
  },
  meta: {
    messages: {
      transitionColors:
        "Color and background never ease: a ramp in front of hover or pressed feedback reads as lag. Drop the class so the change lands on the next paint, or name the properties that really move (transition-[transform], transition-[outline]).",
    },
    schema: [],
    type: "problem",
  },
});

// A class list that floats (`fixed`, or the popover surface) wearing the shared
// ramp's ringed shadow, whose dark-mode hairline is translucent white. A class
// handed to an overlay primitive's content floats too, and `cn` lets its
// shadow replace the primitive's own.
const floatingSurface = /(?:^|\s)(?:fixed|bg-popover)(?:\s|$)/;
const sharedRingShadow = /(?:^|\s)shadow-(?:xs|sm|md|lg|xl|2xl|3xl)(?:\s|$)/;
const floatingContent = /^(?:AlertDialog|Dialog|Popover|Sheet)Content$/;

function isFloatingContentClass(node: ESTree.Node): boolean {
  const attribute = node.parent;
  if (
    attribute?.type !== "JSXAttribute" ||
    attribute.name.type !== "JSXIdentifier" ||
    attribute.name.name !== "className"
  ) {
    return false;
  }
  const element = attribute.parent;
  return (
    element?.type === "JSXOpeningElement" &&
    element.name.type === "JSXIdentifier" &&
    floatingContent.test(element.name.name)
  );
}

const noSharedShadowOnFloat = defineRule({
  create(context) {
    return {
      Literal(node) {
        if (
          typeof node.value === "string" &&
          (floatingSurface.test(node.value) || isFloatingContentClass(node)) &&
          sharedRingShadow.test(node.value)
        ) {
          context.report({ messageId: "sharedShadowOnFloat", node });
        }
      },
    };
  },
  meta: {
    messages: {
      sharedShadowOnFloat:
        "This surface floats over other content, and the shared shadow ramp's dark-mode hairline is translucent white outside its edge, so whatever passes beneath shows through it. Use shadow-float-{sm,md,lg}, whose hairline is opaque.",
    },
    schema: [],
    type: "problem",
  },
});

const noShellOpenPath = defineRule({
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "shell" &&
          node.property.type === "Identifier" &&
          node.property.name === "openPath"
        ) {
          context.report({ messageId: "shellOpenPath", node });
        }
      },
    };
  },
  meta: {
    messages: {
      shellOpenPath:
        "shell.openPath blocks the main thread on macOS for as long as a Gatekeeper prompt is up, which hangs every window. Use openPathOnComputer from electron-main/lib/open-path.ts.",
    },
    schema: [],
    type: "problem",
  },
});

/**
 * Names that end in `Library` and are not the Mac's folder. Any other
 * `Library` in text can be the folder, "Photos Library" included.
 */
const LIBRARY_NAMES = ["Skill"];

/**
 * Words and keys that belong to one operating system: its file manager and
 * its places, its stores, the computer itself, and how its keys are written,
 * as symbols or as words ("Cmd+K", "hold Option"). Text that writes one
 * itself shows it on every system, so each is defined in
 * `shared/os-conventions.ts` and read from there for the system the app runs
 * on.
 */
const osWord = new RegExp(
  [
    String.raw`\b(?:Finder|Quick\s+Look|Recycle\s+Bin|(?:File|Windows)\s+Explorer|Explorer|Keychain|System\s+(?:Settings|Preferences)|macOS\s+[Ss]ettings|AppData|[Tt]his\s+(?:Mac|PC)|[Yy]our\s+(?:Mac|PC)|Cmd|[Hh]old(?:ing)?\s+(?:down\s+)?Option|Option(?=[-+]\w))\b`,
    String.raw`(?<!\b(?:${LIBRARY_NAMES.join("|")})\s+)\bLibrary\b`,
    "[⌘⌥⌃⇧↩⌫]",
  ].join("|"),
  "u",
);

/** A path names a place on disk; it is never prose, even when it reads `Library`. */
const pathLike = /^(?:~|\.{1,2})?\/|^[A-Za-z]:\\|^\\\\|^\S*\w[\\/]\w\S*$/;

const comparisons = new Set(["!=", "!==", "==", "==="]);
const logger = /^(?:console|log|\w*[Ll]ogger)$/;

/** Node types a string passes through on its way into a call. */
const passThrough = new Set([
  "BinaryExpression",
  "ConditionalExpression",
  "LogicalExpression",
  "ParenthesizedExpression",
  "TemplateLiteral",
]);

/**
 * Whether the string at `node` is code rather than text a person reads: a
 * module path, a key, a type, a value compared against, or a log line. An
 * error's message is read as text, since many reach the person.
 */
function isCode(node: ESTree.Node): boolean {
  const { parent } = node;
  switch (parent?.type) {
    case undefined: {
      return false;
    }
    case "BinaryExpression": {
      if (comparisons.has(parent.operator)) {
        return true;
      }
      break;
    }
    case "ExportAllDeclaration":
    case "ExportNamedDeclaration":
    case "ImportDeclaration":
    case "ImportExpression":
    case "SwitchCase":
    case "TSEnumMember":
    case "TSLiteralType":
    case "TSTemplateLiteralType": {
      return true;
    }
    case "MethodDefinition":
    case "Property":
    case "PropertyDefinition":
    case "TSPropertySignature": {
      if (parent.key === node && !parent.computed) {
        return true;
      }
      break;
    }
    default: {
      break;
    }
  }
  let carried: ESTree.Node = node;
  while (carried.parent && passThrough.has(carried.parent.type)) {
    carried = carried.parent;
  }
  const holder = carried.parent;
  return (
    holder?.type === "CallExpression" &&
    holder.callee.type === "MemberExpression" &&
    holder.callee.object.type === "Identifier" &&
    logger.test(holder.callee.object.name)
  );
}

const isConcatenation = (node: ESTree.Node | null | undefined) =>
  node?.type === "BinaryExpression" && node.operator === "+";

/** Whether `node` is an operand of a `+` around it, parentheses or not. */
function isConcatenated(node: ESTree.Node): boolean {
  const { parent } = node;
  return parent?.type === "ParenthesizedExpression"
    ? isConcatenated(parent)
    : isConcatenation(parent);
}

/** The operands of a `+` chain, left to right, out of their parentheses. */
function concatenated(node: ESTree.Node): ESTree.Node[] {
  if (node.type === "ParenthesizedExpression") {
    return concatenated(node.expression);
  }
  return node.type === "BinaryExpression" && node.operator === "+"
    ? [...concatenated(node.left), ...concatenated(node.right)]
    : [node];
}

/** The text a string or a template with no expressions in it always is. */
function constantText(node: ESTree.Node): string | undefined {
  if (node.type === "Literal") {
    return typeof node.value === "string" ? node.value : undefined;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

const noOsWords = defineRule({
  create(context) {
    // A template is checked a piece of text at a time, but whether it is
    // code is a question about the whole template.
    const check = (node: ESTree.Node, text: string, whole = node) => {
      const word = osWord.exec(text)?.[0];
      if (word && !pathLike.test(text) && !isCode(whole)) {
        context.report({
          data: { word: word.replaceAll(/\s+/g, " ") },
          messageId: "osWord",
          node,
        });
      }
    };
    return {
      // Strings joined with `+` read as one ("Quick " + "Look"), so each run
      // of them is checked whole, from the outermost `+`. A run with a word
      // in one string alone was reported at that string.
      BinaryExpression(node) {
        if (!isConcatenation(node) || isConcatenated(node)) {
          return;
        }
        const runs: string[][] = [[]];
        for (const operand of concatenated(node)) {
          const text = constantText(operand);
          if (text === undefined) {
            runs.push([]);
          } else {
            runs.at(-1)?.push(text);
          }
        }
        for (const run of runs) {
          if (run.length > 1 && !run.some((text) => osWord.test(text))) {
            check(node, run.join(""));
          }
        }
      },
      JSXText(node) {
        check(node, node.value);
      },
      Literal(node) {
        if (typeof node.value === "string") {
          check(node, node.value);
        }
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw, node.parent);
      },
    };
  },
  meta: {
    messages: {
      osWord:
        "“{{word}}” belongs to one operating system, so this text says it on all of them. Read the word for the system the app runs on from shared/os-conventions.ts, adding it there if it is new. Text only ever shown on one system keeps it under `// oxlint-disable-next-line studio/no-os-words -- <where it shows>`.",
    },
    schema: [],
    type: "problem",
  },
});

/** The modifier names a `||` chain reads, by the property it reads them through. */
const modifiersRead = (node: ESTree.Expression): string[] => {
  if (node.type === "LogicalExpression" && node.operator === "||") {
    return [...modifiersRead(node.left), ...modifiersRead(node.right)];
  }
  if (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier"
  ) {
    return [node.property.name];
  }
  return [];
};

/**
 * ⌘ or Ctrl as one key is a chord macOS reads as two: Ctrl+K, Ctrl+E and
 * Ctrl+A are the text system's own line keys there, so a listener taking
 * either swallows them. A chain that reads Alt too is asking whether any
 * modifier is held, which is not a chord.
 */
const noEitherCommandKey = defineRule({
  create(context) {
    return {
      LogicalExpression(node) {
        if (
          node.operator !== "||" ||
          (node.parent.type === "LogicalExpression" &&
            node.parent.operator === "||")
        ) {
          return;
        }
        const read = modifiersRead(node);
        if (
          read.includes("metaKey") &&
          read.includes("ctrlKey") &&
          !read.includes("altKey")
        ) {
          context.report({ messageId: "eitherCommandKey", node });
        }
      },
    };
  },
  meta: {
    messages: {
      eitherCommandKey:
        "`metaKey || ctrlKey` takes Ctrl chords on macOS that belong to the text system (Ctrl+K deletes to the end of the line). Use `commandKeyHeld(event)` from client/lib/utils, or `event[conventions.commandKey]` where the OS conventions are passed in.",
    },
    schema: [],
    type: "problem",
  },
});

/**
 * What a rule finds in a file, held to the count recorded for the file in the
 * package's `.oxlintrc.json`. The places written before the rule are counted
 * there by file, and a count only falls: one over it reports every place in
 * the file, since which is new is not known here, and one under it asks for
 * the lower count.
 */
function ratchet(context: Context, rule: string) {
  const path = context.filename.replaceAll("\\", "/");
  // `as`: the rule's own schema, which `context.options` does not carry.
  const [recorded = {}] = context.options as [Record<string, number>?];
  const allowed =
    Object.entries(recorded).find(([file]) => path.endsWith(`/${file}`))?.[1] ??
    0;
  const found: {
    data?: Record<string, string>;
    messageId: string;
    node: ESTree.Node;
  }[] = [];
  return {
    add(messageId: string, node: ESTree.Node, data?: Record<string, string>) {
      found.push({ data, messageId, node });
    },
    report: (node: ESTree.Node) => {
      const disable = new RegExp(
        `oxlint-disable-next-line .*studio/${rule}(?![\\w-])`,
      );
      const excused = new Set(
        context.sourceCode
          .getAllComments()
          .filter((comment) => disable.test(comment.value))
          .map((comment) => comment.loc.end.line + 1),
      );
      // A line excused by a comment is reported for the comment to hide, and
      // takes none of the file's count.
      const counted = found.filter(
        (each) => !excused.has(each.node.loc.start.line),
      );
      const data = {
        allowed: String(allowed),
        count: String(counted.length),
      };
      for (const each of found) {
        if (counted.length > allowed || !counted.includes(each)) {
          context.report({ ...each, data: { ...each.data, ...data } });
        }
      }
      if (counted.length < allowed) {
        context.report({ data, messageId: "fewer", node });
      }
    },
  };
}

/** A count for each file that has places from before the rule. */
const RATCHET_SCHEMA = [
  { additionalProperties: { minimum: 1, type: "integer" }, type: "object" },
] as const satisfies RuleOptionsSchema;

/**
 * Sync calls that read a file's contents, by the name `node:fs` gives them,
 * and the repo's wrappers over them. On a file a sync service keeps by name
 * only, each one blocks the calling thread until the file downloads.
 */
const SYNC_CONTENT_READS = new Set([
  "appendFileSync",
  "openSync",
  "readFileSync",
  "readJsonRecordSync",
  "readSync",
  "updateJsonRecordSync",
]);
/**
 * Sync calls that list a folder, or read every file in what they copy. One the
 * service keeps by name only is downloaded to be listed, and the listing may
 * wait on macOS's approval.
 */
const SYNC_LISTINGS = new Set([
  "copyFileSync",
  "cpSync",
  "globSync",
  "opendirSync",
  "readdirSync",
]);
const FS_MODULES = new Set(["fs", "node:fs"]);

/**
 * The name a call goes by: what `node:fs` exports a function as, where it
 * was imported under another name, or else the function's or method's own.
 * `ImportDeclaration` learns those names, and is the rule's visitor too.
 */
function fsCallNames() {
  // Local names `node:fs` imports go by, to the name it exports them as.
  const fsImports = new Map<string, string>();
  return {
    ImportDeclaration: (node: ESTree.ImportDeclaration) => {
      if (!FS_MODULES.has(node.source.value)) {
        return;
      }
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.imported.type === "Identifier"
        ) {
          fsImports.set(specifier.local.name, specifier.imported.name);
        }
      }
    },
    nameOf: ({ callee }: ESTree.CallExpression): string | undefined => {
      if (callee.type === "Identifier") {
        return fsImports.get(callee.name) ?? callee.name;
      }
      return callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier"
        ? callee.property.name
        : undefined;
    },
  };
}

/**
 * Whether `openSync` is called with a flag that truncates (`"w"`, `"wx"`,
 * `"w+"`), which starts the file empty and so never waits on its contents.
 * Any other flag, or one not written as a string, is read as a read.
 */
const opensForWriting = (args: ESTree.CallExpression["arguments"]) => {
  const flags = args[1];
  return (
    flags?.type === "Literal" &&
    typeof flags.value === "string" &&
    flags.value.startsWith("w")
  );
};

/**
 * The workspace's files can live in a synced folder, and code on the main
 * thread reads them through `lib/workspace-files.ts`. A file that is only
 * ever on local disk, or a read that has to stay synchronous, is turned off
 * by file in the package's `.oxlintrc.json`, or by line, with its reason.
 * Listings and copies from before the rule covered them are a ratchet.
 */
const noSyncContentRead = defineRule({
  create(context) {
    const names = fsCallNames();
    const listings = ratchet(context, "no-sync-content-read");
    const report = (node: ESTree.CallExpression, name: string) => {
      if (SYNC_LISTINGS.has(name)) {
        listings.add("syncListing", node, { name });
        return;
      }
      if (!SYNC_CONTENT_READS.has(name)) {
        return;
      }
      if (name === "openSync" && opensForWriting(node.arguments)) {
        return;
      }
      context.report({ data: { name }, messageId: "syncContentRead", node });
    };
    return {
      CallExpression(node) {
        const name = names.nameOf(node);
        if (name !== undefined) {
          report(node, name);
        }
      },
      ImportDeclaration: names.ImportDeclaration,
      "Program:exit": listings.report,
    };
  },
  meta: {
    messages: {
      fewer:
        "This file has {{count}} synchronous listings and copies where {{allowed}} are recorded. Lower its count under studio/no-sync-content-read in the package's .oxlintrc.json, or drop the entry at none.",
      syncListing:
        "{{name}} lists a folder, or reads what it copies, on the calling thread ({{count}} here, {{allowed}} recorded), and one in a synced workspace folder may have to be downloaded or wait on macOS's approval first, which freezes the app. Use fs.promises. A folder only ever on local disk, or a call that has to stay synchronous, takes `// oxlint-disable-next-line studio/no-sync-content-read -- <why>`, or puts its file on the allowlist in the package's .oxlintrc.json.",
      syncContentRead:
        "{{name}} reads a file's contents on the calling thread, and a file in a synced workspace folder may not be downloaded yet, which freezes the app until it is. Read workspace files with lib/workspace-files.ts (packages/workspace). A file only ever on local disk, or a read that has to stay synchronous, goes on the allowlist in the package's .oxlintrc.json, or takes `// oxlint-disable-next-line studio/no-sync-content-read -- <why>`.",
    },
    schema: RATCHET_SCHEMA,
    type: "problem",
  },
});

/**
 * Sync calls that write a file, by the name `node:fs` gives them, and the
 * repo's wrappers over them. An append or a copy is a read too, and
 * `no-sync-content-read` reports it as one.
 */
const SYNC_WRITES = new Set([
  "appendFileSync",
  "copyFileSync",
  "rewriteFileSync",
  "writeDeviceStatusFileSync",
  "writeFileSync",
  "writeJsonAtomic",
  "writeStoreRowsSync",
  "writeSync",
]);

/**
 * A sync write in the main process holds every window until the disk is
 * done, however often it comes: a file rewritten on each tab switch did.
 * The writes that have to stay synchronous are counted by file in the
 * package's `.oxlintrc.json`, each with its reason, or excused by line.
 */
const noSyncWrite = defineRule({
  create(context) {
    const names = fsCallNames();
    const writes = ratchet(context, "no-sync-write");
    return {
      CallExpression(node) {
        const name = names.nameOf(node);
        if (name !== undefined && SYNC_WRITES.has(name)) {
          writes.add("syncWrite", node, { name });
        }
      },
      ImportDeclaration: names.ImportDeclaration,
      "Program:exit": writes.report,
    };
  },
  meta: {
    messages: {
      fewer:
        "This file has {{count}} synchronous writes where {{allowed}} are recorded. Lower its count under studio/no-sync-write in apps/studio/.oxlintrc.json, or drop the entry at none.",
      syncWrite:
        "{{name}} writes on the main process's thread, and every window waits until the disk is done ({{count}} here, {{allowed}} recorded). Use fs.promises, written to a temporary file and renamed into place. A write that has to finish before the process goes on (a launch step, the quit's last flush) gets its file's count raised in apps/studio/.oxlintrc.json with its reason, or takes `// oxlint-disable-next-line studio/no-sync-write -- <why>`.",
    },
    schema: RATCHET_SCHEMA,
    type: "problem",
  },
});

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

const optsOutOfMemo = (fn: FunctionNode) =>
  fn.body?.type === "BlockStatement" &&
  fn.body.body.some(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      statement.directive === "use no memo",
  );

/**
 * The transcript's stage keeps a clock and the reveals outside React, and a
 * hook reading either while rendering gets a stale answer from a memoized
 * render: a cached `stage.now()` once dated a fold long over and slid a reply
 * up. So a function taking the stage opts out of React Compiler memoizing.
 */
const stageReaderOptsOut = defineRule({
  create(context) {
    // The functions the visit is inside, innermost last.
    const functions: FunctionNode[] = [];
    const enter = (node: FunctionNode) => {
      functions.push(node);
    };
    const exit = () => {
      functions.pop();
    };
    return {
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "useStage"
        ) {
          return;
        }
        const fn = functions.at(-1);
        if (fn && !optsOutOfMemo(fn)) {
          context.report({ messageId: "stageReader", node });
        }
      },
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
    };
  },
  meta: {
    messages: {
      stageReader:
        'A function taking the stage reads its clock or reveals outside React, which a memoized render answers from an earlier time. Open the function with the "use no memo" directive and a line saying what it reads.',
    },
    schema: [],
    type: "problem",
  },
});

const TIMERS = new Set(["requestAnimationFrame", "setInterval", "setTimeout"]);

/** The timer a call starts, by name, as a global's or as a window's own. */
const timerStarted = ({ callee }: ESTree.CallExpression) => {
  const name =
    callee.type === "Identifier"
      ? callee.name
      : callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier"
        ? callee.property.name
        : undefined;
  return name !== undefined && TIMERS.has(name) ? name : undefined;
};

/** Whether what a call answers goes nowhere, so nothing can cancel the timer. */
const isDiscarded = (node: ESTree.CallExpression) => {
  const { parent } = node;
  if (parent.type === "ExpressionStatement") {
    return true;
  }
  if (parent.type === "UnaryExpression") {
    return parent.operator === "void";
  }
  if (parent.type !== "ArrowFunctionExpression" || parent.body !== node) {
    return false;
  }
  // An arrow answering its timer hands the handle on, but for one given to a
  // promise or to another timer, which read nothing from it.
  const caller = parent.parent;
  return caller.type === "NewExpression"
    ? caller.callee.type === "Identifier" && caller.callee.name === "Promise"
    : caller.type === "CallExpression" &&
        caller.callee !== parent &&
        timerStarted(caller) !== undefined;
};

const isZeroDelay = (node: ESTree.CallExpression, timer: string) => {
  const delay = node.arguments[1];
  return (
    timer === "setTimeout" &&
    (delay === undefined || (delay.type === "Literal" && delay.value === 0))
  );
};

/**
 * A timer whose handle nothing keeps cannot be canceled, so it acts on
 * whatever is there when it goes off, and one of no delay waits only for
 * whatever happens to be queued. The places from before the rule are a ratchet.
 */
const noLooseTimers = defineRule({
  create(context) {
    const sites = ratchet(context, "no-loose-timers");
    return {
      CallExpression(node) {
        const timer = timerStarted(node);
        if (timer === undefined) {
          return;
        }
        if (isZeroDelay(node, timer)) {
          sites.add("zeroDelay", node);
        } else if (isDiscarded(node)) {
          sites.add(timer, node);
        }
      },
      "Program:exit": sites.report,
    };
  },
  meta: {
    messages: {
      fewer:
        "This file has {{count}} loose timers where {{allowed}} are recorded. Lower its count under studio/no-loose-timers in apps/studio/.oxlintrc.json, or drop the entry at none.",
      requestAnimationFrame:
        "Nothing can cancel this frame ({{count}} loose timers here, {{allowed}} recorded). What a render draws is read or focused in useLayoutEffect or the element's ref; a wait for a paint is afterNextPaint; otherwise keep the handle and cancel it. A wait with no event and nothing to cancel takes `// oxlint-disable-next-line studio/no-loose-timers -- <why>`.",
      setInterval:
        "Nothing can stop this interval ({{count}} loose timers here, {{allowed}} recorded). A clock on screen is useNow; re-reading something is a live query or refetchInterval; otherwise keep the handle and clear it.",
      setTimeout:
        "Nothing can cancel this timer, so it goes off over whatever came since ({{count}} loose timers here, {{allowed}} recorded). Wait for the thing itself: onCloseAutoFocus, transitionend, the promise. A real delay keeps its handle and clears it as it starts again and as its owner goes. A wait with no event and nothing to cancel takes `// oxlint-disable-next-line studio/no-loose-timers -- <why>`.",
      zeroDelay:
        "A timer of no delay runs after whatever happens to be queued ({{count}} loose timers here, {{allowed}} recorded). Put the work in the layout effect that follows the state change, in the handler that causes it, or in a menu's onCloseAutoFocus. Work that must leave the event it is in takes `// oxlint-disable-next-line studio/no-loose-timers -- <why>`.",
    },
    schema: RATCHET_SCHEMA,
    type: "problem",
  },
});

/** The names the two ends of a chain go by: `rpcClient` in `rpcClient.a.b.call`. */
const chainOf = (node: ESTree.Node): string[] => {
  switch (node.type) {
    case "ChainExpression":
    case "ParenthesizedExpression":
    case "TSNonNullExpression": {
      return chainOf(node.expression);
    }
    case "Identifier": {
      return [node.name];
    }
    case "MemberExpression": {
      const name =
        !node.computed && node.property.type === "Identifier"
          ? node.property.name
          : "";
      return [...chainOf(node.object), name];
    }
    default: {
      return [];
    }
  }
};

const isRpcCall = (node: ESTree.CallExpression) => {
  const chain = chainOf(node.callee);
  return chain[0] === "rpcClient" && chain.at(-1) === "call";
};

const isFunction = (
  node: ESTree.Node | null | undefined,
): node is FunctionNode =>
  node?.type === "ArrowFunctionExpression" ||
  node?.type === "FunctionDeclaration" ||
  node?.type === "FunctionExpression";

type Fate = "handled" | "silenced" | "unheard";

/**
 * What a `.catch` handler makes of a failure. One that does nothing silences
 * it, unless a comment in it says why nothing is what should happen.
 */
const handlerFate = (
  handler: ESTree.Node | undefined,
  hasComment: (node: ESTree.Node) => boolean,
): Fate => {
  if (!handler) {
    return "unheard";
  }
  if (handler.type === "Identifier") {
    return handler.name === "undefined"
      ? "unheard"
      : handler.name === "noop"
        ? "silenced"
        : "handled";
  }
  if (handler.type === "Literal") {
    return "unheard";
  }
  if (!isFunction(handler)) {
    return "handled";
  }
  const body: ESTree.Node | null = handler.body;
  const empty =
    body?.type === "BlockStatement"
      ? body.body.length === 0
      : body?.type === "Identifier"
        ? body.name === "undefined"
        : (body?.type === "UnaryExpression" && body.operator === "void") ||
          (body?.type === "Literal" && body.value === null);
  return empty && !hasComment(handler) ? "silenced" : "handled";
};

/**
 * Handlers of events, which read nothing from what they are answered, by the
 * names this client's elements give them. A component's own `onSave` may wait
 * for the promise it is answered, so only these count.
 */
const EVENT_HANDLER =
  /^on(?:Blur|Change|CheckedChange|Click|ContextMenu|Copy|DoubleClick|Drag\w*|Drop|Focus|Input|Key(?:Down|Up)|Mouse\w+|OpenChange|Paste|Pointer\w+|Select|Submit|ValueChange)$/;

/** Whether a function is an event's, as an attribute or in an object of them. */
const isEventHandler = (fn: ESTree.Node): boolean => {
  const { parent } = fn;
  const name =
    parent?.type === "JSXExpressionContainer" &&
    parent.parent.type === "JSXAttribute"
      ? parent.parent.name
      : parent?.type === "Property"
        ? parent.key
        : undefined;
  return (
    (name?.type === "JSXIdentifier" || name?.type === "Identifier") &&
    EVENT_HANDLER.test(name.name)
  );
};

/** What becomes of a failure thrown at `node`, inside its function. */
const thrownFate = (
  node: ESTree.Node,
  hasComment: (node: ESTree.Node) => boolean,
): Fate => {
  let inner: ESTree.Node = node;
  for (let outer = node.parent; outer; outer = outer.parent) {
    if (
      outer.type === "TryStatement" &&
      outer.block === inner &&
      outer.handler
    ) {
      return outer.handler.body.body.length === 0 && !hasComment(outer.handler)
        ? "silenced"
        : "handled";
    }
    if (isFunction(outer)) {
      if (isEventHandler(outer)) {
        return "unheard";
      }
      const called = outer.parent;
      const isCalled =
        called?.type === "ParenthesizedExpression" ? called.parent : called;
      return isCalled?.type === "CallExpression" &&
        isCalled.callee === (called === isCalled ? outer : called)
        ? promiseFate(isCalled, hasComment)
        : "handled";
    }
    inner = outer;
  }
  return "handled";
};

/** What becomes of a failure in the promise `node` answers. */
const promiseFate = (
  node: ESTree.Node,
  hasComment: (node: ESTree.Node) => boolean,
): Fate => {
  const { parent } = node;
  switch (parent?.type) {
    case "ArrayExpression": {
      const call = parent.parent;
      return call.type === "CallExpression" &&
        ["all", "any", "race"].includes(chainOf(call.callee).at(-1) ?? "") &&
        chainOf(call.callee)[0] === "Promise"
        ? promiseFate(call, hasComment)
        : "handled";
    }
    case "ArrowFunctionExpression": {
      if (parent.body !== node) {
        return "handled";
      }
      if (isEventHandler(parent)) {
        return "unheard";
      }
      return "handled";
    }
    case "AwaitExpression": {
      return thrownFate(parent, hasComment);
    }
    case "ChainExpression":
    case "ConditionalExpression":
    case "LogicalExpression":
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression": {
      return promiseFate(parent, hasComment);
    }
    case "ExpressionStatement": {
      return "unheard";
    }
    case "MemberExpression": {
      const call = parent.parent;
      if (
        parent.object !== node ||
        call.type !== "CallExpression" ||
        call.callee !== parent ||
        parent.computed ||
        parent.property.type !== "Identifier"
      ) {
        return "handled";
      }
      const handler =
        parent.property.name === "catch"
          ? call.arguments[0]
          : parent.property.name === "then"
            ? call.arguments[1]
            : undefined;
      const fate = handlerFate(handler, hasComment);
      return fate === "unheard" ? promiseFate(call, hasComment) : fate;
    }
    case "ReturnStatement": {
      let fn: ESTree.Node | null = parent.parent;
      while (fn && !isFunction(fn)) {
        fn = fn.parent;
      }
      return fn && isEventHandler(fn) ? "unheard" : "handled";
    }
    case "UnaryExpression": {
      return parent.operator === "void" ? "unheard" : "handled";
    }
    default: {
      return "handled";
    }
  }
};

/**
 * A call to the main process whose failure goes nowhere: the person did
 * something, nothing happened, and nothing said so. It follows the promise
 * through `then` and `finally`, `&&` and `?:`, `Promise.all`, an awaited line
 * with no `catch` around it in an event handler or a function run on the spot,
 * and a `catch` that does nothing. A promise handed on is its receiver's.
 */
const noSilentRpc = defineRule({
  create(context) {
    const sites = ratchet(context, "no-silent-rpc");
    const comments = context.sourceCode.getAllComments();
    const hasComment = (node: ESTree.Node) =>
      comments.some(
        (comment) =>
          comment.range[0] >= node.range[0] &&
          comment.range[1] <= node.range[1],
      );
    return {
      CallExpression(node) {
        if (!isRpcCall(node)) {
          return;
        }
        const fate = promiseFate(node, hasComment);
        if (fate !== "handled") {
          sites.add(fate, node);
        }
      },
      "Program:exit": sites.report,
    };
  },
  meta: {
    messages: {
      fewer:
        "This file has {{count}} main-process calls whose failure goes nowhere, where {{allowed}} are recorded. Lower its count under studio/no-silent-rpc in apps/studio/.oxlintrc.json, or drop the entry at none.",
      silenced:
        "This call's failure is caught and dropped ({{count}} silent calls here, {{allowed}} recorded). Say so to the person (`toast.error(\"Couldn't …\", { cause: error })`), or write in the catch why nothing should happen.",
      unheard:
        'Nothing hears this call fail, so the person sees nothing happen ({{count}} silent calls here, {{allowed}} recorded). For something they did, `.catch((error: unknown) => toast.error("Couldn\'t …", { cause: error }))`. For work they did not ask for, a catch with a comment saying why nothing should happen.',
    },
    schema: RATCHET_SCHEMA,
    type: "problem",
  },
});

/** TanStack Query's hooks, each answering a new result object on every render. */
const QUERY_HOOKS = new Set([
  "useInfiniteQuery",
  "useMutation",
  "useQueries",
  "useQuery",
  "useSuspenseInfiniteQuery",
  "useSuspenseQueries",
  "useSuspenseQuery",
]);

/** Node types that carry a value on whole: the value itself, or one holding it. */
const CARRIES_WHOLE = new Set([
  "ArrayExpression",
  "ConditionalExpression",
  "JSXExpressionContainer",
  "LogicalExpression",
  "ObjectExpression",
  "ParenthesizedExpression",
  "Property",
  "SpreadElement",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

/**
 * Whether a call names a `combine`, whose answer TanStack Query keeps from one
 * render to the next until the results it reads change.
 */
const combines = (node: ESTree.CallExpression) => {
  const [options] = node.arguments;
  return (
    options?.type === "ObjectExpression" &&
    options.properties.some(
      (property) =>
        property.type === "Property" &&
        property.key.type === "Identifier" &&
        property.key.name === "combine",
    )
  );
};

/**
 * React's hooks that compare what they are handed by identity: a dependency
 * list, or a value kept until it changes. A hook of the app's own reads the
 * fields it needs, which the React Compiler keeps it by.
 */
const IDENTITY_HOOKS = new Set([
  "useCallback",
  "useEffect",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
]);

/**
 * Where a value at `node` is handed whole, past what carries it on: a
 * prop, an identity hook's argument (its dependencies included), or a name of
 * its own to follow. A field read off it, or a test of it, hands nothing on.
 */
function handedWhole(node: ESTree.Node): "alias" | "hook" | "prop" | undefined {
  let value = node;
  let { parent } = value;
  while (
    parent &&
    CARRIES_WHOLE.has(parent.type) &&
    !(parent.type === "ConditionalExpression" && parent.test === value) &&
    !(parent.type === "Property" && parent.value !== value)
  ) {
    value = parent;
    ({ parent } = value);
  }
  switch (parent?.type) {
    case "JSXAttribute":
    case "JSXSpreadAttribute": {
      return "prop";
    }
    case "CallExpression": {
      const { callee } = parent;
      return callee !== value &&
        callee.type === "Identifier" &&
        IDENTITY_HOOKS.has(callee.name)
        ? "hook"
        : undefined;
    }
    case "VariableDeclarator": {
      return parent.init === value && parent.id.type === "Identifier"
        ? "alias"
        : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * A query's result object is new on every render, so a prop or a dependency
 * holding it whole changes every render too, and nothing reading it keeps
 * what it derived: a child memoized on it draws again, an effect depending on
 * it runs again. Its fields (`.data`, `.mutate`) hold still until they
 * change, and so does what a `combine` answers. The name the result is given
 * is followed, and a name that is given in turn; a hook of the app's own that
 * returns a result whole is not followed into its callers.
 */
const noWholeQueryResult = defineRule({
  create(context) {
    const check = (node: ESTree.Node, hook: string, followed: boolean) => {
      const handed = handedWhole(node);
      if (handed === "prop" || handed === "hook") {
        context.report({ data: { hook }, messageId: "wholeQueryResult", node });
        return;
      }
      if (handed !== "alias" || followed) {
        return;
      }
      let declarator: ESTree.Node | null = node.parent;
      while (declarator && declarator.type !== "VariableDeclarator") {
        declarator = declarator.parent;
      }
      if (declarator?.type !== "VariableDeclarator") {
        return;
      }
      for (const variable of context.sourceCode.getDeclaredVariables(
        declarator,
      )) {
        for (const reference of variable.references) {
          if (!reference.init) {
            check(reference.identifier, hook, node.type !== "CallExpression");
          }
        }
      }
    };
    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          QUERY_HOOKS.has(node.callee.name) &&
          !combines(node)
        ) {
          check(node, node.callee.name, false);
        }
      },
    };
  },
  meta: {
    messages: {
      wholeQueryResult:
        "{{hook}}'s result is a new object on every render, so a prop or a dependency holding it whole changes every render, and nothing downstream keeps what it derives. Hand over the field it reads: `.data`, `.mutate`, `.isPending`.",
    },
    schema: [],
    type: "problem",
  },
});

/**
 * Two doc comments with no line between them: code that moved or was replaced
 * leaves its comment behind, on top of the comment of whatever took its
 * place. A doc comment set off by a blank line is a file's or a section's,
 * and passes.
 */
const noStackedDocComments = defineRule({
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const comments = sourceCode.getAllComments();
        for (const [index, comment] of comments.entries()) {
          const next = comments[index + 1];
          if (
            next &&
            comment.type === "Block" &&
            next.type === "Block" &&
            comment.value.startsWith("*") &&
            next.value.startsWith("*") &&
            /^[ \t]*\r?\n[ \t]*$/u.test(
              sourceCode.text.slice(comment.range[1], next.range[0]),
            )
          ) {
            context.report({ messageId: "stacked", node: comment });
          }
        }
      },
    };
  },
  meta: {
    messages: {
      stacked:
        "Two doc comments in a row: the first describes code that moved or was replaced. Keep the one that describes the code below, fold anything still true into it, and delete the other.",
    },
    schema: [],
    type: "problem",
  },
});

// A class list that scrolls, and whether it has chosen how its edges end. The
// choice is read from the whole class list: the `className` it is in, or the
// `cn(...)` call, or the string alone.
const scrollingClass = /(?:^|\s)!?overflow-(?:[xy]-)?(?:auto|scroll)!?(?:\s|$)/;
const scrollFadeChoice = /(?:^|[\s"'`])scroll-fade-(?:x|y|none)(?:[\s"'`]|$)/;

function classListOf(node: ESTree.Node): ESTree.Node {
  let list: ESTree.Node = node;
  for (let at = node.parent; at; at = at.parent) {
    if (at.type === "JSXAttribute") {
      return at;
    }
    if (
      at.type === "CallExpression" &&
      at.callee.type === "Identifier" &&
      at.callee.name === "cn"
    ) {
      list = at;
      continue;
    }
    if (
      at.type === "ConditionalExpression" ||
      at.type === "LogicalExpression" ||
      at.type === "ArrayExpression" ||
      at.type === "TemplateLiteral" ||
      at.type === "JSXExpressionContainer"
    ) {
      continue;
    }
    break;
  }
  return list;
}

const scrollFade = defineRule({
  create(context) {
    const reported = new Set<ESTree.Node>();
    const check = (node: ESTree.Node, text: string) => {
      if (!scrollingClass.test(text)) {
        return;
      }
      const list = classListOf(node);
      if (
        reported.has(list) ||
        scrollFadeChoice.test(context.sourceCode.getText(list))
      ) {
        return;
      }
      reported.add(list);
      context.report({ messageId: "scrollFade", node });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") {
          check(node, node.value);
        }
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
  meta: {
    messages: {
      scrollFade:
        "A scroller fades out at an edge with more past it (docs/principles/scroll-edges-fade.md). Add scroll-fade-y or scroll-fade-x, or scroll-fade-none where it should end at a hard edge: a document page, a grid with frozen headers, or a scroller that draws its own background or border, which the mask would fade too (put the fade on a scroller inside that box instead).",
    },
    schema: [],
    type: "suggestion",
  },
});

export default definePlugin({
  meta: { name: "studio" },
  rules: {
    "no-either-command-key": noEitherCommandKey,
    "no-loose-timers": noLooseTimers,
    "no-os-words": noOsWords,
    "no-raw-anchor": noRawAnchor,
    "no-raw-webview": noRawWebview,
    "no-router-link": noRouterLink,
    "no-shared-shadow-on-float": noSharedShadowOnFloat,
    "no-shell-open-path": noShellOpenPath,
    "no-silent-rpc": noSilentRpc,
    "no-stacked-doc-comments": noStackedDocComments,
    "no-sync-content-read": noSyncContentRead,
    "no-sync-write": noSyncWrite,
    "no-title-under-tooltip": noTitleUnderTooltip,
    "no-transition-colors": noTransitionColors,
    "no-whole-query-result": noWholeQueryResult,
    "one-tooltip-provider": oneTooltipProvider,
    "scroll-fade": scrollFade,
    "stage-reader-opts-out": stageReaderOptsOut,
  },
});
