import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Button } from "./button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

// A surface that closes on a press stays on screen for its exit animation, and
// the second press of a double click lands on it there. Only a real browser can
// answer this: the exit animation is what keeps the closing surface mounted,
// and jsdom runs none.

function PopoverWithAction({ onAct }: { onAct: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button>Open</Button>
      </PopoverTrigger>
      <PopoverContent>
        <Button
          onClick={() => {
            setOpen(false);
            onAct();
          }}
        >
          Act
        </Button>
      </PopoverContent>
    </Popover>
  );
}

describe("a double click on what closes a surface", () => {
  it("runs a context menu's item once", async () => {
    const onSelect = vi.fn();
    await renderInBrowser(
      <ContextMenu>
        <ContextMenuTrigger>
          <div>Row</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onSelect}>Open in New Tab</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    await userEvent.click(page.getByText("Row"), { button: "right" });
    await userEvent.dblClick(
      page.getByRole("menuitem", { name: "Open in New Tab" }),
    );

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("runs a context menu's submenu item once", async () => {
    const onSelect = vi.fn();
    await renderInBrowser(
      <ContextMenu>
        <ContextMenuTrigger>
          <div>Row</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Project</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={onSelect}>Roofer</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    );

    await userEvent.click(page.getByText("Row"), { button: "right" });
    await userEvent.click(page.getByRole("menuitem", { name: "Project" }));
    await userEvent.dblClick(page.getByRole("menuitem", { name: "Roofer" }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("runs a dropdown menu's item once", async () => {
    const onSelect = vi.fn();
    await renderInBrowser(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Open</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Star</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await userEvent.dblClick(page.getByRole("menuitem", { name: "Star" }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("runs a dropdown menu's submenu item once", async () => {
    const onSelect = vi.fn();
    await renderInBrowser(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Open</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Project</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={onSelect}>Roofer</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Project" }));
    await userEvent.dblClick(page.getByRole("menuitem", { name: "Roofer" }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("runs a popover's action once", async () => {
    const onAct = vi.fn();
    await renderInBrowser(<PopoverWithAction onAct={onAct} />);

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await userEvent.dblClick(page.getByRole("button", { name: "Act" }));

    expect(onAct).toHaveBeenCalledOnce();
  });
});
