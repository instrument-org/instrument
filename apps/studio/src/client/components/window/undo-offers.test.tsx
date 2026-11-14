import { toast } from "@/client/lib/toast";
import { renderWithProviders } from "@/tests/render";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { beforeEach, expect, it, vi } from "vitest";

import {
  dropUndoOffer,
  holdUndoOffer,
  toastWithUndo,
  withdrawUndoOffer,
} from "./undo-offers";

const dismiss = vi.spyOn(toast, "dismiss");

beforeEach(() => {
  dismiss.mockClear();
});

it("takes down the toast once each move on it is undone another way", () => {
  holdUndoOffer("moved-two", ["first", "second"]);

  withdrawUndoOffer("second");
  // The toast's Undo still puts back the first.
  expect(dismiss).not.toHaveBeenCalled();

  withdrawUndoOffer("first");
  expect(dismiss.mock.calls).toEqual([["moved-two"]]);
});

it("leaves alone a toast that has already gone", () => {
  holdUndoOffer("moved-one", ["only"]);
  dropUndoOffer("moved-one");

  withdrawUndoOffer("only");

  expect(dismiss).not.toHaveBeenCalled();
});

it("does nothing for an undo no toast offered", () => {
  withdrawUndoOffer("a rename");

  expect(dismiss).not.toHaveBeenCalled();
});

// Sonner takes a toast away when its action is pressed without calling its
// `onDismiss`. An undo that stops partway, refused for one of the items,
// would otherwise leave that one held by a toast that is gone.
it("lets the offer go when the toast's Undo is pressed", async () => {
  renderWithProviders(<Toaster />);
  const undo = vi.fn();
  act(() => {
    toastWithUndo("Moved 2 items to the Trash", {
      journalIds: ["refused", "put-back"],
      undo,
    });
  });

  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledOnce();

  withdrawUndoOffer("put-back");
  // Put back later, once whatever refused it is cleared.
  withdrawUndoOffer("refused");
  expect(dismiss).not.toHaveBeenCalled();

  // Sonner unmounts a pressed toast on a timer; one still pending when the
  // file's environment is torn down throws for want of a window.
  await waitFor(() => {
    expect(screen.queryByText("Moved 2 items to the Trash")).toBeNull();
  });
});
