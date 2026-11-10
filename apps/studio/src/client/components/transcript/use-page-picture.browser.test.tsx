import { renderInBrowser } from "@/tests/render-browser";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePagePicture } from "./use-page-picture";

type Picture = { page?: string; url: null | string };

// The main process's two answers, each settled by the test when it likes.
const rpc = vi.hoisted(() => ({
  capture:
    vi.fn<
      (input: { key: string; webContentsId: number }) => Promise<Picture>
    >(),
  get: vi.fn<(input: { key: string }) => Promise<Picture>>(),
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    browser: {
      thumbnails: { capture: { call: rpc.capture }, get: { call: rpc.get } },
    },
  },
}));

// The window's guest for the tab, there or not as the test says.
const pool = vi.hoisted(() => ({
  guest: null as null | { on: () => () => void; webContentsId: number },
}));
vi.mock("@/client/lib/browser-pool", () => ({ getGuest: () => pool.guest }));
vi.mock("@/client/hooks/use-browser-targets", () => ({
  useBrowserTargets: () => new Set(["tab_01M6Y425TKVX7ETRAJ07DGTRNP"]),
  useGuest: () => pool.guest,
}));
// When an agent last worked in the page, moved by the test.
const activity = vi.hoisted(() => ({
  lastAt: undefined as number | undefined,
}));
vi.mock("@/client/hooks/use-target-agent-activity", () => ({
  useTargetAgentLastAt: () => activity.lastAt,
}));

const TAB = "tab_01M6Y425TKVX7ETRAJ07DGTRNP";
const GUEST = { on: () => () => undefined, webContentsId: 7 };

function Picture({ page }: { page?: string }) {
  const url = usePagePicture(TAB, browserTargetOf(TAB), page);
  return <output>{url ?? "none"}</output>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  activity.lastAt = undefined;
  pool.guest = null;
  rpc.capture.mockReset();
  rpc.get.mockReset();
});

describe("usePagePicture", () => {
  it("takes a picture once the guest is ready, with nothing else happening in the page", async () => {
    rpc.get.mockResolvedValue({ url: null });
    rpc.capture.mockResolvedValue({ url: "data:first" });
    pool.guest = GUEST;
    const view = await renderInBrowser(<Picture />);
    await expect
      .element(view.getByRole("status"))
      .toHaveTextContent("data:first");
  });

  it("keeps a picture taken while the kept one was still being read", async () => {
    const kept = deferred<Picture>();
    rpc.get.mockReturnValue(kept.promise);
    rpc.capture.mockResolvedValue({ url: "data:taken" });
    activity.lastAt = 1;
    pool.guest = GUEST;
    const view = await renderInBrowser(<Picture />);
    await expect.poll(() => rpc.capture.mock.calls.length).toBe(1);
    kept.resolve({ url: null });
    await expect
      .element(view.getByRole("status"))
      .toHaveTextContent("data:taken");
  });

  it("shows an older picture that worked when a newer one fails", async () => {
    rpc.get.mockResolvedValue({ url: null });
    const older = deferred<Picture>();
    rpc.capture
      .mockReturnValueOnce(older.promise)
      .mockResolvedValue({ url: null });
    activity.lastAt = 1;
    pool.guest = GUEST;
    const view = await renderInBrowser(<Picture />);
    await expect.poll(() => rpc.capture.mock.calls.length).toBe(1);
    // Another agent command asks again while the first is on its way, and that one fails.
    activity.lastAt = 2;
    await view.rerender(<Picture />);
    await expect
      .poll(() => rpc.capture.mock.calls.length, { timeout: 4000 })
      .toBeGreaterThanOrEqual(2);
    older.resolve({ url: "data:older" });
    await expect
      .element(view.getByRole("status"))
      .toHaveTextContent("data:older");
  });

  it("asks again while no picture could be taken", async () => {
    rpc.get.mockResolvedValue({ url: null });
    rpc.capture
      .mockResolvedValueOnce({ url: null })
      .mockResolvedValue({ url: "data:second" });
    // No agent command, so only the retry asks a second time.
    pool.guest = GUEST;
    const view = await renderInBrowser(<Picture />);
    await expect
      .element(view.getByRole("status"), { timeout: 4000 })
      .toHaveTextContent("data:second");
    expect(rpc.capture).toHaveBeenCalledTimes(2);
  });

  it("shows no picture of the page the tab has left until one of its new page arrives", async () => {
    const ONE = "https://one.example/";
    const TWO = "https://two.example/";
    rpc.get.mockResolvedValue({ page: ONE, url: "data:one" });
    const second = deferred<Picture>();
    rpc.capture.mockReturnValue(second.promise);
    pool.guest = GUEST;
    const view = await renderInBrowser(<Picture page={`${ONE}#top`} />);
    await expect
      .element(view.getByRole("status"))
      .toHaveTextContent("data:one");
    await view.rerender(<Picture page={TWO} />);
    await expect.element(view.getByRole("status")).toHaveTextContent("none");
    await expect.poll(() => rpc.capture.mock.calls.length).toBeGreaterThan(0);
    second.resolve({ page: TWO, url: "data:two" });
    await expect
      .element(view.getByRole("status"))
      .toHaveTextContent("data:two");
  });

  it("asks nothing more once the card is gone", async () => {
    rpc.get.mockResolvedValue({ url: null });
    const first = deferred<Picture>();
    rpc.capture.mockReturnValueOnce(first.promise);
    pool.guest = GUEST;
    const view = await renderInBrowser(<Picture />);
    await expect.poll(() => rpc.capture.mock.calls.length).toBe(1);
    await view.unmount();
    first.resolve({ url: null });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(rpc.capture).toHaveBeenCalledTimes(1);
  });
});
