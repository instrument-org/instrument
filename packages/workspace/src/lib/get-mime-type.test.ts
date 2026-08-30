import { describe, expect, it } from "vitest";

import { getMimeType } from "./get-mime-type";

describe("getMimeType", () => {
  it("resolves .wasm to application/wasm so WebAssembly.instantiateStreaming accepts a served module", () => {
    expect(getMimeType("module.wasm")).toBe("application/wasm");
  });

  it("keeps the source-file overrides ahead of the mime database", () => {
    expect(getMimeType("main.ts")).toBe("text/typescript");
    expect(getMimeType("main.rs")).toBe("text/plain");
  });
});
