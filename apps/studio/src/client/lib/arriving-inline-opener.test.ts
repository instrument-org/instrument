import { describe, expect, it } from "vitest";

import { withoutArrivingInlineOpener } from "./arriving-inline-opener";

describe("withoutArrivingInlineOpener", () => {
  it.each([
    { block: "Then run `", shown: "Then run " },
    { block: "`", shown: "" },
    { block: "Use `a` and ``", shown: "Use `a` and " },
    { block: "**Run `", shown: "**Run " },
    { block: "Then run `pnpm fix`", shown: "Then run `pnpm fix`" },
    { block: "Then run `pnpm", shown: "Then run `pnpm" },
    { block: "Use ``a ` b``", shown: "Use ``a ` b``" },
    { block: "```", shown: "```" },
    { block: "```ts\nconst x = 1;\n```", shown: "```ts\nconst x = 1;\n```" },
    { block: "Then a **", shown: "Then a " },
    { block: "Then a *", shown: "Then a " },
    { block: "Then a _", shown: "Then a " },
    { block: "Then a ~~", shown: "Then a " },
    { block: "One.\n**", shown: "One.\n" },
    { block: "Then a **bold**", shown: "Then a **bold**" },
    { block: "Then a **bold*", shown: "Then a **bold*" },
    { block: "snake_", shown: "snake_" },
    { block: "About ~", shown: "About ~" },
  ])("shows $block as $shown", ({ block, shown }) => {
    expect(withoutArrivingInlineOpener(block)).toBe(shown);
  });
});
