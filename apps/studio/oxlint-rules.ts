import { definePlugin, defineRule, type ESTree } from "@oxlint/plugins";

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

export default definePlugin({
  meta: { name: "studio" },
  rules: {
    "no-either-command-key": noEitherCommandKey,
    "no-os-words": noOsWords,
    "no-raw-anchor": noRawAnchor,
    "no-raw-webview": noRawWebview,
    "no-router-link": noRouterLink,
    "no-shared-shadow-on-float": noSharedShadowOnFloat,
    "no-shell-open-path": noShellOpenPath,
    "no-transition-colors": noTransitionColors,
    "one-tooltip-provider": oneTooltipProvider,
  },
});
