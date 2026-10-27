import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { renderInBrowser } from "@/tests/render-browser";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { installKeyboardHome } from "./keyboard-home";

/**
 * The window's keyboard rule with the app's own overlays: a press on the
 * button that opens one must leave it open with the keyboard in it. The rule
 * sends the keyboard home a frame after a press when the element holding it
 * looks gone, and an overlay that loses the keyboard closes, so a misread
 * there (an overlay fading in counted as hidden) closes every popover, menu
 * and select at once. The setup's cut of animations to zero is lifted, since
 * the fade-in is what the rule has misread before.
 */

let uninstall: () => void;
let lifted: HTMLStyleElement[] = [];
beforeEach(() => {
  uninstall = installKeyboardHome();
  lifted = [...document.querySelectorAll("style")].filter((style) =>
    style.textContent.includes("animation-duration: 0s !important"),
  );
  for (const style of lifted) {
    style.disabled = true;
  }
});
afterEach(() => {
  uninstall();
  for (const style of lifted) {
    style.disabled = false;
  }
});

/** A screen as the window draws one: a home with its row holding the keyboard, and the overlay's trigger beside it. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div data-app-tab-active="">
      <div data-keyboard-home="" tabIndex={-1}>
        <div aria-selected="true" role="option" tabIndex={0}>
          Row
        </div>
      </div>
      {children}
    </div>
  );
}

/** Long enough for every overlay's fade-in to finish and the rule's frame to have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

it.each([
  {
    name: "a popover",
    open: () => document.querySelector('[data-slot="popover-content"]'),
    overlay: (
      <Popover>
        <PopoverTrigger asChild>
          <Button>Open</Button>
        </PopoverTrigger>
        <PopoverContent>
          <input aria-label="Search" />
        </PopoverContent>
      </Popover>
    ),
  },
  {
    name: "a menu",
    open: () => document.querySelector('[role="menu"]'),
    overlay: (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Open</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>First</DropdownMenuItem>
          <DropdownMenuItem>Second</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
  {
    name: "a select",
    open: () => document.querySelector('[role="listbox"]'),
    overlay: (
      <Select defaultValue="a">
        <SelectTrigger aria-label="Open">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">First</SelectItem>
          <SelectItem value="b">Second</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
])("leaves $name open with the keyboard in it", async ({ open, overlay }) => {
  await renderInBrowser(<Screen>{overlay}</Screen>);
  document.querySelector<HTMLElement>('[role="option"]')?.focus();
  const trigger =
    document.querySelector<HTMLElement>('[aria-label="Open"]') ??
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent === "Open",
    );
  if (!trigger) {
    throw new Error("fixture missing");
  }

  await userEvent.click(trigger);
  await settle();

  const shown = open();
  expect(shown).not.toBeNull();
  expect(shown?.contains(document.activeElement)).toBe(true);
});
