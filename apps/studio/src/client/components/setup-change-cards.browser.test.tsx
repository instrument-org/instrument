import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { renderInBrowser } from "../../tests/render-browser";
import {
  AppChangesCard,
  MemoryChangesCard,
  SkillChangesCard,
} from "./setup-change-cards";

const { undoChanges } = vi.hoisted(() => ({
  undoChanges: vi.fn(() => Promise.resolve({ skipped: 0, undone: 2 })),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    apps: {
      live: {
        list: {
          experimental_liveOptions: () => ({
            queryFn: () => ({
              apps: [
                {
                  name: "Zendesk",
                  site: "zendesk.com",
                  slug: "zendesk",
                  status: "needs-sign-in",
                },
              ],
            }),
            queryKey: ["apps"],
          }),
        },
      },
    },
    utils: { openExternalLink: { mutationOptions: () => ({}) } },
    workspace: {
      memory: { undoChanges: { call: undoChanges } },
      skill: {
        list: {
          queryOptions: () => ({
            queryFn: () => [],
            queryKey: ["skills"],
          }),
        },
      },
    },
  },
}));

const memories = [
  {
    change: "added" as const,
    kind: "memory" as const,
    memory: { after: "Quote list prices billed annually.", before: null },
    name: "quote-annual-prices",
  },
  {
    change: "removed" as const,
    kind: "memory" as const,
    memory: { after: null, before: "Never offer more than 10% off." },
    name: "discount-rule",
  },
];

describe("MemoryChangesCard", () => {
  it("says what each memory says now, and undoes them", async () => {
    const { container } = await renderInBrowser(
      <MemoryChangesCard changes={memories} />,
    );
    const rows = () =>
      [...container.querySelectorAll("li")].map((row) => row.textContent);
    expect(rows()).toEqual([
      "Quote annual pricesSaved: “Quote list prices billed annually.”",
      "Discount ruleForgotten: “Never offer more than 10% off.”",
    ]);
    await expect.element(page.getByText("Changed 2 memories")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.element(page.getByText("Undone")).toBeVisible();
    expect(undoChanges).toHaveBeenCalledWith({
      changes: memories.map(({ memory, name }) => ({ memory, name })),
    });
  });

  it("has no Undo for memories written by hand", async () => {
    await renderInBrowser(
      <MemoryChangesCard
        changes={[{ change: "added", kind: "memory", name: "by-hand" }]}
      />,
    );
    await expect.element(page.getByText("Saved a memory")).toBeVisible();
    expect(page.getByRole("button", { name: "Undo" }).query()).toBeNull();
  });
});

describe("SkillChangesCard", () => {
  it("names each skill by its slash form, with no Undo", async () => {
    const { container } = await renderInBrowser(
      <SkillChangesCard
        changes={[
          { change: "added", kind: "skill", name: "price-check" },
          { change: "changed", kind: "skill", name: "pricing-faq" },
        ]}
      />,
    );
    expect(
      [...container.querySelectorAll("li")].map((row) => row.textContent),
    ).toEqual(["/price-checkCreated", "/pricing-faqUpdated"]);
    expect(page.getByRole("button", { name: "Undo" }).query()).toBeNull();
  });
});

describe("AppChangesCard", () => {
  it("says what an app still needs on the line with what was done", async () => {
    const { container } = await renderInBrowser(
      <AppChangesCard
        changes={[{ change: "added", kind: "app", name: "Zendesk" }]}
      />,
    );
    await expect
      .element(page.getByText("Added · Needs you to sign in"))
      .toBeVisible();
    expect(
      [...container.querySelectorAll("li")].map((row) => row.textContent),
    ).toEqual(["ZZendeskAdded · Needs you to sign in"]);
  });
});
