import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Button } from "./button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

// A drag area hands a press to the system as a window move, so the document
// never sees it and an open overlay waiting for a press outside stays open.
// `globals.css` turns every drag area off while one is open. Chromium computes
// `-webkit-app-region` outside Electron too, which is what these read; the
// press itself the system takes cannot be seen here.

function Band() {
  return <div className="h-10 [-webkit-app-region:drag]" data-testid="band" />;
}

function bandRegion() {
  const band = document.querySelector("[data-testid='band']");
  if (!band) {
    throw new Error("no band in the document");
  }
  return getComputedStyle(band).getPropertyValue("-webkit-app-region");
}

describe("a window drag area while an overlay is open", () => {
  it("lets go for a context menu, and drags again once Escape closes it", async () => {
    await renderInBrowser(
      <>
        <Band />
        <ContextMenu>
          <ContextMenuTrigger>
            <div>Row</div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Rename</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </>,
    );
    expect(bandRegion()).toBe("drag");

    await userEvent.click(page.getByText("Row"), { button: "right" });
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(bandRegion()).toBe("no-drag");

    await userEvent.keyboard("{Escape}");
    await expect.poll(bandRegion).toBe("drag");
  });

  it("lets go for a dropdown menu, and drags again once an item is picked", async () => {
    await renderInBrowser(
      <>
        <Band />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>Open</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Star</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(bandRegion()).toBe("no-drag");

    await userEvent.click(page.getByRole("menuitem", { name: "Star" }));
    await expect.poll(bandRegion).toBe("drag");
  });

  it("drags again when an open menu's trigger goes away with it", async () => {
    function Unmounting() {
      const [isShown, setIsShown] = useState(true);
      return (
        <>
          <button
            onClick={() => {
              setIsShown(false);
            }}
            type="button"
          >
            Remove
          </button>
          {isShown ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button>Open</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                onInteractOutside={(event) => {
                  event.preventDefault();
                }}
              >
                <DropdownMenuItem>Star</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      );
    }
    await renderInBrowser(
      <>
        <Band />
        <Unmounting />
      </>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(bandRegion()).toBe("no-drag");

    await userEvent.click(page.getByRole("button", { name: "Remove" }));
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    expect(bandRegion()).toBe("drag");
  });

  it("lets go for a popover, and drags again once it closes", async () => {
    await renderInBrowser(
      <>
        <Band />
        <Popover>
          <PopoverTrigger asChild>
            <Button>Open</Button>
          </PopoverTrigger>
          <PopoverContent>Inside</PopoverContent>
        </Popover>
      </>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await expect.element(page.getByText("Inside")).toBeVisible();
    expect(bandRegion()).toBe("no-drag");

    await userEvent.keyboard("{Escape}");
    await expect.poll(bandRegion).toBe("drag");
  });

  it("lets go for a select, and drags again once an option is picked", async () => {
    await renderInBrowser(
      <>
        <Band />
        <Select>
          <SelectTrigger aria-label="Size">
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="small">Small</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );

    await userEvent.click(page.getByRole("combobox", { name: "Size" }));
    await expect.element(page.getByRole("listbox")).toBeVisible();
    expect(bandRegion()).toBe("no-drag");

    await userEvent.click(page.getByRole("option", { name: "Small" }));
    await expect.poll(bandRegion).toBe("drag");
  });

  it("lets go for a dialog, and drags again once it closes", async () => {
    await renderInBrowser(
      <>
        <Band />
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open</Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Settings</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    expect(bandRegion()).toBe("no-drag");

    await userEvent.keyboard("{Escape}");
    await expect.poll(bandRegion).toBe("drag");
  });

  it("lets go for a floating panel of our own while it is marked", async () => {
    function Panel() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button
            onClick={() => {
              setIsOpen((value) => !value);
            }}
            type="button"
          >
            Toggle
          </button>
          {isOpen ? <div data-no-window-drag>Panel</div> : null}
        </>
      );
    }
    await renderInBrowser(
      <>
        <Band />
        <Panel />
      </>,
    );

    await userEvent.click(page.getByRole("button", { name: "Toggle" }));
    expect(bandRegion()).toBe("no-drag");

    await userEvent.click(page.getByRole("button", { name: "Toggle" }));
    expect(bandRegion()).toBe("drag");
  });

  it("keeps dragging while a tooltip shows", async () => {
    await renderInBrowser(
      <>
        <Band />
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button>Star</Button>
          </TooltipTrigger>
          <TooltipContent>Add a star</TooltipContent>
        </Tooltip>
      </>,
    );

    await userEvent.hover(page.getByRole("button", { name: "Star" }));
    await expect.element(page.getByRole("tooltip")).toBeInTheDocument();
    expect(bandRegion()).toBe("drag");
  });
});
