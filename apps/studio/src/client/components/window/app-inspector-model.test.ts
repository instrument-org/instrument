import { describe, expect, it } from "vitest";

import {
  childrenOf,
  detailRead,
  isBare,
  isLink,
  isListAnswer,
  labelOf,
  languageOf,
  listsFirst,
  looksLikeCode,
  parseSequence,
  recordsOf,
  splitCode,
  summaryOf,
  titleOf,
  type Tool,
} from "./app-inspector-model";

/** A tool as `apps.inspect` lists it: a read, with the parameters given. */
function read(
  name: string,
  params: Tool["params"] = [],
  extra: Partial<Tool> = {},
): Tool {
  return { description: "", isRead: true, name, params, ...extra };
}

function required(name: string, description?: string): Tool["params"][number] {
  return { description, name, required: true, type: "string" };
}

describe("parseSequence", () => {
  it("splits JSON values written back to back", () => {
    expect(
      parseSequence('{"file":{"id":"a"}}\n{"fileName":"Scratchpad","n":2}'),
    ).toEqual([{ file: { id: "a" } }, { fileName: "Scratchpad", n: 2 }]);
  });

  it("keeps braces inside strings, escaped quotes included", () => {
    expect(parseSequence('{"a":"{x} \\"}\\""} ["]"]')).toEqual([
      { a: '{x} "}"' },
      ["]"],
    ]);
  });

  it.each([
    ["one value, which parse reads on its own", '{"a":1}'],
    ["prose", "Currently selected nodes: none"],
    ["prose between values", '{"a":1} and {"b":2}'],
    ["a value that does not parse", '{"a":} {"b":2}'],
  ])("gives nothing for %s", (_case, text) => {
    expect(parseSequence(text)).toBeUndefined();
  });
});

describe("isListAnswer and recordsOf", () => {
  it.each([
    ["an array of objects", [{ id: "1" }, { id: "2" }], true, 2],
    ["an empty page wrapped in paging", { results: [] }, true, 0],
    ["a page of results under a key", { nodes: [{ nodeId: "1:2" }] }, true, 1],
    ["a record", { name: "Neutrals/Gray/900" }, false, 1],
    ["an array of plain values", ["a", "b"], true, 2],
    ["a string", "hello", false, 1],
  ])("reads %s", (_case, value, isList, count) => {
    expect(isListAnswer(value)).toBe(isList);
    expect(recordsOf(value)).toHaveLength(count);
  });

  it("wraps plain values so every row is a record", () => {
    expect(recordsOf(["a"])).toEqual([{ value: "a" }]);
  });
});

describe("titleOf", () => {
  it.each([
    ["a title", { id: "x", title: "Private Agent Docs" }, "Private Agent Docs"],
    ["a name before an id", { id: "x", name: "inbox" }, "inbox"],
    [
      "a field named as a kind of name",
      { nodeId: "1:2", nodeName: "Frame" },
      "Frame",
    ],
    [
      "an id when nothing names it",
      { flagged: false, id: "345F-7A" },
      "345F-7A",
    ],
    ["the first words when nothing else does", { count: 3, note: "hi" }, "hi"],
    [
      "the first key when it holds no words",
      { current_tool_access: {} },
      "current tool access",
    ],
    ["an empty record", {}, "Empty"],
  ])("takes %s", (_case, record, expected) => {
    expect(titleOf(record)).toBe(expected);
  });
});

describe("detailRead", () => {
  it("fills an id-shaped parameter from the row's id (Drafts)", () => {
    const source = read("drafts_get_drafts");
    const reads = [
      source,
      read("drafts_get_draft", [required("uuid", "The UUID of the draft")]),
      read("drafts_search", [required("query", "The search query")]),
    ];
    expect(
      detailRead(reads, source, { id: "345F", title: "Testing this out" }),
    ).toMatchObject({
      args: { uuid: "345F" },
      tool: { name: "drafts_get_draft" },
    });
  });

  it("fills a parameter that takes a url from the row's url (Notion)", () => {
    const source = read("notion-list-recent-pages");
    const reads = [
      source,
      read("notion-fetch", [
        required("id", "The ID or URL of the Notion page to fetch."),
      ]),
    ];
    expect(
      detailRead(reads, source, {
        title: "Private Agent Docs",
        url: "https://app.notion.com/p/3d48",
      }),
    ).toMatchObject({
      args: { id: "https://app.notion.com/p/3d48" },
      tool: { name: "notion-fetch" },
    });
  });

  it("guesses nothing from an id alone when the tools are about different things (Paper)", () => {
    const source = read("list_files");
    const reads = [
      source,
      read("find_nodes", [
        required("nodeId", "The id of the node to search under"),
      ]),
    ];
    expect(
      detailRead(reads, source, { id: "01KP", name: "Scratchpad" }),
    ).toBeUndefined();
  });

  it("takes a field named exactly as the parameter whatever the tools are called", () => {
    const source = read("list_things");
    const reads = [
      source,
      read("describe_widget", [required("workspaceName")]),
    ];
    expect(detailRead(reads, source, { workspaceName: "inbox" })).toMatchObject(
      { args: { workspaceName: "inbox" } },
    );
  });

  it("prefers the read that shares a noun with the list", () => {
    const source = read("drafts_list_tags");
    const reads = [
      source,
      read("drafts_get_workspace_drafts", [required("workspaceName")]),
      read("drafts_get_tag", [required("name")]),
    ];
    expect(detailRead(reads, source, { name: "reference" })).toMatchObject({
      tool: { name: "drafts_get_tag" },
    });
  });

  it("never picks a read that takes more than one required value", () => {
    const source = read("list_pages");
    const reads = [
      source,
      read("get_page", [required("id"), required("version")]),
    ];
    expect(detailRead(reads, source, { id: "1" })).toBeUndefined();
  });
});

describe("splitCode", () => {
  it("parts code from the instructions a server put after it (Figma)", () => {
    const text = [
      "export default function Frame() {",
      "  return (",
      "    <p>Hello</p>",
      "  );",
      "}",
      "SUPER CRITICAL: The generated code MUST be converted.",
      "1. Analyze the target codebase",
    ].join("\n");
    expect(splitCode(text)).toMatchInlineSnapshot(`
      {
        "code": "export default function Frame() {
        return (
          <p>Hello</p>
        );
      }",
        "prose": "SUPER CRITICAL: The generated code MUST be converted.
      1. Analyze the target codebase",
      }
    `);
  });

  it("keeps all of it as code when no sentence follows a closed block", () => {
    const text = "const a = 1;\nfunction b() {\n  return a;\n}";
    expect(splitCode(text)).toEqual({ code: text, prose: "" });
  });
});

describe("languageOf and looksLikeCode", () => {
  it.each([
    ["JSON", '{"a": 1}', "json"],
    ["TSX", "export default function A() {\n  return <div />;\n}", "tsx"],
    ["markup", '<text id="1" name="Frame" />', "html"],
    ["TypeScript", "const a = 1;\nexport { a };", "typescript"],
    ["prose", "Currently selected nodes", undefined],
  ])("guesses %s", (_case, code, expected) => {
    expect(languageOf(code)).toBe(expected);
  });

  it.each([
    ["a module", "import a from 'a';\nconst b = a;\nexport { b };\n", true],
    ["a short answer", "Scratchpad", false],
    ["a paragraph", "One.\nTwo.\nThree.\nFour.", false],
    ["a very long line among others", `a\nb\nc\n${"x".repeat(200)}`, true],
  ])("reads %s", (_case, text, expected) => {
    expect(looksLikeCode(text)).toBe(expected);
  });
});

describe("tool names and order", () => {
  it.each([
    [
      "the server's own title",
      read("get_design_context", [], { title: "Design context" }),
      "Design context",
    ],
    [
      "the name less the app's prefix",
      read("notion-list-recent-pages"),
      "List recent pages",
    ],
    ["a two-word name whole", read("get_screenshot"), "Get screenshot"],
  ])("labels a tool by %s", (_case, tool, expected) => {
    expect(labelOf(tool)).toBe(expected);
  });

  it("puts lists first and keeps the rest in their order", () => {
    const tools = [read("get_selection"), read("list_files"), read("get_info")];
    expect(tools.toSorted(listsFirst).map((tool) => tool.name)).toEqual([
      "list_files",
      "get_selection",
      "get_info",
    ]);
  });

  it("counts a tool as bare only when nothing is required", () => {
    expect(isBare(read("a", [{ name: "limit", required: false }]))).toBe(true);
    expect(isBare(read("b", [required("id")]))).toBe(false);
  });
});

describe("childrenOf and summaryOf", () => {
  it("opens objects and arrays of objects, and leaves plain lists inline", () => {
    expect(childrenOf({ x: 0.5, y: 0.5 })).toEqual([
      ["x", 0.5],
      ["y", 0.5],
    ]);
    expect(childrenOf([{ name: "Smiley face" }])).toEqual([
      ["1", { name: "Smiley face" }],
    ]);
    expect(childrenOf(["a", "b"])).toBeUndefined();
    expect(childrenOf({})).toBeUndefined();
  });

  it.each([
    [
      "a named object",
      { id: "01KP", name: "Scratchpad" },
      2,
      "Scratchpad · 2 fields",
    ],
    ["an unnamed object", { tokens: "811c" }, 1, "1 field"],
    [
      "a list of named objects",
      [{ name: "Smiley face" }],
      1,
      "Smiley face (1)",
    ],
    [
      "a long list",
      [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }],
      4,
      "a, b, c, … (4)",
    ],
  ])("sums up %s", (_case, value, count, expected) => {
    expect(summaryOf(value, count)).toBe(expected);
  });
});

describe("isLink", () => {
  it.each([
    ["https://app.paper.design/file/01KP", true],
    ["drafts://open?uuid=345F", true],
    ["Scratchpad", false],
    ["https://a b", false],
  ])("reads %s", (value, expected) => {
    expect(isLink(value)).toBe(expected);
  });
});
