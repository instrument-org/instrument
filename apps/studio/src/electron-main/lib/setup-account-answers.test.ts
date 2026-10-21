import { type ConnectOutcome } from "@/shared/connect-outcome";
import { describe, expect, it, vi } from "vitest";

import { createSetupAccountAnswers } from "./setup-account-answers";

const chatgpt = { id: "acct-1", type: "chatgpt-account" };
const claude = { id: "claude-account", type: "claude-account" };
const key = { id: "key-1", type: "anthropic" };

function answersWith(
  check: (input: {
    accountId?: string;
    provider: string;
  }) => Promise<ConnectOutcome> = () => Promise.resolve({ kind: "ready" }),
) {
  const onChange = vi.fn();
  const check_ = vi.fn(check);
  return {
    answers: createSetupAccountAnswers({ check: check_, onChange }),
    check: check_,
    onChange,
  };
}

describe("setup's account answers", () => {
  it("counts an account as usable until its check says otherwise", () => {
    const { answers } = answersWith();
    expect(answers.hasUsableAI([])).toBe(false);
    expect(answers.hasUsableAI([chatgpt])).toBe(true);
  });

  it.each<[ConnectOutcome, boolean]>([
    [{ kind: "ready" }, true],
    [{ kind: "out-of-usage", resetsAt: "2026-10-21T15:40:00Z" }, true],
    [{ kind: "failed", message: "offline" }, true],
    [{ kind: "timed-out" }, true],
    [{ kind: "no-plan" }, false],
    [{ kind: "signed-out" }, false],
  ])("after %o, AI is usable: %s", async (outcome, usable) => {
    const { answers, onChange } = answersWith(() => Promise.resolve(outcome));
    await answers.checkAll([chatgpt]);
    expect(answers.hasUsableAI([chatgpt])).toBe(usable);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps a key usable beside an account with no plan", async () => {
    const { answers } = answersWith(() => Promise.resolve({ kind: "no-plan" }));
    await answers.checkAll([chatgpt, key]);
    expect(answers.hasUsableAI([chatgpt])).toBe(false);
    expect(answers.hasUsableAI([chatgpt, key])).toBe(true);
  });

  it("checks each account once, by its own id, and Claude without one", async () => {
    const { answers, check } = answersWith();
    await answers.checkAll([chatgpt, claude, key]);
    await answers.checkAll([chatgpt, claude, key]);
    expect(check.mock.calls.map(([input]) => input)).toEqual([
      { accountId: "acct-1", provider: "chatgpt" },
      { provider: "claude" },
    ]);
  });

  it("takes a sign-in's own answer, for the first account when none is named", () => {
    const { answers, check } = answersWith();
    answers.noteCheck({
      configs: [chatgpt],
      outcome: { kind: "no-plan" },
      provider: "chatgpt",
    });
    expect(answers.hasUsableAI([chatgpt])).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("ignores a canceled check", () => {
    const { answers, onChange } = answersWith();
    answers.noteCheck({
      accountId: "acct-1",
      configs: [chatgpt],
      outcome: { kind: "no-plan" },
      provider: "chatgpt",
    });
    answers.noteCheck({
      accountId: "acct-1",
      configs: [chatgpt],
      outcome: { kind: "canceled" },
      provider: "chatgpt",
    });
    expect(answers.hasUsableAI([chatgpt])).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps a sign-in's newer answer over a launch check that lands after it", async () => {
    let land: (outcome: ConnectOutcome) => void = () => {};
    const { answers } = answersWith(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
    const launch = answers.checkAll([chatgpt]);
    answers.noteCheck({
      accountId: "acct-1",
      configs: [chatgpt],
      outcome: { kind: "ready" },
      provider: "chatgpt",
    });
    land({ kind: "no-plan" });
    await launch;
    expect(answers.hasUsableAI([chatgpt])).toBe(true);
  });
});
