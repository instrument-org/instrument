import { renderInBrowser } from "@/tests/render-browser";
import { type ChooseQuestion } from "@instrument-org/workspace/client";
import { noop } from "radashi";
import { type CSSProperties, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { useQuestionBox } from "../question-dock";
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

it("scrolls the choices past a share of the chat's height, fading the foot while there are more below", async () => {
  const many: ChooseQuestion[] = [
    {
      choices: Array.from({ length: 8 }, (_, index) => ({
        description: `Option ${index + 1}'s line, which says a little more`,
        label: `Option ${index + 1}`,
      })),
      header: "Many",
      question: "Which one?",
    },
  ];
  const style = {
    "--conversation-height": "400px",
    width: 440,
  } as CSSProperties; // A custom property, which CSSProperties does not name.
  const screen = await renderInBrowser(
    <div style={style}>
      <QuestionCard
        onAnswer={noop}
        onChatAbout={noop}
        questions={many}
        status="open"
      />
    </div>,
  );
  const list = screen.getByRole("radiogroup").element();
  const fade = () =>
    list.parentElement?.querySelector(":scope > [aria-hidden]") ?? null;

  expect(list.clientHeight).toBe(160);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  await expect.element(screen.getByText("Chat about this")).toBeVisible();
  await expect.poll(fade).not.toBe(null);

  list.scrollTop = list.scrollHeight;
  await expect.poll(fade).toBe(null);
});

/**
 * A stand-in for the chat's foot: the dock's card over a reply box, traded
 * by `useQuestionBox` as the chat trades them.
 */
function Foot({ asked, draft = "" }: { asked: boolean; draft?: string }) {
  const [box, setBox] = useState(draft);
  const [answered, setAnswered] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const isUp = asked && !answered;
  const questionBox = useQuestionBox({
    askId: isUp ? "ask-1" : undefined,
    composerRef,
    dockRef,
    focusBox: () => {
      boxRef.current?.focus();
    },
    isActive: true,
    isBoxEmpty: box === "",
  });
  return (
    <div ref={composerRef}>
      {isUp ? (
        <div ref={dockRef}>
          <QuestionCard
            collapsed={questionBox.isCollapsed}
            onAnswer={() => {
              setAnswered(true);
            }}
            onBack={questionBox.onBack}
            onChatAbout={questionBox.onChatAbout}
            questions={[COMPETITORS]}
            status="open"
          />
        </div>
      ) : null}
      <textarea
        aria-label="Reply"
        hidden={questionBox.isBoxHidden}
        onChange={(event) => {
          setBox(event.target.value);
        }}
        ref={boxRef}
        value={box}
      />
    </div>
  );
}

describe("the card in the reply box's place", () => {
  it("takes the empty box's place with the keyboard, and gives both back once answered", async () => {
    const screen = await renderInBrowser(<Foot asked={false} />);
    const reply = screen.getByRole("textbox", { name: "Reply" });
    const box = reply.element();
    box.focus();

    await screen.rerender(<Foot asked />);
    await expect.poll(() => box.checkVisibility()).toBe(false);
    expect(document.activeElement?.textContent).toContain("Zendesk");

    await userEvent.keyboard("2{Enter}");
    await expect.element(reply).toBeVisible();
    expect(document.activeElement).toBe(reply.element());
  });

  it("keeps a box with words in it, and the keyboard where it was", async () => {
    const screen = await renderInBrowser(
      <Foot asked={false} draft="Before that" />,
    );
    const reply = screen.getByRole("textbox", { name: "Reply" });
    reply.element().focus();

    await screen.rerender(<Foot asked draft="Before that" />);

    await expect
      .element(screen.getByRole("radio", { name: /Zendesk/ }))
      .toBeVisible();
    await expect.element(reply).toBeVisible();
    expect(document.activeElement).toBe(reply.element());
  });

  it("folds to a row beside the box on Chat about this, and opens again with the picks kept", async () => {
    const screen = await renderInBrowser(<Foot asked />);
    await screen.getByRole("radio", { name: /Intercom/ }).click();

    await screen.getByRole("button", { name: "Chat about this" }).click();
    const reply = screen.getByRole("textbox", { name: "Reply" });
    await expect.element(reply).toBeVisible();
    expect(document.activeElement).toBe(reply.element());
    expect(screen.container.querySelector('[role="radio"]')).toBe(null);
    await expect.element(screen.getByText(COMPETITORS.question)).toBeVisible();

    const box = reply.element();
    await screen.getByRole("button", { name: "Back to question" }).click();
    await expect.poll(() => box.checkVisibility()).toBe(false);
    await expect
      .element(screen.getByRole("radio", { name: /Intercom/ }))
      .toBeChecked();
    expect(document.activeElement?.textContent).toContain("Zendesk");
  });

  it("keeps the box on Back to question once it has words", async () => {
    const screen = await renderInBrowser(<Foot asked />);
    await screen.getByRole("button", { name: "Chat about this" }).click();
    await userEvent.keyboard("Hold on");

    await screen.getByRole("button", { name: "Back to question" }).click();

    await expect
      .element(screen.getByRole("textbox", { name: "Reply" }))
      .toHaveValue("Hold on");
    await expect
      .element(screen.getByRole("radio", { name: /Zendesk/ }))
      .toBeVisible();
  });
});
