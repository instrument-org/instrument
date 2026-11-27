import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Dialog, DialogContent, DialogTitle } from "./dialog";

function EditedDialog({ edits }: { edits?: "kept" | "unsaved" }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "Open" : "Closed"}</p>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent aria-describedby={undefined} edits={edits}>
          <DialogTitle>Project details</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

async function clickOutside() {
  const overlay = document.querySelector("[data-slot='dialog-overlay']");
  if (!overlay) {
    throw new Error("no dialog overlay");
  }
  await userEvent.click(overlay, { position: { x: 5, y: 5 } });
}

describe("a dialog with edits", () => {
  it("closes on a click outside when nothing is typed", async () => {
    await renderInBrowser(<EditedDialog />);
    await clickOutside();
    await expect.element(page.getByText("Closed")).toBeInTheDocument();
  });

  it.each(["kept", "unsaved"] as const)(
    "stays open on a click outside with %s edits",
    async (edits) => {
      await renderInBrowser(<EditedDialog edits={edits} />);
      await clickOutside();
      await expect.element(page.getByText("Open")).toBeInTheDocument();
      await expect
        .element(page.getByRole("dialog", { name: "Project details" }))
        .toBeVisible();
    },
  );

  it("closes on Escape with kept edits", async () => {
    await renderInBrowser(<EditedDialog edits="kept" />);
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("Closed")).toBeInTheDocument();
  });

  it("asks before Escape discards unsaved edits", async () => {
    await renderInBrowser(<EditedDialog edits="unsaved" />);
    await userEvent.keyboard("{Escape}");
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    await expect.element(page.getByText("Open")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect.element(page.getByText("Closed")).toBeInTheDocument();
  });
});
