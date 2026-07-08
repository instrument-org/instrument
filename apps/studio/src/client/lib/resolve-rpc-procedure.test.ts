import { describe, expect, it, vi } from "vitest";

import { resolveRpcProcedure } from "./resolve-rpc-procedure";

describe("resolveRpcProcedure", () => {
  it("resolves a nested procedure by dot path and forwards the call", async () => {
    const call = vi.fn().mockResolvedValue("ok");
    const root = { workspace: { debug: { replaySession: { call } } } };

    const procedure = resolveRpcProcedure(
      root,
      "workspace.debug.replaySession",
    );
    const result = await procedure.call({ id: "task-1" });

    expect(call).toHaveBeenCalledWith({ id: "task-1" });
    expect(result).toBe("ok");
  });

  it("throws on an empty path", () => {
    expect(() => resolveRpcProcedure({}, "")).toThrow(/invalid rpc path/i);
  });

  it("throws on an unknown path segment", () => {
    expect(() => resolveRpcProcedure({ a: {} }, "a.b")).toThrow(
      /unknown rpc path segment "b"/i,
    );
  });

  it("throws when the resolved node isn't callable", () => {
    expect(() => resolveRpcProcedure({ a: { b: {} } }, "a.b")).toThrow(
      /not a callable rpc procedure/i,
    );
  });

  it("throws when a path segment isn't an object", () => {
    expect(() => resolveRpcProcedure({ a: null }, "a.b")).toThrow(
      /unknown rpc path segment "b"/i,
    );
  });
});
