import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import { fireEvent, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { expect, it } from "vitest";

import { SidebarSearch } from "./sidebar-search";

it("opens the command menu when the sidebar's search is pressed", () => {
  const store = getDefaultStore();
  store.set(commandMenuOpenAtom, false);
  render(<SidebarSearch />);
  const search = screen.getByRole("button", { name: /Search/ });
  expect(search.textContent).toMatch(/^Search.*K$/);
  fireEvent.click(search);
  expect(store.get(commandMenuOpenAtom)).toBe(true);
});
