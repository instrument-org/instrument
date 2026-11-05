import { Toaster } from "sonner";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { toast } from "./toast";

// Real sonner in a real browser, since what this guards is how it treats a toast
// shown again under its own id and what it does after an action's click.
it("follows work in one toast, through a failure and Try again", async () => {
  await render(<Toaster />);
  const attempts: (() => void)[] = [];
  const failures: ((cause: Error) => void)[] = [];
  let done = 0;
  toast.work({
    done: "Thanks, we got it.",
    failed: "Couldn't send it",
    onDone: () => {
      done += 1;
    },
    run: () =>
      new Promise((resolve, reject) => {
        attempts.push(resolve);
        failures.push(reject);
      }),
    running: "Sending it…",
  });

  await expect.element(page.getByText("Sending it…")).toBeVisible();
  failures[0]?.(new Error("offline"));
  await expect.element(page.getByText("Couldn't send it")).toBeVisible();
  expect(done).toBe(0);

  await page.getByRole("button", { name: "Try again" }).click();
  // Sonner removes a toast 200ms after its action unless told not to, so the
  // new attempt has to still be there once that has passed.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await expect.element(page.getByText("Sending it…")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Try again" }))
    .not.toBeInTheDocument();

  attempts[1]?.();
  await expect.element(page.getByText("Thanks, we got it.")).toBeVisible();
  expect(done).toBe(1);
  expect(document.querySelectorAll("[data-sonner-toast]").length).toBe(1);
});
