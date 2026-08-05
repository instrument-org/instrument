import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useIsGuestCovered } from "./use-guest-covered";

// Two overlays of different families, so the test proves the registration rides
// on the dim layer itself rather than on any one dialog's state.
function Host({
  alertOpen = false,
  dialogOpen = false,
}: {
  alertOpen?: boolean;
  dialogOpen?: boolean;
}) {
  return (
    <>
      <span data-testid="covered">{String(useIsGuestCovered())}</span>
      <Dialog open={dialogOpen}>
        <DialogContent>
          <DialogTitle>Dialog</DialogTitle>
        </DialogContent>
      </Dialog>
      <AlertDialog open={alertOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Alert</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const isCovered = () => screen.getByTestId("covered").textContent === "true";

describe("useIsGuestCovered", () => {
  it("reads uncovered with nothing open", () => {
    renderWithProviders(<Host />);

    expect(isCovered()).toBe(false);
  });

  it("reads covered while a dialog is open", () => {
    const { rerender } = renderWithProviders(<Host />);

    rerender(<Host dialogOpen />);

    expect(isCovered()).toBe(true);
  });

  it("uncovers once the dialog closes", () => {
    const { rerender } = renderWithProviders(<Host dialogOpen />);

    rerender(<Host />);

    expect(isCovered()).toBe(false);
  });

  it("stays covered until the last overlay closes", () => {
    const { rerender } = renderWithProviders(<Host alertOpen dialogOpen />);

    rerender(<Host alertOpen />);

    expect(isCovered()).toBe(true);

    rerender(<Host />);

    expect(isCovered()).toBe(false);
  });
});
