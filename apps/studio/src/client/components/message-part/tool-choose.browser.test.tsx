import { renderInBrowser } from "@/tests/render-browser";
import { type ChooseQuestion } from "@instrument-org/workspace/client";
import { noop } from "radashi";
import { type CSSProperties } from "react";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { WindowContext } from "../window/context";
import { WindowLook } from "../window/look-panel";
import { DETAIL_HOVER_REST_MS, QuestionCard } from "./tool-choose";

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
  const heights = [card.getBoundingClientRect().height];
  for (let at = 1; at < SEVERAL.length; at += 1) {
    await screen.getByRole("button", { name: "Next question" }).click();
    heights.push(card.getBoundingClientRect().height);
  }

  expect(new Set(heights).size).toBe(1);
  await expect.element(screen.getByText("Any pets?")).toBeVisible();
  await expect
    .element(screen.getByText("What does a good weekend look like?"))
    .not.toBeVisible();
  await screen.getByRole("button", { name: "Previous question" }).click();
  await expect
    .element(screen.getByText("What does a good weekend look like?"))
    .toBeVisible();
});

const COMPETITORS: ChooseQuestion = {
  choices: ["Zendesk", "Intercom", "Freshdesk"].map((label) => ({
    description: `What ${label} charges`,
    label,
  })),
  header: "Competitors",
  question: "Which competitors should the comparison cover?",
};

it("sends the choice the keyboard is on with Enter", async () => {
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

  await userEvent.keyboard("{Tab}{Tab}{Enter}");
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
    replies: [{ picked: ["Freshdesk"] }],
  });
});

it("labels each choice with its number, whether or not the keyboard is on the card", async () => {
  const screen = await renderInBrowser(
    <QuestionCard onAnswer={noop} questions={[COMPETITORS]} status="open" />,
  );
  const number = screen.getByText("3", { exact: true });
  await expect.element(number).toBeVisible();

  screen.getByRole("button", { name: "Skip" }).element().focus();
  await expect.element(number).toBeVisible();
});

it("draws a picked choice's ring inside its row, where the scrolling list cannot clip it", async () => {
  const screen = await renderInBrowser(
    <QuestionCard onAnswer={noop} questions={[COMPETITORS]} status="open" />,
  );
  screen
    .getByRole("radio", { name: /Zendesk/ })
    .element()
    .focus();
  await userEvent.keyboard("{Tab} ");

  const row = document.activeElement;
  expect(row?.textContent).toContain("Intercom");
  expect(row && getComputedStyle(row).outlineOffset).toBe("-2px");
});

it("leaves a digit typed into an empty reply box beside the card in the box, picking nothing", async () => {
  const screen = await renderInBrowser(
    <div>
      <QuestionCard onAnswer={noop} questions={[COMPETITORS]} status="open" />
      <div
        aria-label="Reply"
        className="prompt-editor"
        contentEditable
        role="textbox"
        suppressContentEditableWarning
      />
    </div>,
  );
  const reply = screen.getByRole("textbox", { name: "Reply" });
  await reply.click();

  await userEvent.keyboard("2");

  await expect.element(reply).toHaveTextContent("2");
  await expect.element(reply).toHaveFocus();
  for (const radio of screen.getByRole("radio").all()) {
    await expect.element(radio).not.toBeChecked();
  }
});

it("takes a digit typed into the own-answer row as words, where Shift+Enter starts a line and Enter sends", async () => {
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

it("toggles the choices of a question of several answers with Space, counting them", async () => {
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

  await userEvent.keyboard(" {Tab}{Tab} ");
  await expect.element(screen.getByText("2 picked")).toBeVisible();
  await userEvent.keyboard("{Shift>}{Tab}{Tab}{/Shift} ");
  await expect.element(screen.getByText("1 picked")).toBeVisible();
  expect(onAnswer).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Send" }).click();

  expect(onAnswer).toHaveBeenCalledWith({
    replies: [{ picked: ["Freshdesk"] }],
  });
});

it("moves the keyboard on to the next step's first choice as a pick answers a step", async () => {
  const screen = await renderInBrowser(
    <QuestionCard onAnswer={noop} questions={SEVERAL} status="open" />,
  );
  screen
    .getByRole("radio", { name: /Coffee/ })
    .element()
    .focus();

  await userEvent.keyboard("{Tab} ");

  await expect
    .element(screen.getByText("What does a good weekend look like?"))
    .toBeVisible();
  expect(document.activeElement?.textContent).toContain("Hiking");
});

it("answers every step from the keyboard, sending with the last", async () => {
  const onAnswer = vi.fn();
  const screen = await renderInBrowser(
    <QuestionCard onAnswer={onAnswer} questions={SEVERAL} status="open" />,
  );
  screen
    .getByRole("radio", { name: /Coffee/ })
    .element()
    .focus();

  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{Tab}{Enter}");
  expect(onAnswer).not.toHaveBeenCalled();
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

const LAYOUT: ChooseQuestion = {
  choices: [
    {
      detail: "| Plan | Per agent |\n| --- | --- |\n| Team | $45 |",
      label: "Table",
    },
    {
      detail: "```\nbar chart\n```",
      label: "Bar chart",
    },
    {
      description: "A short write-up with the numbers in it",
      label: "One-page summary",
    },
  ],
  header: "Layout",
  question: "How should I lay out the comparison?",
};

async function renderDetail(width: number) {
  const screen = await renderInBrowser(
    <div style={{ width }}>
      <QuestionCard onAnswer={noop} questions={[LAYOUT]} status="open" />
    </div>,
  );
  const area = () => {
    const found = document.querySelector<HTMLElement>("[data-detail]");
    if (!found) {
      throw new Error("no detail area");
    }
    return found;
  };
  return { area, screen };
}

it("follows the pointer only once it rests on a choice, and the keyboard at once", async () => {
  const { area, screen } = await renderDetail(800);
  expect(area().querySelector("table")).not.toBeNull();

  await userEvent.hover(screen.getByRole("radio", { name: /Bar chart/ }));
  // Crossing a choice on the way somewhere leaves the detail as it was.
  expect(area().querySelector("table")).not.toBeNull();
  await expect.poll(() => area().querySelector("pre")).not.toBeNull();

  screen
    .getByRole("radio", { name: /One-page summary/ })
    .element()
    .focus();
  await expect
    .poll(() => area().querySelector("[data-restated]")?.textContent)
    .toBe("One-page summaryA short write-up with the numbers in it");
});

it("starts a detail's code unwrapped, so its indentation reads as written", async () => {
  const { area, screen } = await renderDetail(800);
  screen
    .getByRole("radio", { name: /Bar chart/ })
    .element()
    .focus();
  await expect
    .poll(() => {
      const pre = area().querySelector("pre");
      return pre ? getComputedStyle(pre).whiteSpace : undefined;
    })
    .toBe("pre");
});

it("drops a choice the pointer only crosses before it rests", async () => {
  const { area, screen } = await renderDetail(800);
  // On the card's clock alone: a slow machine can take longer than the rest
  // between two hovers, and the choice has then rested.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await userEvent.hover(screen.getByRole("radio", { name: /Bar chart/ }));
    await userEvent.hover(
      screen.getByRole("textbox", { name: "Your own answer" }),
    );
    vi.advanceTimersByTime(DETAIL_HOVER_REST_MS * 2);
  } finally {
    vi.useRealTimers();
  }
  // Long enough for React to draw a choice the timer had shown.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(area().querySelector("table")).not.toBeNull();
});

it.each([
  { placed: { beside: true, under: false }, width: 800 },
  // Beside the choices at this width, code would have a third of the card.
  { placed: { beside: false, under: true }, width: 620 },
  { placed: { beside: false, under: true }, width: 420 },
])(
  "places the detail by the card's own width, $width px: $placed",
  async ({ placed, width }) => {
    const { area, screen } = await renderDetail(width);
    const list = screen
      .getByRole("radiogroup")
      .element()
      .getBoundingClientRect();
    const detail = area().getBoundingClientRect();
    expect({
      beside: detail.left >= list.right,
      under: detail.top >= list.bottom,
    }).toEqual(placed);
  },
);

it("keeps a narrow chat's detail short until the pointer is on it", async () => {
  const { area } = await renderDetail(420);
  const short = area().getBoundingClientRect().height;
  expect(short).toBeLessThanOrEqual(100);

  await userEvent.hover(area());
  await expect
    .poll(() => area().getBoundingClientRect().height)
    .toBeGreaterThan(short);
});

it("opens a choice's detail in Quick Look, titled with the choice", async () => {
  const screen = await renderInBrowser(
    <WindowContext
      value={{
        ask: vi.fn(),
        browser: null,
        openPage: vi.fn(),
        openPath: vi.fn(),
        openScreen: vi.fn(),
      }}
    >
      <div style={{ width: 800 }}>
        <QuestionCard onAnswer={noop} questions={[LAYOUT]} status="open" />
      </div>
      <WindowLook />
    </WindowContext>,
  );
  await screen.getByRole("button", { name: "Open detail" }).click();

  const dialog = screen.getByRole("dialog", { name: "Table" });
  await expect.element(dialog.getByRole("table")).toBeVisible();
  await expect.element(dialog.getByText("$45")).toBeVisible();
});

it("keeps the answered card inline and whole, each question over its answer", async () => {
  const screen = await renderInBrowser(
    <div style={{ width: 600 }}>
      <QuestionCard
        onAnswer={noop}
        output={{
          replies: [
            { picked: ["Coffee"] },
            { skipped: true },
            { picked: ["A cat"] },
          ],
        }}
        questions={SEVERAL}
        status="closed"
      />
    </div>,
  );
  const lines = [...screen.container.querySelectorAll("p")].map((line) => ({
    text: line.textContent,
    top: Math.round(line.getBoundingClientRect().top),
  }));

  expect(lines.map((line) => line.text)).toEqual([
    "Coffee or tea?",
    "Coffee",
    "What does a good weekend look like?",
    "Skipped",
    "Any pets?",
    "“A cat”",
  ]);
  // Each answer sits under its question, never beside it.
  for (let at = 1; at < lines.length; at += 1) {
    expect(lines[at]!.top).toBeGreaterThan(lines[at - 1]!.top);
  }
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);
});
