import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  TOOL_ACTIVITY_PARAM_NAME,
  TOOL_EXPLANATION_PARAM_NAME,
} from "../constants";
import { BaseInputSchema, toolInputSchemaForLLM } from "./base";

const TestSchema = BaseInputSchema.extend({
  filePath: z.string().meta({ description: "path" }),
  optionalThing: z.boolean().optional(),
});

describe("toolInputSchemaForLLM", () => {
  it.each([
    { filePath: "/tmp/x" },
    { explanation: "Reading the file", filePath: "/tmp/x" },
  ])("accepts input with or without its labels: %o", async (input) => {
    const result = await toolInputSchemaForLLM(TestSchema).validate?.(input);
    expect(result).toEqual({ success: true, value: input });
  });

  it("rejects inputs with wrong types on other fields", async () => {
    const result = await toolInputSchemaForLLM(TestSchema).validate?.({
      filePath: 123,
    });
    expect(result?.success).toBe(false);
  });

  it("advertises the activity and explanation as required, ahead of the schema's own", async () => {
    const json = await asSchema(toolInputSchemaForLLM(TestSchema)).jsonSchema;
    expect(json.required).toEqual([
      TOOL_ACTIVITY_PARAM_NAME,
      TOOL_EXPLANATION_PARAM_NAME,
      "filePath",
    ]);
  });

  it("does not repeat a label the schema already requires", async () => {
    const schema = z.object({
      filePath: z.string(),
      [TOOL_EXPLANATION_PARAM_NAME]: z.string(),
    });
    const json = await asSchema(toolInputSchemaForLLM(schema)).jsonSchema;
    expect(json.required).toEqual(["filePath", TOOL_EXPLANATION_PARAM_NAME]);
  });

  it("leaves schemas without label fields untouched", async () => {
    const json = await asSchema(
      toolInputSchemaForLLM(z.object({ foo: z.string() })),
    ).jsonSchema;
    expect(json.required).toEqual(["foo"]);
  });
});
