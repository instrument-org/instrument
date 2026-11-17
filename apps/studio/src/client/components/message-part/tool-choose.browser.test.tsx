import { renderInBrowser } from "@/tests/render-browser";
import { type ChooseQuestion } from "@instrument-org/workspace/client";
import { noop } from "radashi";
import { type CSSProperties } from "react";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

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

it("keeps every header where it was through answering, skipping and moving between steps", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 480 }}>
      <QuestionCard onAnswer={noop} questions={SEVERAL} status="open" />
    </div>,
  );
  const headers = () =>
    ["Morning", "Weekend", "Pets", "Review"].map((name) => {
      const { left, top } = screen
        .getByRole("button", { name: new RegExp(name) })
        .element()
        .getBoundingClientRect();
      return { left, top };
    });
  const before = headers();

  await screen.getByRole("radio", { name: /Coffee/ }).click();
  await screen.getByRole("button", { name: "Skip" }).click();
  await screen.getByRole("button", { name: /Review/ }).click();

  expect(headers()).toEqual(before);
});

const COMPETITORS: ChooseQuestion = {
  choices: ["Zendesk", "Intercom", "Freshdesk"].map((label) => ({
    description: `What ${label} charges`,
    label,
  })),
  header: "Competitors",
  question: "Which competitors should the comparison cover?",
};

it("picks with a digit and sends with Enter while the keyboard is on a choice", async () => {
  const onAnswer = vi.fn();
  const screen = await renderInBrowser(
    <QuestionCard
      onAnswer={onAnswer}
      questions={[COMPETITORS]}
      status="open"
    />,
  );
  screen
    .getByRole("radio", { name: /Zendesk/ })
    .element()
    .focus();

  // Nothing picked yet: Enter presses the choice it is on.
  await userEvent.keyboard("{Enter}");
  expect(onAnswer).not.toHaveBeenCalled();
  await expect
    .element(screen.getByRole("radio", { name: /Zendesk/ }))
    .toBeChecked();

  await userEvent.keyboard("3");
  await expect
    .element(screen.getByRole("radio", { name: /Freshdesk/ }))
    .toBeChecked();
  await userEvent.keyboard("{Enter}");
  expect(onAnswer).toHaveBeenCalledWith({
    replies: [{ picked: ["Freshdesk"] }],
  });
});

it("sends a digit's pick on Enter when the keyboard came into the card on Skip", async () => {
  const onAnswer = vi.fn();
  const screen = await renderInBrowser(
    <QuestionCard
      onAnswer={onAnswer}
      questions={[COMPETITORS]}
      status="open"
    />,
  );
  // Shift+Tab from the reply box under the card lands on its last button.
  screen.getByRole("button", { name: "Skip" }).element().focus();

  await userEvent.keyboard("2{Enter}");

  expect(onAnswer).toHaveBeenCalledWith({
    replies: [{ picked: ["Intercom"] }],
  });
});

it("leaves digits to the own-answer row, where Shift+Enter starts a line and Enter sends", async () => {
  const onAnswer = vi.fn();
  const screen = await renderInBrowser(
    <QuestionCard
      onAnswer={onAnswer}
      questions={[COMPETITORS]}
      status="open"
    />,
  );
  const own = screen.getByRole("textbox", { name: "Your own answer" });
  await own.click();
  await userEvent.keyboard("2 seats{Shift>}{Enter}{/Shift}more");

  await expect.element(own).toHaveValue("2 seats\nmore");
  await expect
    .element(screen.getByRole("radio", { name: /Intercom/ }))
    .not.toBeChecked();
  await userEvent.keyboard("{Enter}");
  expect(onAnswer).toHaveBeenCalledWith({
    replies: [{ picked: ["2 seats\nmore"] }],
  });
});

it("toggles the choices of a question of several answers by their digits", async () => {
  const onAnswer = vi.fn();
  const screen = await renderInBrowser(
    <QuestionCard
      onAnswer={onAnswer}
      questions={[{ ...COMPETITORS, multiSelect: true }]}
      status="open"
    />,
  );
  screen
    .getByRole("checkbox", { name: /Zendesk/ })
    .element()
    .focus();

  await userEvent.keyboard("131{Enter}");

  expect(onAnswer).toHaveBeenCalledWith({
    replies: [{ picked: ["Freshdesk"] }],
  });
});

it("moves the keyboard on to the next step's first choice as a digit answers a step", async () => {
  const screen = await renderInBrowser(
    <QuestionCard onAnswer={noop} questions={SEVERAL} status="open" />,
  );
  screen
    .getByRole("radio", { name: /Coffee/ })
    .element()
    .focus();

  await userEvent.keyboard("2");

  await expect
    .element(screen.getByText("What does a good weekend look like?"))
    .toBeVisible();
  expect(document.activeElement?.textContent).toContain("Hiking");
});

it("answers every step with digits and sends from the review with Enter", async () => {
  const onAnswer = vi.fn();
  const screen = await renderInBrowser(
    <QuestionCard onAnswer={onAnswer} questions={SEVERAL} status="open" />,
  );
  screen
    .getByRole("radio", { name: /Coffee/ })
    .element()
    .focus();

  await userEvent.keyboard("1");
  await userEvent.keyboard("2");
  await userEvent.keyboard("1");
  await expect
    .element(screen.getByRole("button", { name: /Send answers/ }))
    .toHaveFocus();
  await userEvent.keyboard("{Enter}");

  expect(onAnswer).toHaveBeenCalledWith({
    replies: [
      { picked: ["Coffee"] },
      { picked: ["Reading"] },
      { picked: ["Yes"] },
    ],
  });
});

const MANY: ChooseQuestion[] = [
  {
    choices: Array.from({ length: 8 }, (_, index) => ({
      description: `Option ${index + 1}'s line, which says a little more`,
      label: `Option ${index + 1}`,
    })),
    header: "Many",
    question: "Which one?",
  },
];

/** The card in a chat 400px tall, so its list stops at 160px. */
async function renderCapped() {
  const style = {
    "--conversation-height": "400px",
    width: 440,
  } as CSSProperties; // A custom property, which CSSProperties does not name.
  const screen = await renderInBrowser(
    <div style={style}>
      <QuestionCard onAnswer={noop} questions={MANY} status="open" />
    </div>,
  );
  const list = screen.getByRole("radiogroup").element();
  const fades = () => {
    const shown = [
      ...(list.parentElement?.querySelectorAll<HTMLElement>(
        ":scope > [aria-hidden]",
      ) ?? []),
    ];
    return {
      above: shown.some((fade) => fade.classList.contains("top-0")),
      below: shown.some((fade) => fade.classList.contains("bottom-0")),
    };
  };
  return { fades, list, screen };
}

it("scrolls the choices past a share of the chat's height, fading each edge while there is more past it", async () => {
  const { fades, list } = await renderCapped();

  expect(list.clientHeight).toBe(160);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  await expect.poll(fades).toEqual({ above: false, below: true });

  list.scrollTop = 100;
  await expect.poll(fades).toEqual({ above: true, below: true });

  list.scrollTop = list.scrollHeight;
  await expect.poll(fades).toEqual({ above: true, below: false });
});

it("keeps a growing own answer's last line in view, with no fade over it", async () => {
  const { fades, list, screen } = await renderCapped();
  const own = screen.getByRole("textbox", { name: "Your own answer" });
  own.element().focus();

  await userEvent.keyboard(
    "One{Shift>}{Enter}{/Shift}two{Shift>}{Enter}{/Shift}three",
  );

  await expect
    .poll(() => {
      const row = own.element().getBoundingClientRect();
      return row.bottom <= list.getBoundingClientRect().bottom + 0.5;
    })
    .toBe(true);
  await expect.poll(fades).toEqual({ above: true, below: false });
});
