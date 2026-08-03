import { afterEach, describe, expect, it, vi } from "vitest";

// The chunk is fetched over the network in production. Caching the promise is
// what stops every diagram on screen from fetching it separately — but caching
// a *rejected* one would mean a single dropped fetch left every fence in the
// session as a code block, unrecoverable short of restarting the app.
//
// A `.tsx` file with no JSX in it, because that is how a test here asks for a
// DOM: rendering reads the app's palette off the document, so `renderMermaid`
// cannot run in the node environment its neighbors in `mermaid.test.ts` use.

describe("renderMermaid chunk loading", () => {
  afterEach(() => {
    vi.doUnmock("mermaid");
    vi.resetModules();
  });

  const fakeMermaid = () => ({
    default: {
      initialize: vi.fn(),
      parse: vi.fn().mockResolvedValue(true),
      render: vi
        .fn()
        .mockImplementation((id: string) => ({ svg: `<svg id="${id}" />` })),
    },
  });

  it("fetches again after a failed load instead of caching the failure", async () => {
    let attempts = 0;
    vi.doMock("mermaid", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Failed to fetch dynamically imported module");
      }
      return fakeMermaid();
    });
    vi.resetModules();

    const { renderMermaid } = await import("./mermaid");
    const render = () => renderMermaid({ code: "graph TD", theme: "light" });

    // Vitest rewrites a throwing mock factory's message, so this asserts the
    // rejection rather than its text.
    await expect(render()).rejects.toThrow();
    // The whole point: the second diagram is not punished for the first
    // diagram's bad luck.
    await expect(render()).resolves.toContain("<svg");
    expect(attempts).toBe(2);
  });

  it("loads the chunk once when it succeeds", async () => {
    let attempts = 0;
    vi.doMock("mermaid", () => {
      attempts += 1;
      return fakeMermaid();
    });
    vi.resetModules();

    const { renderMermaid } = await import("./mermaid");
    await renderMermaid({ code: "graph TD", theme: "light" });
    await renderMermaid({ code: "graph LR", theme: "dark" });

    expect(attempts).toBe(1);
  });
});
