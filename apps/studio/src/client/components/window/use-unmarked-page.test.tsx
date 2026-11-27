import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUnmarkedPage } from "./use-unmarked-page";

type Mark = "marked" | "missing" | "unmarked";

const { downloadMark, marks } = vi.hoisted(() => {
  const marks = new Map<string, Mark>();
  return {
    downloadMark: vi.fn(({ path }: { path: string }) =>
      Promise.resolve({ mark: marks.get(path) ?? "missing" }),
    ),
    marks,
  };
});

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { files: { downloadMark: { call: downloadMark } } },
}));

const PAGE = "/Users/mac-user/Dropbox/pricing.html";

function render(initial: { look: string; page: string | undefined }) {
  const onMarked = vi.fn();
  const hook = renderHook(
    (props: { look: string; page: string | undefined }) =>
      useUnmarkedPage({ ...props, onMarked }),
    { initialProps: initial },
  );
  return { ...hook, onMarked };
}

// A page a link named while nothing was there runs only once the file that
// lands there is found to carry no downloaded mark.
describe("useUnmarkedPage", () => {
  beforeEach(() => {
    marks.clear();
    downloadMark.mockClear();
  });

  it("draws a page that lands unmarked, as a sync or a local save leaves it", async () => {
    marks.set(PAGE, "unmarked");
    const { onMarked, result } = render({ look: "a", page: PAGE });
    expect(result.current).toBe(false);
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    expect(onMarked).not.toHaveBeenCalled();
  });

  it("never draws a page that lands marked, and hands it on", async () => {
    marks.set(PAGE, "marked");
    const { onMarked, result } = render({ look: "a", page: PAGE });
    await waitFor(() => {
      expect(onMarked).toHaveBeenCalledWith(PAGE);
    });
    expect(result.current).toBe(false);
  });

  it("takes an answer that never came as marked", async () => {
    downloadMark.mockImplementationOnce(() =>
      Promise.reject(new Error("gone")),
    );
    const { onMarked, result } = render({ look: "a", page: PAGE });
    await waitFor(() => {
      expect(onMarked).toHaveBeenCalledWith(PAGE);
    });
    expect(result.current).toBe(false);
  });

  it("waits while nothing is there, and asks again at the next look", async () => {
    const { onMarked, rerender, result } = render({ look: "a", page: PAGE });
    await waitFor(() => {
      expect(downloadMark).toHaveBeenCalledTimes(1);
    });
    expect(result.current).toBe(false);
    marks.set(PAGE, "unmarked");
    rerender({ look: "b", page: PAGE });
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    expect(onMarked).not.toHaveBeenCalled();
  });

  // An unmarked page that goes and comes back marked (deleted, then a site
  // saves one of the same name) is asked about again before it is drawn.
  it("stops drawing at a new look until the file there is asked about again", async () => {
    marks.set(PAGE, "unmarked");
    const { onMarked, rerender, result } = render({ look: "a", page: PAGE });
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    marks.set(PAGE, "marked");
    rerender({ look: "b", page: PAGE });
    expect(result.current).toBe(false);
    await waitFor(() => {
      expect(onMarked).toHaveBeenCalledWith(PAGE);
    });
    expect(result.current).toBe(false);
  });

  it("asks again when the page comes back after none was asked about", async () => {
    marks.set(PAGE, "unmarked");
    const { rerender, result } = render({ look: "a", page: PAGE });
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    rerender({ look: "a", page: undefined });
    expect(result.current).toBe(false);
    marks.set(PAGE, "marked");
    rerender({ look: "a", page: PAGE });
    expect(result.current).toBe(false);
    await waitFor(() => {
      expect(downloadMark).toHaveBeenCalledTimes(2);
    });
    expect(result.current).toBe(false);
  });

  it("asks nothing for a file that needs no asking", () => {
    const { result } = render({ look: "a", page: undefined });
    expect(result.current).toBe(false);
    expect(downloadMark).not.toHaveBeenCalled();
  });
});
