import { describe, expect, it } from "vitest";

import { highlightLines, syntaxLanguage } from "./syntax-highlight";

describe("syntaxLanguage", () => {
  it.each([
    ["ts", "TypeScript"],
    ["typescript", "TypeScript"],
    ["tsx", "TSX"],
    ["py", "Python"],
    ["python", "Python"],
    ["bash", "Shell"],
    ["shellscript", "Shell"],
    ["console", "Shell"],
    ["jsonc", "JSON"],
    ["md", "Markdown"],
    ["rs", "Rust"],
    ["yml", "YAML"],
    ["Dockerfile", "Dockerfile"],
    ["ps1", "PowerShell"],
    ["fish", "Shell"],
    ["elixir", "Elixir"],
    ["exs", "Elixir"],
    ["nix", "Nix"],
    ["sol", "Solidity"],
    ["svelte", "Svelte"],
  ])("reads %s as %s", (name, grammar) => {
    expect(syntaxLanguage(name)?.name).toBe(grammar);
  });

  it.each([["text"], ["plaintext"], ["no-such-language"], [""], [undefined]])(
    "has no grammar for %s",
    (name) => {
      expect(syntaxLanguage(name)).toBeUndefined();
    },
  );
});

describe("highlightLines", () => {
  it("marks each token with its kind, a line a span, and escapes the text", async () => {
    const lines = await highlightLines(
      'const big = a < b; // "x"\nreturn <T>(v: T) => v;',
      "ts",
    );
    expect(lines).toMatchInlineSnapshot(`
      [
        "<pre class="code-highlight" data-language="typescript"><code><span class="line"><span class="syntax-keyword">const</span> big <span class="syntax-keyword">=</span> a <span class="syntax-keyword">&lt;</span> b; <span class="syntax-comment">// "x"</span></span>",
        "<span class="line"><span class="syntax-keyword">return</span> &lt;<span class="syntax-entity">T</span>&gt;(v: <span class="syntax-entity">T</span>) =&gt; v;</span></code></pre>",
      ]
    `);
  });

  it("keeps a line per line of code, blank ones included", async () => {
    const lines = await highlightLines("a = 1\n\nb = 2\n", "python");
    expect(lines).toHaveLength(4);
  });

  it("names the grammar, which property colors are chosen by", async () => {
    const [first] = (await highlightLines('{ "a": 1 }', "json")) ?? [];
    expect(first).toMatch(/^<pre class="code-highlight" data-language="json">/);
  });

  it.each([
    ["elixir", 'defmodule Hello do\n  def hi, do: "hi"\nend'],
    ["nix", '{ pkgs }: pkgs.mkShell { name = "dev"; }'],
    ["solidity", "contract Box { uint256 value; }"],
    ["svelte", "<script>let count = 0;</script>\n<button>{count}</button>"],
  ])(
    "loads the community %s grammar and marks its tokens",
    async (language, code) => {
      const lines = await highlightLines(code, language);
      expect(lines?.join("\n")).toMatch(
        /class="syntax-(keyword|string|tag|constant)"/,
      );
    },
  );

  it("has nothing for a language with no grammar", async () => {
    expect(await highlightLines("hello", "text")).toBeUndefined();
  });
});
