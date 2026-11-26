import { describe, expect, it } from "vitest";

import { measureStartup } from "../electron-builder/startup-bundle.ts";
import { startupProblems } from "./check-startup-bundle.ts";

function chunk(
  fileName: string,
  {
    css = [],
    facade = null,
    imports = [],
    isEntry = false,
    modules = {},
  }: {
    css?: string[];
    facade?: null | string;
    imports?: string[];
    isEntry?: boolean;
    modules?: Record<string, number>;
  },
) {
  return {
    code: "x".repeat(
      Object.values(modules).reduce((sum, length) => sum + length, 0),
    ),
    facadeModuleId: facade,
    fileName,
    imports,
    isEntry,
    modules: Object.fromEntries(
      Object.entries(modules).map(([id, renderedLength]) => [
        id,
        { renderedLength },
      ]),
    ),
    type: "chunk" as const,
    viteMetadata: { importedCss: new Set(css) },
  };
}

const bundle = {
  "app.css": { fileName: "app.css", source: "body{}", type: "asset" as const },
  "editor.js": chunk("editor.js", {
    modules: { "/repo/node_modules/katex/katex.js": 50 },
  }),
  "entry.js": chunk("entry.js", {
    css: ["app.css"],
    imports: ["shared.js", "just-bash"],
    isEntry: true,
    modules: { "/repo/apps/studio/src/main.ts": 10 },
  }),
  "shared.js": chunk("shared.js", {
    modules: {
      "/repo/node_modules/.pnpm/react@19/node_modules/react/index.js": 20,
      "/repo/packages/shared/src/index.ts": 5,
    },
  }),
};

describe("measureStartup", () => {
  it("follows static imports from the entries, leaving lazy chunks out", () => {
    // Shaped as Rolldown's bundle for the fields measured; the rest is unread.
    const startup = measureStartup(bundle as never);
    expect(startup).toMatchInlineSnapshot(`
      {
        "bytes": 41,
        "externals": [
          "just-bash",
        ],
        "files": [
          "app.css",
          "entry.js",
          "shared.js",
        ],
        "packages": {
          "(app)": 10,
          "@instrument-org/shared": 5,
          "react": 20,
        },
      }
    `);
  });

  it("starts from the roots it is given instead of the entries", () => {
    const startup = measureStartup(
      {
        ...bundle,
        "editor.js": { ...bundle["editor.js"], facadeModuleId: "/editor.ts" },
      } as never, // As above.
      [/editor\.ts$/],
    );
    expect(startup.files).toEqual(["editor.js"]);
  });
});

describe("startupProblems", () => {
  const startup = {
    bytes: 3 * 1024 * 1024,
    externals: ["just-bash"],
    files: ["entry.js"],
    packages: { "(app)": 2 * 1024 * 1024, katex: 1024 * 1024 },
  };

  it("names a budget overrun and each banned package", () => {
    expect(
      startupProblems("renderer", startup, {
        banned: ["katex", "just-bash", "mermaid"],
        budgetBytes: 2 * 1024 * 1024,
      }),
    ).toMatchInlineSnapshot(`
      [
        "renderer: 3.00 MB loads at startup, over its 2.00 MB budget. Largest: (app) 2.00 MB, katex 1.00 MB.",
        "renderer: katex loads at startup. Import it with \`import()\` where it is first used.",
        "renderer: just-bash loads at startup. Import it with \`import()\` where it is first used.",
      ]
    `);
  });

  it("passes a startup path inside its budget with nothing banned on it", () => {
    expect(
      startupProblems("main", startup, {
        banned: ["mermaid"],
        budgetBytes: 4 * 1024 * 1024,
      }),
    ).toEqual([]);
  });
});
