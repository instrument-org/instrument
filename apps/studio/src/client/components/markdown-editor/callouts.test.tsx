import {
  Editor,
  editorViewCtx,
  parserCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { type EditorView } from "@milkdown/kit/prose/view";
import { beforeAll, expect, it } from "vitest";

import { keepCalloutMarkers } from "./callouts";
import { createDocSync } from "./doc-sync";

let parse: (markdown: string) => PMNode;
let serialize: (doc: PMNode) => string;
let view: EditorView;

beforeAll(async () => {
  const editor = Editor.make()
    .config(keepCalloutMarkers)
    .use(commonmark)
    .use(gfm);
  await editor.create();
  editor.action((ctx) => {
    parse = ctx.get(parserCtx);
    serialize = ctx.get(serializerCtx);
    view = ctx.get(editorViewCtx);
  });
});

/** The text a save writes over `disk` once the editor holds what `edited` parses into. */
function save(disk: string, edited: string) {
  const sync = createDocSync({ parse, serialize, view: () => view });
  return sync.splicedBody(parse(edited), sync.loadDisk(disk, "1"));
}

it.each([
  [
    "> [!NOTE]\n> Useful information.\n",
    "> [!NOTE]\n> Useful information, edited.\n",
  ],
  [
    "> [!warning] Heads up\n> Careful.\n",
    "> [!warning] Heads up\n> Careful here.\n",
  ],
])("keeps the marker of an edited callout as written: %j", (disk, edited) => {
  expect(save(disk, edited)).toBe(edited);
});

it("still escapes a bracket that is not a callout's marker", () => {
  expect(serialize(parse("> \\[!NOPE]\n> Text.\n"))).toBe(
    "> \\[!NOPE]\n> Text.\n",
  );
});
