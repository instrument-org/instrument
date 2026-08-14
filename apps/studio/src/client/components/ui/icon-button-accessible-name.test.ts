import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_ROOT = path.join(import.meta.dirname, "../..");

/**
 * A `<TooltipContent>` is not an accessible name. It is rendered into a
 * separate portal, is not referenced by the trigger, and never reaches an
 * assistive client -- so an icon-only button labeled that way announces as
 * nothing, and shows up in a devtools accessibility snapshot as a bare
 * `button`. That second part is why this is a test rather than a review note:
 * the scripts that drive Studio for smoke and capture runs pick controls by
 * accessible name, and an unnamed one can only be picked by index or position,
 * which silently selects a different button the moment the toolbar changes.
 *
 * Why not a lint rule. `jsx-a11y/control-has-associated-label` is the closest
 * thing and it does not catch this: it counts any JSX child as content, so
 * `<button><SomeIcon /></button>` passes while `<button></button>` is flagged,
 * and it stays quiet on the custom `Button` even given `settings.jsx-a11y.
 * components` and `controlComponents`. That is not a bug in the rule -- from
 * the source alone it cannot know whether a child component renders text or an
 * SVG.
 *
 * Why the pattern and not every icon button. Asserting "an icon-only Button
 * carries a name" over the whole client reports 44 sites, nearly all of them
 * wrappers that take the name as a prop or triggers that inherit one. The
 * tooltip-trigger shape is the narrow case that is provably wrong: the author
 * wrote the label, and it lands somewhere assistive tech never reads.
 *
 * A source scan rather than a render test: the offenders are spread across
 * files whose components each need their own props and providers, and the thing
 * being asserted is a spelling rule that is visible in the source.
 */
function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    if (statSync(entryPath).isDirectory()) {
      if (entry === "__screenshots__" || entry === "node_modules") {
        continue;
      }
      out.push(...collectTsxFiles(entryPath));
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.includes(".test.")) {
      out.push(entryPath);
    }
  }
  return out;
}

const TOOLTIP_TRIGGER = /<TooltipTrigger asChild>([\s\S]*?)<\/TooltipTrigger>/g;
const ICON_CHILD = /<\w+Icon\b/;
const ICON_SIZE = 'size="icon';

function hasAccessibleName(block: string) {
  return (
    block.includes("aria-label") ||
    block.includes("aria-labelledby") ||
    block.includes("sr-only")
  );
}

describe("icon-only buttons", () => {
  it("carry an accessible name, not just a tooltip", () => {
    const offenders: string[] = [];

    for (const file of collectTsxFiles(CLIENT_ROOT)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("<TooltipTrigger")) {
        continue;
      }

      for (const match of source.matchAll(TOOLTIP_TRIGGER)) {
        const block = match[1] ?? "";
        if (!block.includes("<Button")) {
          continue;
        }
        if (!block.includes(ICON_SIZE) && !ICON_CHILD.test(block)) {
          continue;
        }
        if (hasAccessibleName(block)) {
          continue;
        }
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file.slice(CLIENT_ROOT.length + 1)}:${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * `combobox` is one of the roles that does not take its name from its contents,
 * so a trigger reading "Light" or "Auto" on screen announces as nothing at all.
 * That makes it the same provably-wrong shape as the tooltip case above rather
 * than a judgment call: the author put a visible label there, and the one thing
 * it cannot do is name the control.
 *
 * Both spellings are covered because both are in use -- `SelectTrigger`, which
 * sets the role itself, and a `Button role="combobox"` driving a popover.
 */
const COMBOBOX_MARKER = /<SelectTrigger\b|role="combobox"/g;

/**
 * The opening tag containing `index`.
 *
 * Scanned rather than matched, because a JSX attribute list holds `>` twice
 * over: in the arrow of `onClick={() => …}`, and inside any braced expression.
 * A regex stopping at the first `>` truncates the tag and reports the attribute
 * it was looking for as absent.
 */
function openingTagAround(source: string, index: number) {
  const start = source.lastIndexOf("<", index);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const character = source[i];
    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (character === ">" && depth === 0 && source[i - 1] !== "=") {
      return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

describe("comboboxes", () => {
  it("carry a name, since the role takes none from its contents", () => {
    const offenders: string[] = [];

    for (const file of collectTsxFiles(CLIENT_ROOT)) {
      const source = readFileSync(file, "utf8");
      const seen = new Set<number>();

      for (const match of source.matchAll(COMBOBOX_MARKER)) {
        const tag = openingTagAround(source, match.index);
        const start = source.lastIndexOf("<", match.index);
        if (seen.has(start)) {
          continue;
        }
        seen.add(start);

        // An `id` is how the triggers named by a sibling <Label> spell it, and
        // a <button> is labelable, so that genuinely does name them.
        if (hasAccessibleName(tag) || /\bid=/.test(tag)) {
          continue;
        }
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file.slice(CLIENT_ROOT.length + 1)}:${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
