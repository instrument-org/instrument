import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  deleteGroupTabRouter,
  setGroupTabRouter,
  useGroupTabRouter,
} from "./group-tab-router-registry";
import { createTabRouter } from "./tab-router";

const ID = "screen-1";

function Shown({ id }: { id: string }) {
  const router = useGroupTabRouter(id);
  return <p>{router?.history.location.pathname ?? "none"}</p>;
}

/** Makes the tab's router while rendering, the way the app window does. */
function Window({ href }: { href: string }) {
  setGroupTabRouter(ID, createTabRouter({ pathname: href }));
  return <Shown id={ID} />;
}

afterEach(() => {
  deleteGroupTabRouter(ID);
});

describe("useGroupTabRouter", () => {
  it("draws the router a tab gets when it moves without changing id", async () => {
    const { rerender } = render(<Window href="/tasks/t1" />);
    expect(screen.getByRole("paragraph").textContent).toBe("/tasks/t1");
    await act(async () => {
      rerender(<Window href="/files" />);
      await Promise.resolve();
    });
    expect(screen.getByRole("paragraph").textContent).toBe("/files");
  });

  it("draws a router set outside any render", async () => {
    setGroupTabRouter(ID, createTabRouter({ pathname: "/tasks/t1" }));
    render(<Shown id={ID} />);
    await act(async () => {
      setGroupTabRouter(ID, createTabRouter({ pathname: "/files" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("paragraph").textContent).toBe("/files");
  });
});
