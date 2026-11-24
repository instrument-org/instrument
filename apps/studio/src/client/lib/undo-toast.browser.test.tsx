import { Toaster } from "@/client/components/ui/sonner";
import { toast } from "@/client/lib/toast";
import { PromptEditor } from "@/client/components/prompt-editor";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { installUndoKey, UNDO_LABEL } from "./undo-toast";

vi.mock("@/client/hooks/use-developer-mode", () => ({
  useDeveloperMode: () => false,
}));
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light" }),
}));

const KEY = /Mac/u.test(navigator.platform) ? "Meta" : "Control";
const pressUndo = () => userEvent.keyboard(`{${KEY}>}z{/${KEY}}`);

vi.mock("@/client/components/skill-mention", () => ({
  SkillMentionByName: ({ name }: { name: string }) => <span>/{name}</span>,
}));

const noop = () => {
  // These tests assert on the undo alone.
};

let uninstall: () => void;
beforeEach(() => {
  uninstall = installUndoKey();
});
afterEach(() => {
  uninstall();
  toast.dismiss();
});

async function draw() {
  const screen = await render(
    <div>
      <input aria-label="field" />
      <button type="button">plain</button>
      <PromptEditor
        actions={[]}
        apps={[]}
        autoFocus={false}
        bounds={null}
        defaultValue=""
        disabled={false}
        onChange={noop}
        onPaste={() => false}
        onSubmit={noop}
        placeholder=""
        skills={[]}
      />
      <Toaster />
    </div>,
  );
  const undo = vi.fn<() => void>();
  const archive = () => {
    toast("Archived", { action: { label: UNDO_LABEL, onClick: undo } });
  };
  return { archive, screen, undo };
}

it("undoes once, and takes the toast away", async () => {
  const { archive, screen, undo } = await draw();
  archive();
  await expect
    .element(screen.getByRole("button", { name: "Undo" }))
    .toBeVisible();
  await pressUndo();
  await pressUndo();
  expect(undo).toHaveBeenCalledTimes(1);
  await expect.element(screen.getByText("Archived")).not.toBeInTheDocument();
});

it("leaves a field its own undo, and shows no keys there", async () => {
  const { archive, screen, undo } = await draw();
  await screen.getByLabelText("field").click();
  archive();
  await expect
    .element(screen.getByRole("button", { name: "Undo" }))
    .toBeVisible();
  expect(document.querySelector("[data-undo-keys]")).toBeNull();
  await pressUndo();
  expect(undo).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "plain" }).click();
  await vi.waitFor(() => {
    expect(document.querySelector("[data-undo-keys]")).not.toBeNull();
  });
  await pressUndo();
  expect(undo).toHaveBeenCalledTimes(1);
});

it("does nothing under a newer toast that has no undo", async () => {
  const { archive, screen, undo } = await draw();
  archive();
  await expect
    .element(screen.getByRole("button", { name: "Undo" }))
    .toBeVisible();
  toast("Copied");
  await expect.element(screen.getByText("Copied")).toBeVisible();
  await pressUndo();
  expect(undo).not.toHaveBeenCalled();
});

const keys = () => document.querySelector("[data-undo-keys]");

it("undoes from a composer nothing was written in, and not once something was", async () => {
  const { archive, undo } = await draw();
  document.querySelector<HTMLElement>(".prompt-editor")?.focus();
  archive();
  await vi.waitFor(() => {
    expect(keys()).not.toBeNull();
  });
  await userEvent.keyboard("a");
  await vi.waitFor(() => {
    expect(keys()).toBeNull();
  });
  await pressUndo();
  expect(undo).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(keys()).not.toBeNull();
  });
  await pressUndo();
  expect(undo).toHaveBeenCalledTimes(1);
});
