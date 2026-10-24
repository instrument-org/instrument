import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { openLogin } from "@/client/atoms/login-modal";
import { renderWithDefaultStore } from "@/tests/render";

import { LoginModal } from "./login-modal";

// The sheet as two buttons: a Google sign-in that went through, and Done.
vi.mock("@/client/components/studio-modals/add-provider-sheet", () => ({
  AddProviderSheet: ({
    onDone,
    onInstrumentSignedIn,
  }: {
    onDone: () => void;
    onInstrumentSignedIn: (result: unknown) => void;
  }) => (
    <>
      <button
        onClick={() => {
          onInstrumentSignedIn({});
        }}
        type="button"
      >
        Sign in
      </button>
      <button onClick={onDone} type="button">
        Done
      </button>
    </>
  ),
}));

vi.mock("@/client/components/studio-modals/instrument-log-in", () => ({
  AfterInstrumentSignIn: () => null,
  InstrumentLogInPage: () => null,
  InstrumentSignInCheck: () => null,
  useHasOwnAI: () => false,
}));

describe("LoginModal", () => {
  it("finishes an opening closed after its own sign-in", () => {
    renderWithDefaultStore(<LoginModal />);
    const onCompleted = vi.fn();

    act(() => {
      openLogin(undefined, onCompleted);
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("does not finish the next opening with a sign-in from one left by Done", () => {
    renderWithDefaultStore(<LoginModal />);
    const first = vi.fn();
    const second = vi.fn();

    act(() => {
      openLogin(undefined, first);
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    act(() => {
      openLogin(undefined, second);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
