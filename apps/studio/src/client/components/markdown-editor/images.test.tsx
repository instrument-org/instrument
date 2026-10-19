import { Editor, parserCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { beforeAll, describe, expect, it } from "vitest";

import { imageOfTag, imageTags, imageWidth } from "./images";

let parse: (markdown: string) => PMNode;
let serialize: (doc: PMNode) => string;

beforeAll(async () => {
  const editor = Editor.make()
    .use(commonmark)
    .use(gfm)
    .use(imageTags)
    .use(imageWidth);
  await editor.create();
  editor.action((ctx) => {
    parse = ctx.get(parserCtx);
    serialize = ctx.get(serializerCtx);
  });
});

/** The first image in `doc`, by its attributes, or the first inline HTML's value. */
function firstInline(doc: PMNode) {
  let found: unknown;
  doc.descendants((node) => {
    if (
      found === undefined &&
      (node.type.name === "image" || node.type.name === "html")
    ) {
      found = { [node.type.name]: node.attrs };
    }
  });
  return found;
}

describe("imageOfTag", () => {
  it.each([
    ['<img src="a.png">', { alt: "", src: "a.png", title: "", width: null }],
    [
      "<img src='a b.png' alt=\"A &amp; B\" width=300 />",
      { alt: "A & B", src: "a b.png", title: "", width: 300 },
    ],
    [
      '<img src="a.png" width="120px">',
      { alt: "", src: "a.png", title: "", width: 120 },
    ],
    ['<img src="a.png" style="float: left">', undefined],
    ['<img src="a.png" width="50%">', undefined],
    ['<img alt="no source">', undefined],
    ['<img src="a.png"><img src="b.png">', undefined],
  ])("%s", (html, expected) => {
    expect(imageOfTag(html)).toEqual(expected);
  });
});

describe("a picture's width", () => {
  it.each([
    '<img src="a%20b.png" width="300">\n',
    'Hi <img src="a.png" alt="x" width="30"> there\n',
    "![plain](a.png)\n",
  ])("reads %j as a picture and writes it back the same", (markdown) => {
    const doc = parse(markdown);
    expect(firstInline(doc)).toHaveProperty("image");
    expect(serialize(doc)).toBe(markdown);
  });

  it("leaves an <img> tag that says more than a picture can as HTML", () => {
    const doc = parse('<img src="a.png" style="float: left">\n');
    expect(firstInline(doc)).toHaveProperty("html");
  });

  it("writes a picture given a width as an <img> tag, and one without as Markdown", () => {
    const doc = parse("![A cat](cat.png)\n");
    let pos = -1;
    doc.descendants((node, at) => {
      if (node.type.name === "image") {
        pos = at;
      }
    });
    const image = doc.nodeAt(pos);
    if (!image) {
      throw new Error("no image");
    }
    const sized = doc.type.schema.node("doc", null, [
      doc.type.schema.node("paragraph", null, [
        image.type.create({ ...image.attrs, width: 240 }),
      ]),
    ]);
    expect(serialize(sized)).toBe(
      '<img src="cat.png" alt="A cat" width="240">\n',
    );
    expect(serialize(parse(serialize(sized)))).toBe(serialize(sized));
  });
});
