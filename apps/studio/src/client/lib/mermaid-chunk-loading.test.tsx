import { afterEach, describe, expect, it, vi } from "vitest";

// The renderer is fetched over the network in production. Caching the promise
// is what stops every diagram on screen from fetching it separately — but
// caching a *rejected* one would mean a single dropped fetch left every fence
// in the session as a code block, unrecoverable short of restarting the app.
//
// A `.tsx` file with no JSX in it, because that is how a test here asks for a
// DOM: DOMPurify, which loads beside pele, sanitizes against the window it
// finds, so the loader is tested where there is one.

describe("loadDiagram chunk loading", () => {
  afterEach(() => {
    vi.doUnmock("pele/lazy");
    vi.resetModules();
  });

  const fakePele = () => ({
    detectType: vi.fn().mockReturnValue("flowchart"),
    load: vi.fn().mockResolvedValue(true),
    mount: vi.fn(),
    parse: vi.fn(),
  });

  it("fetches again after a failed load instead of caching the failure", async () => {
    let attempts = 0;
    vi.doMock("pele/lazy", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Failed to fetch dynamically imported module");
      }
      return fakePele();
    });
    vi.resetModules();

    const { loadDiagram } = await import("./mermaid");
    const load = () => loadDiagram("graph TD\n  A --> B");

    // Vitest rewrites a throwing mock factory's message, so this asserts the
    // rejection rather than its text.
    await expect(load()).rejects.toThrow();
    // The whole point: the second diagram is not punished for the first
    // diagram's bad luck.
    await expect(load()).resolves.toBeTypeOf("function");
    expect(attempts).toBe(2);
  });

  it("loads the chunk once when it succeeds", async () => {
    let attempts = 0;
    vi.doMock("pele/lazy", () => {
      attempts += 1;
      return fakePele();
    });
    vi.resetModules();

    const { loadDiagram } = await import("./mermaid");
    await loadDiagram("graph TD\n  A --> B");
    await loadDiagram("graph LR\n  A --> B");

    expect(attempts).toBe(1);
  });
});
