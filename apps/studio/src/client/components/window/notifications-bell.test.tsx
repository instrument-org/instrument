import { renderWithProviders } from "@/tests/render";
import { act, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { NotificationsBell } from "./notifications-bell";

const NOTICE = {
  body: "Sign in again to keep using it.",
  id: "account:1",
  kind: "account",
  seen: false,
  severity: "critical",
  title: "You were signed out",
};

const spies = vi.hoisted(() => ({
  claimToast: vi.fn<() => Promise<boolean>>(),
  drawn: vi.fn(),
}));

vi.mock("@/client/lib/toast", () => ({
  toast: { dismiss: vi.fn(), drawn: spies.drawn, error: vi.fn() },
}));
vi.mock("@/client/components/window/app-tabs", () => ({
  useAppTabs: () => ({ open: vi.fn() }),
}));
vi.mock("@/client/rpc/client", () => {
  const query = (name: string) => ({
    experimental_liveOptions: () => ({
      initialData: name === "notices" ? [NOTICE] : [],
      queryFn: () => new Promise(() => undefined),
      queryKey: [name],
    }),
  });
  return {
    rpcClient: {
      notices: {
        claimToast: { call: spies.claimToast },
        live: { list: query("notices") },
        markSeen: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      },
      problems: { live: { pending: query("problems") } },
    },
  };
});

it.each([
  ["toasts a notice still there when its turn is granted", true, 1],
  ["does not toast one resolved while its turn was asked for", false, 0],
])("%s", async (_case, isThere, toasts) => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  let grant: (granted: boolean) => void = () => {};
  spies.claimToast.mockReturnValue(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const { queryClient } = renderWithProviders(<NotificationsBell />);
  await waitFor(() => {
    expect(spies.claimToast).toHaveBeenCalledOnce();
  });
  if (!isThere) {
    act(() => {
      queryClient.setQueryData(["notices"], []);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await act(async () => {
    grant(true);
    await Promise.resolve();
  });
  expect(spies.drawn).toHaveBeenCalledTimes(toasts);
});
