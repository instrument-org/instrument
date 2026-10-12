import { renderWithProviders } from "@/tests/render";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProviderSetupScreen } from "./provider-setup-screen";

const status = vi.hoisted(() => ({ kind: "signed-in" }));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    providerConfig: {
      live: {
        list: {
          experimental_liveOptions: () => ({
            queryKey: ["providers"],
            queryFn: () => Promise.resolve([]),
          }),
        },
      },
    },
    claudeAccount: {
      live: {
        status: {
          experimental_liveOptions: () => ({
            queryKey: ["claude-status"],
            queryFn: () => Promise.resolve({ ...status }),
          }),
        },
      },
    },
  },
}));

vi.mock("@/client/components/add-provider/form", () => ({
  AddProviderForm: () => null,
}));
vi.mock("@/client/components/terms-footer", () => ({
  TermsFooter: () => null,
}));
vi.mock("@/client/components/google-login-button", () => ({
  GoogleLoginButton: () => null,
}));
vi.mock("@/client/components/chatgpt-login-button", () => ({
  ChatGPTLoginButton: () => <button>Continue with ChatGPT</button>,
}));
vi.mock("@/client/components/claude-login-button", () => ({
  ClaudeLoginButton: () => <button>Continue with Claude</button>,
}));

describe("provider setup Claude sign-in", () => {
  it.each([
    { kind: "signed-in", signedIn: true, visible: false },
    { kind: "signed-out", signedIn: true, visible: true },
    { kind: "not-a-plan", signedIn: true, visible: true },
    { kind: "signed-in", signedIn: false, visible: true },
  ])(
    "$kind, provider-only=$signedIn: visible=$visible",
    async ({ kind, signedIn, visible }) => {
      status.kind = kind;
      const { queryClient } = renderWithProviders(
        <ProviderSetupScreen
          onContinue={vi.fn()}
          onLogin={vi.fn()}
          onLoginSuccess={vi.fn()}
          onPageChange={vi.fn()}
          page="welcome"
          signedIn={signedIn}
        />,
      );
      await waitFor(() => {
        expect(queryClient.getQueryData(["claude-status"])).toEqual({ kind });
        expect(
          Boolean(
            screen.queryByRole("button", { name: "Continue with Claude" }),
          ),
        ).toBe(visible);
      });
      expect(
        screen.getByRole("button", { name: "Continue with ChatGPT" }),
      ).toBeTruthy();
    },
  );
});
