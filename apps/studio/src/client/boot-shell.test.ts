import {
  BOOT_SHELL_ATTRIBUTES,
  BOOT_SHELL_CLASS_NAMES,
  BOOT_SHELL_COLORS,
  BOOT_SHELL_CSS_VARS,
  BOOT_SHELL_ELEMENT_IDS,
} from "@/shared/boot-shell";
import { SIDEBAR_WIDTH, TOOLBAR_HEIGHT } from "@/shared/constants";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// index.html paints the boot shell before any script or stylesheet loads, so it
// can't import anything: its ids, class names, data attributes, colors, icons,
// and geometry are literals. These check them against what the rest of the app
// uses, so renaming or restyling on either side fails here instead of silently
// leaving a shell that no longer resembles the app it precedes.

const html = fs.readFileSync(
  path.join(import.meta.dirname, "../index.html"),
  "utf8",
);
const globalsCss = fs.readFileSync(
  path.join(import.meta.dirname, "styles/globals.css"),
  "utf8",
);

// globals.css defines the semantic tokens twice, light then dark; the gray ramp
// is theme-independent and lives in the light scope.
const lightScope = globalsCss.slice(globalsCss.indexOf(":root {"));
const darkScope = globalsCss.slice(globalsCss.indexOf(".dark {"));

describe("boot shell markup", () => {
  it.each(Object.values(BOOT_SHELL_ELEMENT_IDS))(
    "renders and styles #%s",
    (id) => {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`#${id} {`);
    },
  );

  it.each(Object.values(BOOT_SHELL_CLASS_NAMES))(
    "renders and styles .%s",
    (className) => {
      expect(html).toContain(`class="${className}"`);
      expect(html).toContain(`.${className} {`);
    },
  );

  it.each(Object.values(BOOT_SHELL_ATTRIBUTES))("selects on [%s]", (name) => {
    expect(html).toContain(`[${name}`);
  });

  it.each(Object.values(BOOT_SHELL_CSS_VARS))("consumes var(%s)", (name) => {
    expect(html).toContain(`var(${name}`);
  });

  // The vars are only set once boot-shell.ts runs, so the fallbacks are what the
  // first painted frame uses.
  it.each([
    {
      expected: `${TOOLBAR_HEIGHT}px`,
      name: BOOT_SHELL_CSS_VARS.toolbarHeight,
    },
    { expected: `${SIDEBAR_WIDTH}px`, name: BOOT_SHELL_CSS_VARS.sidebarWidth },
  ])("falls back to $expected for $name", ({ expected, name }) => {
    expect(html).toContain(`var(${name}, ${expected})`);
  });

  it.each(
    Object.entries(BOOT_SHELL_COLORS).flatMap(([scheme, colors]) =>
      Object.entries(colors).map(([role, value]) => ({ role, scheme, value })),
    ),
  )("paints the $scheme $role as $value", ({ value }) => {
    expect(html).toContain(value);
  });
});

describe("boot shell icons", () => {
  // The toolbar renders these through an IconContext pinned to `bold`
  // (main-window.tsx), so the shell has to draw the same weight.
  it.each([
    { Icon: SidebarSimpleIcon, name: "SidebarSimple" },
    { Icon: ArrowLeftIcon, name: "ArrowLeft" },
    { Icon: ArrowRightIcon, name: "ArrowRight" },
  ])("draws $name as the icon component does", ({ Icon }) => {
    const paths = readPathData(
      renderToStaticMarkup(createElement(Icon, { weight: "bold" })),
    );

    expect(paths.length).toBeGreaterThan(0);
    for (const data of paths) {
      expect(html).toContain(data);
    }
  });
});

describe("boot shell colors", () => {
  const { dark, light } = BOOT_SHELL_COLORS;

  // The toolbar is the one surface with no semantic token of its own: it is
  // `bg-gray-200 dark:bg-gray-800` in studio-toolbar.tsx, so it reads straight
  // off the ramp, which lives in the light scope for both schemes.
  it.each([
    { colors: light, role: "background", scope: lightScope, token: "--background" }, // prettier-ignore
    { colors: light, role: "foreground", scope: lightScope, token: "--foreground" }, // prettier-ignore
    { colors: light, role: "border", scope: lightScope, token: "--border" },
    { colors: light, role: "toolbar", scope: lightScope, token: "--gray-200" },
    { colors: dark, role: "background", scope: darkScope, token: "--background" }, // prettier-ignore
    { colors: dark, role: "foreground", scope: darkScope, token: "--foreground" }, // prettier-ignore
    { colors: dark, role: "border", scope: darkScope, token: "--border" },
    { colors: dark, role: "toolbar", scope: lightScope, token: "--gray-800" },
  ] as const)(
    "takes $role from globals.css $token",
    ({ colors, role, scope, token }) => {
      expect(readCssToken(token, scope)).toBe(colors[role]);
    },
  );
});

function readCssToken(token: string, scope: string): string | undefined {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(scope)?.[1]?.trim();
  const reference = value ? /^var\((--[\w-]+)\)$/.exec(value)?.[1] : undefined;

  // A semantic token points at a gray-ramp token, which is theme-independent.
  return reference ? readCssToken(reference, lightScope) : value;
}

function readPathData(markup: string) {
  return [...markup.matchAll(/ d="([^"]+)"/g)].map(([, data]) => data);
}
