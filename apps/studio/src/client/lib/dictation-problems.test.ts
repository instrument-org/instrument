import { describe, expect, it } from "vitest";

import {
  describeDictationProblem,
  type DictationBilling,
  type DictationProblem,
} from "./dictation-problems";

describe("describeDictationProblem", () => {
  const kinds: DictationProblem["kind"][] = [
    "capture-failed",
    "connection",
    "microphone-busy",
    "microphone-refused",
    "no-microphone",
    "nothing-heard",
    "rate-limited",
    "rejected",
    "server",
    "signed-out",
    "too-large",
    "too-short",
    "unsupported-audio",
  ];

  it("says every problem in a toast, keeping the recording only where a retry is offered", () => {
    const notices = Object.fromEntries(
      kinds.map((kind) => {
        // `as`: every kind listed here needs nothing beside it.
        const problem = { kind } as DictationProblem;
        const notice = describeDictationProblem(problem, {
          canOpenSettings: true,
        });
        expect(notice.keepsRecording).toBe(
          notice.action === "retry" || notice.action === "sign-in",
        );
        return [
          kind,
          `${notice.tone}: ${notice.title} / ${notice.description ?? ""}${typeof notice.action === "string" ? ` [${notice.action}]` : ""}`,
        ];
      }),
    );
    expect(notices).toMatchInlineSnapshot(`
      {
        "capture-failed": "error: Couldn't start recording / Something went wrong with the microphone. Try again.",
        "connection": "error: Couldn't reach Instrument / Your recording is safe. Check your connection, then try again. [retry]",
        "microphone-busy": "error: Couldn't start recording / Another app is using the microphone. Close it, then try again.",
        "microphone-refused": "error: Couldn't use the microphone / You can let Instrument use the microphone in System Settings. [open-settings]",
        "no-microphone": "error: Couldn't find a microphone / Plug one in, then try again.",
        "nothing-heard": "info: Didn't quite catch that / There were no words in that recording. Try again.",
        "rate-limited": "error: Couldn't transcribe that yet / Your recording is safe. Wait a moment, then try again. [retry]",
        "rejected": "error: Couldn't transcribe that / Dictation couldn't use that recording. If you picked a language in Settings, try Auto-detect.",
        "server": "error: Couldn't transcribe that / Something went wrong on our side. Your recording is safe, so you can try again. [retry]",
        "signed-out": "error: Couldn't transcribe that / Your recording is safe, and it goes through once you log in to Instrument. [sign-in]",
        "too-large": "error: Couldn't transcribe that / That recording is too long to send. Try a shorter one.",
        "too-short": "info: Didn't quite catch that / Talk for a little longer before you press Stop.",
        "unsupported-audio": "error: Couldn't transcribe that / Dictation couldn't read the audio in that recording. Try recording it again.",
      }
    `);
  });

  it("does not offer System Settings where there is none to open", () => {
    expect(
      describeDictationProblem(
        { kind: "microphone-refused" },
        { canOpenSettings: false },
      ).action,
    ).toBeUndefined();
  });
});

describe("billing refusals", () => {
  const refusedAt = new Date("2026-10-13T18:30:00.000Z");
  const spentPlan = {
    offer: {
      plans: [
        { allowance: { multiple: 1, windows: [] }, key: "pro" },
        { allowance: { multiple: 4, windows: [] }, key: "max" },
      ],
    },
    refusedAt,
    status: {
      canSubscribe: false,
      plan: "pro",
      subscription: { cancelAtPeriodEnd: false, plan: "pro", status: "active" },
      trial: { state: "ended" },
      windows: [{ key: "5h", percentUsed: 100 }],
    },
    statusReadAt: refusedAt.getTime() + 1,
    // `as`: only the fields the billing notice reads.
  } as unknown as DictationBilling;

  const cases: [string, DictationProblem, DictationBilling | undefined][] = [
    [
      "upload over the plan's limit",
      { kind: "billing-refused", refusal: { code: "usage-limit-exceeded" } },
      spentPlan,
    ],
    [
      "upload with no plan",
      {
        kind: "billing-refused",
        refusal: { code: "subscription-required", reason: "no-plan" },
      },
      undefined,
    ],
    [
      "upload with a trial to start",
      {
        kind: "billing-refused",
        refusal: { code: "subscription-required", reason: "trial-available" },
      },
      undefined,
    ],
    [
      "stream refused for a failed payment",
      {
        kind: "billing-stopped",
        refusal: { code: "subscription-required", reason: "payment-failed" },
      },
      undefined,
    ],
    ["take ended, billing silent", { kind: "billing-stopped" }, spentPlan],
  ];

  it("says each in billing's words, keeping only an upload's recording", () => {
    const notices = Object.fromEntries(
      cases.map(([name, problem, billing]) => {
        const notice = describeDictationProblem(problem, {
          billing,
          canOpenSettings: true,
        });
        expect(notice.keepsRecording).toBe(problem.kind === "billing-refused");
        const action =
          typeof notice.action === "object"
            ? `${notice.action.kind}: ${notice.action.label}`
            : notice.action;
        return [
          name,
          `${notice.title} / ${notice.description ?? ""}${action ? ` [${action}]` : ""}`,
        ];
      }),
    );
    expect(notices).toMatchInlineSnapshot(`
      {
        "stream refused for a failed payment": "Your payment didn't go through. / Update your card to keep going. [update-card: Update card]",
        "take ended, billing silent": "You've reached your plan's limit for now. /  [upgrade: Upgrade]",
        "upload over the plan's limit": "You've reached your plan's limit for now. / It resets soon. Your recording is safe, so you can send it later. [upgrade: Upgrade]",
        "upload with a trial to start": "Start your free trial to use dictation. / Your recording is safe, so you can send it later. [start-trial: Start free trial]",
        "upload with no plan": "Choose a plan to use dictation. / Your recording is safe, so you can send it later. [choose-plan: Choose a plan]",
      }
    `);
  });
});
