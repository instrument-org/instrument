import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it.each([
    ["max-h-96", "max-h-none", "max-h-none"],
    ["max-h-none", "max-h-96", "max-h-96"],
    ["max-h-[300px]", "max-h-none", "max-h-none"],
    ["max-h-none", "max-h-[calc(100vh-2rem)]", "max-h-[calc(100vh-2rem)]"],
  ])("resolves %s + %s to %s", (base, override, expected) => {
    expect(cn(base, override)).toBe(expected);
  });

  it("leaves unrelated utilities alone while resolving max-h", () => {
    expect(
      cn("max-h-[300px] overflow-y-auto", "max-h-none min-h-0 flex-1"),
    ).toBe("overflow-y-auto max-h-none min-h-0 flex-1");
  });
});
