import { renderInBrowser } from "@/tests/render-browser";
import { type ChooseQuestion } from "@instrument-org/workspace/client";
import { noop } from "radashi";
import { expect, it } from "vitest";

import { QuestionCard } from "./tool-choose";

// Steps of different heights: two choices, five with descriptions, and one.
const SEVERAL: ChooseQuestion[] = [
  {
    choices: [{ label: "Coffee" }, { label: "Tea" }],
    header: "Morning",
    question: "Coffee or tea?",
  },
  {
    choices: ["Hiking", "Reading", "Cooking", "Games", "Music"].map(
      (label) => ({ description: `A day of ${label.toLowerCase()}`, label }),
    ),
    header: "Weekend",
    question: "What does a good weekend look like?",
  },
  {
    choices: [{ label: "Yes" }],
    header: "Pets",
    question: "Any pets?",
  },
];

it("shows one step at a time and keeps the card's height as the person moves between them", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 480 }}>
      <QuestionCard onAnswer={noop} questions={SEVERAL} status="open" />
    </div>,
  );
  const card = screen.container.firstElementChild;
  if (!card) {
    throw new Error("no card rendered");
  }
  const heights: number[] = [];
  for (const header of ["Morning", "Weekend", "Pets", "Review"]) {
    await screen.getByRole("button", { name: new RegExp(header) }).click();
    heights.push(card.getBoundingClientRect().height);
  }

  expect(new Set(heights).size).toBe(1);
  await expect.element(screen.getByText("Any pets?")).not.toBeVisible();
  await screen.getByRole("button", { name: /Pets/ }).click();
  await expect.element(screen.getByText("Any pets?")).toBeVisible();
  await expect
    .element(screen.getByText("What does a good weekend look like?"))
    .not.toBeVisible();
});
