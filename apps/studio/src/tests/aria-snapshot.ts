import { commands, type Locator } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    ariaSnapshot: (selector: string) => Promise<string>;
  }
}

/**
 * The accessibility tree under `target`, as the YAML Playwright serializes it
 * to: one `- role "accessible name"` line per node, nested by structure.
 *
 * What it is for is asserting on structure without asserting on pixels. Classes,
 * wrapper elements and DOM order do not appear, so a snapshot survives a
 * refactor that a rendered-HTML assertion would not, while still failing on the
 * things that change what the UI *is* -- a control that lost its label, a
 * heading that changed level, a list that gained a row.
 *
 * It is also the honest test for an icon-only control. A button labeled only
 * by its tooltip has no accessible name, so it arrives here as a bare
 * `- button`: the same nothing a screen reader gets, and the same nothing a
 * script driving the app has to guess its way around.
 *
 * Pair it with `toMatchInlineSnapshot` so the tree stays visible in the test.
 * Note that this reads the tree once rather than polling for it, so await
 * whatever is still arriving before calling it.
 */
export function ariaSnapshot(target: Locator | string): Promise<string> {
  return commands.ariaSnapshot(
    typeof target === "string" ? target : target.selector,
  );
}
