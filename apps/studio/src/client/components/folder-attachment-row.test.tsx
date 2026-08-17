import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FolderAttachmentRow } from "./folder-attachment-row";
import { TooltipProvider } from "./ui/tooltip";

const { openFolder } = vi.hoisted(() => ({
  openFolder: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { utils: { openFolder: { call: openFolder } } },
}));

const PATH = "/Users/sam/Downloads";

// Radix opens on pointerdown rather than click, so a plain click never reaches
// the menu behind the access control.
function openAccessMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Access for Downloads" }),
    new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
  );
}

describe("FolderAttachmentRow", () => {
  it("opens the folder when the row is clicked", async () => {
    renderWithProviders(<FolderAttachmentRow access="read-only" path={PATH} />);

    screen.getByRole("button", { name: /~\/Downloads/ }).click();

    await waitFor(() => {
      expect(openFolder).toHaveBeenCalledWith({ folderPath: PATH });
    });
  });

  it("asks before removing the folder", () => {
    const onRemove = vi.fn();
    renderWithProviders(
      <FolderAttachmentRow
        access="read-only"
        onRemove={onRemove}
        path={PATH}
        removeLabel="Remove from task"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove from task" }));

    const confirm = screen.getByRole("alertdialog");
    expect(confirm.textContent).toMatchInlineSnapshot(
      `"Remove "Downloads"?The agent loses access to this folder here. Nothing is deleted and the folder stays where it is on your computer.CancelRemove from task"`,
    );
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirm).getByRole("button", { name: "Remove from task" }),
    );

    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("keeps the folder when the removal is canceled", () => {
    const onRemove = vi.fn();
    renderWithProviders(
      <FolderAttachmentRow
        access="read-only"
        onRemove={onRemove}
        path={PATH}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  // The grant is the user's to revise, and this row is where they are looking at
  // the folder. Re-attaching it through the file picker was the only way to
  // change it, which is a trip out of the app to say one word.
  it("offers both grants, checked at the current one", () => {
    renderWithProviders(
      <TooltipProvider>
        <FolderAttachmentRow
          access="read-only"
          onAccessChange={vi.fn()}
          path={PATH}
        />
      </TooltipProvider>,
    );

    openAccessMenu();

    expect(
      screen.getAllByRole("menuitemcheckbox").map((item) => ({
        checked: item.getAttribute("aria-checked"),
        label: item.textContent,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "checked": "false",
          "label": "Full access",
        },
        {
          "checked": "true",
          "label": "Read-only",
        },
      ]
    `);
  });

  it("changes access from the control", () => {
    const onAccessChange = vi.fn();
    renderWithProviders(
      <TooltipProvider>
        <FolderAttachmentRow
          access="read-only"
          onAccessChange={onAccessChange}
          path={PATH}
        />
      </TooltipProvider>,
    );

    openAccessMenu();
    screen.getByRole("menuitemcheckbox", { name: "Full access" }).click();

    expect(onAccessChange).toHaveBeenCalledExactlyOnceWith("read-write");
  });

  // A folder the task did not attach carries its project's grant, which is not
  // this row's to change: it says what the grant is instead of offering it.
  it("states the access it cannot change", () => {
    renderWithProviders(
      <TooltipProvider>
        <FolderAttachmentRow access="read-write" path={PATH} />
      </TooltipProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "Access for Downloads" }),
    ).toBeNull();
    expect(screen.getByRole("img", { name: "Full access" })).toBeTruthy();
  });
});
