import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TOOLS } from "./all";

// The path of the first field the model would see without a description, or
// undefined when every leaf has one.
function missingDescription(
  schema: z.ZodType,
  path: string[] = [],
): string | undefined {
  if (schema.meta()?.description) {
    return undefined;
  }
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape)
      .filter(
        (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
      )
      .map(([key, value]) => missingDescription(value, [...path, key]))
      .find(Boolean);
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    return schema.options
      .map((option) =>
        missingDescription(option as z.ZodType, [...path, "option"]),
      )
      .find(Boolean);
  }
  return path.join(".") || "root";
}

describe("TOOLS", () => {
  it.each(
    Object.entries(TOOLS).filter(([_, tool]) => tool.name !== "unavailable"),
  )("describes every input field of %s", (_, tool) => {
    expect(missingDescription(tool.inputSchema)).toBeUndefined();
  });
});
