import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  BaseInputSchema,
  TOOL_EXPLANATION_PARAM_NAME,
  toolInputSchemaForLLM,
} from "./base";

const TestSchema = BaseInputSchema.extend({
  filePath: z.string().meta({ description: "path" }),
  optionalThing: z.boolean().optional(),
});

describe("toolInputSchemaForLLM", () => {
  it("validates inputs that omit explanation", async () => {
    const wrapped = toolInputSchemaForLLM(TestSchema);
    const result = await wrapped.validate?.({ filePath: "/tmp/x" });
    expect(result).toEqual({
      success: true,
      value: { filePath: "/tmp/x" },
    });
  });

  it("validates inputs that include explanation", async () => {
    const wrapped = toolInputSchemaForLLM(TestSchema);
    const result = await wrapped.validate?.({
      explanation: "Reading the file",
      filePath: "/tmp/x",
    });
    expect(result).toEqual({
      success: true,
      value: { explanation: "Reading the file", filePath: "/tmp/x" },
    });
  });

  it("rejects inputs with wrong types on other fields", async () => {
    const wrapped = toolInputSchemaForLLM(TestSchema);
    const result = await wrapped.validate?.({ filePath: 123 });
    expect(result?.success).toBe(false);
  });

  it("emits a JSON schema with explanation marked required, via asSchema()", async () => {
    const wrapped = toolInputSchemaForLLM(TestSchema);
    const aiSdkSchema = asSchema(wrapped);
    const json = await aiSdkSchema.jsonSchema;
    expect(json.required).toContain(TOOL_EXPLANATION_PARAM_NAME);
    expect(json.required).toContain("filePath");
    expect(json.required).not.toContain("optionalThing");
    expect(json.properties?.[TOOL_EXPLANATION_PARAM_NAME]).toBeDefined();
  });

  it("does not duplicate explanation if it is already required", async () => {
    const schema = z.object({
      filePath: z.string(),
      [TOOL_EXPLANATION_PARAM_NAME]: z.string(),
    });
    const wrapped = toolInputSchemaForLLM(schema);
    const json = await asSchema(wrapped).jsonSchema;
    const occurrences = (json.required ?? []).filter(
      (key) => key === TOOL_EXPLANATION_PARAM_NAME,
    ).length;
    expect(occurrences).toBe(1);
  });

  it("leaves schemas without an explanation field untouched", async () => {
    const schema = z.object({ foo: z.string() });
    const wrapped = toolInputSchemaForLLM(schema);
    const json = await asSchema(wrapped).jsonSchema;
    expect(json.required).toEqual(["foo"]);
  });
});
