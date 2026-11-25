import { renderInBrowser } from "@/tests/render-browser";
import { beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { FolderRowCard } from "./file-preview-card";

type Size = { bytes: number; complete: boolean } | null;

const counts = new Map<string, null | number>();
const sizes = vi.fn<(input: { path: string }) => Promise<Size>>();

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    files: {
      folderItemCount: {
        call: ({ path }: { path: string }) =>
          Promise.resolve(counts.get(path) ?? null),
      },
      folderSize: { call: (input: { path: string }) => sizes(input) },
    },
  },
}));

beforeEach(() => {
  counts.clear();
  sizes.mockReset();
});

const card = (hostPath: string) => (
  <FolderRowCard
    hostPath={hostPath}
    key={hostPath}
    onClick={vi.fn()}
    path={`${hostPath}/`}
  />
);

test("says how many items the folder has and what they come to", async () => {
  counts.set("/Users/mac-user/Photos", 12);
  sizes.mockResolvedValue({ bytes: 31_000_000, complete: true });
  await renderInBrowser(
    <div style={{ width: 420 }}>{card("/Users/mac-user/Photos")}</div>,
  );

  await expect.element(page.getByText("12 items")).toBeVisible();
  await expect.element(page.getByText("· 31 MB")).toBeVisible();
});

test("leaves out a size the walk could only floor", async () => {
  counts.set("/Users/mac-user/Library", 3);
  sizes.mockResolvedValue({ bytes: 5_000_000, complete: false });
  const { container } = await renderInBrowser(
    <div style={{ width: 420 }}>{card("/Users/mac-user/Library")}</div>,
  );

  await expect.element(page.getByText("3 items")).toBeVisible();
  await vi.waitFor(() => {
    expect(sizes).toHaveBeenCalledTimes(1);
  });
  expect(container.querySelector("[data-slot=file-size]")).toBeNull();
});

test("says a folder with nothing in it is empty, and one item in the singular", async () => {
  counts.set("/Users/mac-user/Empty", 0);
  counts.set("/Users/mac-user/One", 1);
  sizes.mockResolvedValue({ bytes: 10, complete: true });
  await renderInBrowser(
    <div style={{ width: 420 }}>
      {card("/Users/mac-user/Empty")}
      {card("/Users/mac-user/One")}
    </div>,
  );

  await expect.element(page.getByText("Empty folder")).toBeVisible();
  await expect.element(page.getByText("1 item", { exact: true })).toBeVisible();
});

test("walks two folders at a time however many cards are up", async () => {
  const finishes: (() => void)[] = [];
  sizes.mockImplementation(
    () =>
      new Promise<Size>((resolve) => {
        finishes.push(() => {
          resolve({ bytes: 1000, complete: true });
        });
      }),
  );
  const paths = Array.from(
    { length: 6 },
    (_, at) => `/Users/mac-user/F${String(at)}`,
  );
  for (const path of paths) {
    counts.set(path, 1);
  }
  await renderInBrowser(<div style={{ width: 420 }}>{paths.map(card)}</div>);

  await vi.waitFor(() => {
    expect(sizes).toHaveBeenCalledTimes(2);
  });
  finishes.shift()?.();
  await vi.waitFor(() => {
    expect(sizes).toHaveBeenCalledTimes(3);
  });
  for (let at = 0; at < 6; at += 1) {
    finishes.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await vi.waitFor(() => {
    expect(sizes).toHaveBeenCalledTimes(6);
  });
});
