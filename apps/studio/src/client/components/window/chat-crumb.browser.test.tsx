import { renderInBrowser } from "@/tests/render-browser";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatCrumb } from "./chat-crumb";
import { type Project } from "./chats";
import { useState } from "react";

const HOUSE: Project = { created: new Date(0), id: "house", name: "House" };
const TAXES: Project = { created: new Date(0), id: "taxes", name: "Taxes" };

async function renderCrumb(project?: Project) {
  const calls = {
    onSetProject: vi.fn(),
    onShowChats: vi.fn(),
  };
  function Held() {
    const [isPicking, setPicking] = useState(false);
    return (
      <ChatCrumb
        {...calls}
        isPicking={isPicking}
        onNewProject={() => undefined}
        onPickingChange={setPicking}
        project={project}
        projects={[HOUSE, TAXES]}
      />
    );
  }
  await renderInBrowser(<Held />);
  return calls;
}

const pick = async (name: string) => {
  await userEvent.click(page.getByRole("button", { name: "Change project" }));
  await userEvent.click(page.getByRole("menuitemradio", { name }));
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
};

it.each([
  ["a project's chats", HOUSE, "Show chats in House", "house"],
  [
    "every chat, for a chat in no project",
    undefined,
    "Show all chats",
    undefined,
  ],
])(
  "shows %s from its name, a Command click included",
  async (_case, project, name, shown) => {
    const { onShowChats } = await renderCrumb(project);
    await userEvent.click(page.getByRole("button", { name }));
    await userEvent.click(page.getByRole("button", { name }), {
      modifiers: ["Meta"],
    });
    expect(onShowChats.mock.calls).toEqual([[shown], [shown]]);
  },
);

it("files the chat under one project or none, and leaves it alone on the one it is in", async () => {
  const { onSetProject } = await renderCrumb(HOUSE);
  await userEvent.click(page.getByRole("button", { name: "Change project" }));
  await expect
    .element(page.getByRole("menuitemradio", { checked: true }))
    .toMatchTextContent("House");
  await userEvent.click(page.getByRole("menuitemradio", { name: "House" }));
  expect(onSetProject).not.toHaveBeenCalled();
  await pick("Taxes");
  await pick("No project");
  expect(onSetProject.mock.calls).toEqual([["taxes"], [null]]);
});

it("leaves No project out of what is found, so Return never takes a chat out of its project", async () => {
  const { onSetProject } = await renderCrumb(HOUSE);
  await userEvent.click(page.getByRole("button", { name: "Change project" }));
  await userEvent.keyboard("pro{Enter}");
  expect(onSetProject).not.toHaveBeenCalled();
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
});

it("checks No project for a chat in none", async () => {
  await renderCrumb();
  await userEvent.click(page.getByRole("button", { name: "Change project" }));
  await expect
    .element(page.getByRole("menuitemradio", { checked: true }))
    .toMatchTextContent("No project");
});
