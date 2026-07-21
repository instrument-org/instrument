import {
  BOOT_SHELL_ATTRIBUTES,
  BOOT_SHELL_COLORS,
  BOOT_SHELL_CSS_VARS,
  BOOT_SHELL_ELEMENT_IDS,
} from "@/shared/boot-shell";
import { SIDEBAR_WIDTH, TOOLBAR_HEIGHT } from "@/shared/constants";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// index.html paints the boot shell before any script or stylesheet loads, so it
// can't import anything: its ids, data attributes, colors, and geometry are
// literals. These check them against the constants the rest of the app uses, so
// renaming or restyling on either side fails here instead of silently leaving a
// shell that no longer resembles the app it precedes.

const html = fs.readFileSync(
  path.join(import.meta.dirname, "../index.html"),
  "utf8",
);
const globalsCss = fs.readFileSync(
  path.join(import.meta.dirname, "styles/globals.css"),
  "utf8",
);

describe("boot shell markup", () => {
  it.each(Object.values(BOOT_SHELL_ELEMENT_IDS))(
    "renders and styles #%s",
    (id) => {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`#${id} {`);
    },
  );

  it.each(Object.values(BOOT_SHELL_ATTRIBUTES))("selects on [%s]", (name) => {
    expect(html).toContain(`[${name}=`);
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

describe("boot shell colors", () => {
  it.each([
    { token: "--gray-50", value: BOOT_SHELL_COLORS.light.background },
    { token: "--gray-200", value: BOOT_SHELL_COLORS.light.border },
    { token: "--gray-200", value: BOOT_SHELL_COLORS.light.toolbar },
    { token: "--gray-900", value: BOOT_SHELL_COLORS.dark.background },
    { token: "--gray-800", value: BOOT_SHELL_COLORS.dark.toolbar },
  ])("matches globals.css $token", ({ token, value }) => {
    expect(readCssToken(token)).toBe(value);
  });

  // The dark border is a literal in globals.css's .dark block rather than a ramp
  // token, so it's checked by presence instead.
  it("matches the dark border in globals.css", () => {
    expect(globalsCss).toContain(BOOT_SHELL_COLORS.dark.border);
  });
});

function readCssToken(token: string) {
  return new RegExp(`${token}:\\s*([^;]+);`).exec(globalsCss)?.[1];
}
