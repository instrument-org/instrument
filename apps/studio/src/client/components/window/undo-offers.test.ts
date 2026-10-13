import { toast } from "@/client/lib/toast";
import { beforeEach, expect, it, vi } from "vitest";

import { dropUndoOffer, holdUndoOffer, withdrawUndoOffer } from "./undo-offers";

vi.mock("@/client/lib/toast", () => ({ toast: { dismiss: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

it("takes down the toast whose move was undone another way", () => {
  holdUndoOffer("moved-two", ["first", "second"]);

  withdrawUndoOffer("second");
  // The rest of that toast's offer goes with it.
  withdrawUndoOffer("first");

  expect(vi.mocked(toast.dismiss).mock.calls).toEqual([["moved-two"]]);
});

it("leaves alone a toast that has already gone", () => {
  holdUndoOffer("moved-one", ["only"]);
  dropUndoOffer("moved-one");

  withdrawUndoOffer("only");

  expect(toast.dismiss).not.toHaveBeenCalled();
});

it("does nothing for an undo no toast offered", () => {
  withdrawUndoOffer("a rename");

  expect(toast.dismiss).not.toHaveBeenCalled();
});
