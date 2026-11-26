// A Vite plugin that gives the project icon set (`project-icons.ts`) only the
// fill drawing of each Phosphor icon, the one weight a project's mark and
// its picker draw. A Phosphor icon module carries all six weights, so the few
// hundred icons in the set would otherwise put about a megabyte on every
// window's startup path. The rest of the app imports Phosphor as it is.

import type { Plugin } from "vite";

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const IMPORTER = /[/\\]components[/\\]window[/\\]project-icons\.ts$/;
const ICON = /^@phosphor-icons\/react\/(\w+)$/;
const PREFIX = "\0project-icon-fill:";

type Element = {
  props: { children?: unknown } & Record<string, unknown>;
  type: unknown;
};

/** `createElement` calls that draw `element`, a Fragment's children in its place. */
function drawing(element: Element, fragment: unknown): string[] {
  const { children, ...props } = element.props;
  const inner = (
    Array.isArray(children)
      ? children
      : children === undefined
        ? []
        : [children]
  ).flatMap((child) => drawing(child as Element, fragment)); // React elements from Phosphor's own drawings.
  if (element.type === fragment) {
    return inner;
  }
  return [
    `h(${JSON.stringify(element.type)}, ${JSON.stringify(props)}${inner.map((each) => `, ${each}`).join("")})`,
  ];
}

export function projectIconFill(): Plugin {
  const require = createRequire(import.meta.url);
  const defsDir = path.join(
    path.dirname(require.resolve("@phosphor-icons/react/package.json")),
    "dist/defs",
  );
  return {
    // Ahead of Vite's resolver, which would otherwise take the import first.
    enforce: "pre",
    async load(id) {
      if (!id.startsWith(PREFIX)) {
        return null;
      }
      const name = id.slice(PREFIX.length);
      const { Fragment } = (await import(
        pathToFileURL(require.resolve("react", { paths: [defsDir] })).href
      )) as { Fragment: unknown };
      const { default: weights } = (await import(
        pathToFileURL(path.join(defsDir, `${name}.es.js`)).href
      )) as { default: Map<string, Element> }; // Phosphor's drawings by weight.
      const fill = weights.get("fill");
      if (!fill) {
        this.error(`Phosphor's ${name} has no fill drawing`);
      }
      // Every weight asked for draws the fill, the only one this set keeps.
      return [
        `import { createElement as h, forwardRef, Fragment } from "react";`,
        `import IconBase from "@phosphor-icons/react/dist/lib/IconBase";`,
        `const fill = h(Fragment, null, ${drawing(fill, Fragment).join(", ")});`,
        `const weights = { get: () => fill };`,
        `export const ${name}Icon = forwardRef((props, ref) => h(IconBase, { ref, ...props, weights }));`,
        `${name}Icon.displayName = ${JSON.stringify(`${name}Icon`)};`,
      ].join("\n");
    },
    name: "project-icon-fill",
    resolveId(source, importer) {
      const name = ICON.exec(source)?.[1];
      if (!name || !importer || !IMPORTER.test(importer)) {
        return null;
      }
      return `${PREFIX}${name}`;
    },
  };
}
