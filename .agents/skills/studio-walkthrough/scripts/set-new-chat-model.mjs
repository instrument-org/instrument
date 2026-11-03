// Picks the model a new chat starts with, the way a person does: New, then
// its model picker. A clean room has none, so New says "No model chosen".
// Run by `walkthrough.mjs seed` through studio-drive.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAct } from "./act.mjs";

export default async (app, { model }) => {
  await app.goto("/chats");
  const act = await createAct(app, {
    out: mkdtempSync(path.join(tmpdir(), "walkthrough-")),
    viewport: { h: 840, w: 1240 },
  });
  await act.prepare({ presentation: false });
  await act.click({ text: "New" });
  await act.hold(800);
  if (await act.evaluate('document.body.innerText.includes("No model chosen")')) {
    await act.click({ text: "Choose a model" });
    await act.hold(400);
    await act.click({ contains: model, selector: "[role=option]" });
    await act.hold(300);
  }
  // An empty draft's trash is off; its window's X closes it.
  await act.click({ label: "Close" });
  await act.hold(500);
  return { model };
};
