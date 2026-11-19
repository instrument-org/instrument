import {
  feedbackBarAtom,
  feedbackDraftAtom,
  newFeedbackDraft,
} from "@/client/atoms/report-dialog";
import { clearKeptState } from "@/client/lib/kept-state";
import {
  discardFeedback,
  feedbackReport,
  forgetUnsentFeedback,
  keepUnsentFeedback,
  restoreUnsentFeedback,
} from "@/client/lib/problem-reports";
import { toast } from "@/client/lib/toast";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));
vi.mock("@/client/lib/toast", () => ({ toast: vi.fn() }));

const sent = {
  ...newFeedbackDraft(feedbackReport({ surface: "rail", tag: "bug" })),
  note: "Here's a video: https://www.icloud.com/iclouddrive/abc",
  sendActions: true,
};

const toasts = () => vi.mocked(toast).mock.calls.map(([message]) => message);

describe("unsent feedback", () => {
  // Each case starts as a launch does: nothing in the window, what was kept still kept.
  beforeEach(() => {
    clearKeptState();
    getDefaultStore().set(feedbackDraftAtom, null);
    vi.mocked(toast).mockClear();
  });

  it("comes back on its bar at the next launch, with a toast saying so", () => {
    keepUnsentFeedback(sent);
    restoreUnsentFeedback();
    expect(getDefaultStore().get(feedbackBarAtom)).toMatchObject({
      note: "Here's a video: https://www.icloud.com/iclouddrive/abc",
      sendActions: true,
      tag: "bug",
    });
    expect(toasts()).toEqual(["Your feedback didn't finish sending."]);
  });

  it("comes back again after another quit until it is sent", () => {
    keepUnsentFeedback(sent);
    restoreUnsentFeedback();
    getDefaultStore().set(feedbackDraftAtom, null);
    restoreUnsentFeedback();
    expect(getDefaultStore().get(feedbackBarAtom)?.note).toBe(sent.note);
  });

  it.each([
    { forget: forgetUnsentFeedback, name: "sent" },
    { forget: () => discardFeedback(sent), name: "thrown away" },
  ])("stays gone once it is $name", ({ forget }) => {
    keepUnsentFeedback(sent);
    forget();
    getDefaultStore().set(feedbackDraftAtom, null);
    vi.mocked(toast).mockClear();
    restoreUnsentFeedback();
    expect(getDefaultStore().get(feedbackBarAtom)).toBeNull();
    expect(toasts()).toEqual([]);
  });
});
