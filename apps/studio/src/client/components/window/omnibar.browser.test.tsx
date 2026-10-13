import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Omnibar } from "./omnibar";

// Every query stays pending: the field's own rows are what is under test.
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({ queryFn: pending, queryKey: path });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

// Nothing is at any path the field looks for.
vi.mock("@/client/lib/locate-typed-path", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/lib/locate-typed-path")>()),
  locateTypedPath: (path: { shown: string }) =>
    Promise.resolve({ kind: "missing", path: path.shown }),
}));

vi.mock("./context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context")>()),
  useWindow: () => ({ openPage: () => undefined }),
}));

// What a Return on a path found is the answer to that Return alone: the
// same words typed again later are a new ask, not the old answer.
describe("a path the field found nothing at", () => {
  it("says so until the words change, and not when they come back", async () => {
    await renderInBrowser(<Omnibar location={{ kind: "newTab" }} />);
    const field = page.getByRole("combobox");
    const notice = page.getByText("There’s nothing at “/nowhere/x”.");

    await userEvent.fill(field, "/nowhere/x");
    await userEvent.keyboard("{Enter}");
    await expect.element(notice).toBeVisible();

    await userEvent.fill(field, "/nowhere/");
    await expect.element(notice).not.toBeInTheDocument();
    await userEvent.fill(field, "/nowhere/x");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toHaveTextContent("/nowhere/x");
    await expect.element(notice).not.toBeInTheDocument();
  });
});
