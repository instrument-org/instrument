import {
  Editor,
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { type EditorView } from "@milkdown/kit/prose/view";
import { beforeAll, describe, expect, it } from "vitest";

import { createDocSync } from "./doc-sync";

let parse: (markdown: string) => PMNode;
let serialize: (doc: PMNode) => string;
let view: EditorView;

// The editor's own parser and serializer, set up the way the session sets
// them: lists and rules serialized with `-`.
beforeAll(async () => {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-" as const,
        rule: "-" as const,
      }));
    })
    .use(commonmark)
    .use(gfm);
  await editor.create();
  editor.action((ctx) => {
    parse = ctx.get(parserCtx);
    serialize = ctx.get(serializerCtx);
    view = ctx.get(editorViewCtx);
  });
});

/**
 * The text a save writes over `disk` once the editor holds what `edited`
 * parses into, checked to mean exactly that.
 */
function save(disk: string, edited: string) {
  const sync = createDocSync({ parse, serialize, view: () => view });
  const text = sync.splicedBody(parse(edited), sync.loadDisk(disk, "1"));
  expect(parse(text).toJSON()).toEqual(parse(edited).toJSON());
  return text;
}

describe("splicedBody", () => {
  it("writes an untouched file back byte for byte", () => {
    const disk = "# Title\n\n* one\n    * nested\n* two\n";
    expect(save(disk, disk)).toBe(disk);
  });

  it("keeps a list's untouched items byte for byte when one item changes", () => {
    expect(
      save(
        "# Title\n\n* one\n    * nested\n* two\n* three\n\nAfter.\n",
        "# Title\n\n- one\n  - nested\n- TWO\n- three\n\nAfter.\n",
      ),
    ).toBe("# Title\n\n* one\n    * nested\n* TWO\n* three\n\nAfter.\n");
  });

  it.each([
    [
      "a nested item",
      "* one\n    * nested\n    * nested2\n* two\n",
      "- one\n  - NESTED\n  - nested2\n- two\n",
      "* one\n    * NESTED\n    * nested2\n* two\n",
    ],
    [
      "an item two levels down",
      "* a\n    * b\n        * c\n        * d\n* e\n",
      "- a\n  - b\n    - C\n    - d\n- e\n",
      "* a\n    * b\n        * C\n        * d\n* e\n",
    ],
    [
      "an item over a nested list",
      "* one\n    * nested\n* two\n",
      "- ONE\n  - nested\n- two\n",
      "* ONE\n    * nested\n* two\n",
    ],
    [
      "an added item",
      "* one\n* two\n",
      "- one\n- two\n- three\n",
      "* one\n* two\n* three\n",
    ],
    [
      "an added nested item",
      "* a\n    * b\n* e\n",
      "- a\n  - b\n  - new\n- e\n",
      "* a\n    * b\n    * new\n* e\n",
    ],
    [
      "a removed item",
      "* one\n* two\n* three\n",
      "- one\n- three\n",
      "* one\n* three\n",
    ],
    [
      "a checked task",
      "* [ ] one\n* [ ] two\n",
      "- [x] one\n- [ ] two\n",
      "* [x] one\n* [ ] two\n",
    ],
    [
      "a loose list",
      "* one\n\n* two\n\n* three\n",
      "- one\n\n- TWO\n\n- three\n",
      "* one\n\n* TWO\n\n* three\n",
    ],
    [
      "an ordered list's numbers and delimiter",
      "3) one\n4) two\n5) three\n",
      "3. one\n4. TWO\n5. three\n",
      "3) one\n4) TWO\n5) three\n",
    ],
    [
      "a nested list in an ordered one",
      "1. a\n   * b\n2. c\n",
      "1. a\n   - B\n2. c\n",
      "1. a\n   * B\n2. c\n",
    ],
    [
      "an item holding a code block",
      "* a\n\n    ```js\n    x\n    ```\n* e\n",
      "- A\n\n  ```js\n  x\n  ```\n- e\n",
      "* A\n\n    ```js\n    x\n    ```\n* e\n",
    ],
    [
      "a list followed by its link definitions",
      "* one [x]\n* two\n\n[x]: http://a\n",
      "- one [x]\n- TWO\n\n[x]: http://a\n",
      "* one [x]\n* TWO\n\n[x]: http://a\n",
    ],
    [
      "two lists",
      "* a\n* b\n\npara\n\n* c\n* d\n",
      "- a\n- B\n\npara\n\n- c\n- D\n",
      "* a\n* B\n\npara\n\n* c\n* D\n",
    ],
  ])("writes %s in the list's own style", (_name, disk, edited, expected) => {
    expect(save(disk, edited)).toBe(expected);
  });
});
