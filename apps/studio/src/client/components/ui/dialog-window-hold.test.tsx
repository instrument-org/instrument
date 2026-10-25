import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { DeleteWithProgressDialog } from "@/client/components/delete-with-progress-dialog";
import { useWindowCommands } from "@/client/components/window/use-window-commands";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { renderWithDefaultStore, renderWithProviders } from "@/tests/render";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from "./alert-dialog";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";

const { commandCall, router } = vi.hoisted(() => ({
  commandCall: vi.fn(),
  router: {},
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: { window: { events: { command: { call: commandCall } } } },
}));

function Commands({
  closeTab,
  newTab,
}: {
  closeTab: () => void;
  newTab: () => void;
}) {
  useWindowCommands(
    {
      back: vi.fn(),
      closeTab,
      forward: vi.fn(),
      goToPlace: vi.fn(),
      newChat: vi.fn(),
      newChatFromLink: vi.fn(),
      newTab,
      openFile: vi.fn(),
      openScreen: vi.fn(),
      reopenTab: vi.fn(),
      search: vi.fn(),
      selectChat: vi.fn(),
      selectRelative: vi.fn(),
      selectTab: vi.fn(),
      toggleInbox: vi.fn(),
    },
    { isReady: false },
  );
  return null;
}

function commandStream(command = "closeTab") {
  commandCall.mockImplementation(
    async (_input: unknown, { signal }: { signal: AbortSignal }) =>
      (async function* () {
        yield command;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      })(),
  );
}

function Modal({
  blocked = false,
  alert = false,
}: {
  blocked?: boolean;
  alert?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const Root = alert ? AlertDialog : Dialog;
  const Content = alert ? AlertDialogContent : DialogContent;
  const Title = alert ? AlertDialogTitle : DialogTitle;
  return (
    <Root open={open} onOpenChange={setOpen}>
      <Content
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (blocked) event.preventDefault();
        }}
      >
        <Title>Example</Title>
      </Content>
    </Root>
  );
}

describe("dialog window holds", () => {
  beforeEach(() => {
    getDefaultStore().set(windowHoldsAtom, []);
  });

  it.each([false, true])(
    "Command-W dismisses a modal without closing its app tab (alert=%s)",
    async (alert) => {
      commandStream();
      const closeTab = vi.fn();
      renderWithDefaultStore(
        <>
          <Modal alert={alert} />
          <Commands closeTab={closeTab} newTab={vi.fn()} />
        </>,
      );
      await waitFor(() => expect(screen.queryByText("Example")).toBeNull());
      expect(closeTab).not.toHaveBeenCalled();
    },
  );

  it.each(["closeTab", "newTab"])(
    "a modal that blocks Escape also blocks %s",
    async (command) => {
      commandStream(command);
      const closeTab = vi.fn();
      const newTab = vi.fn();
      renderWithDefaultStore(
        <>
          <Modal blocked />
          <Commands closeTab={closeTab} newTab={newTab} />
        </>,
      );
      await act(async () => {});
      expect(screen.getByText("Example")).not.toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByText("Example")).not.toBeNull();
      expect(closeTab).not.toHaveBeenCalled();
      expect(newTab).not.toHaveBeenCalled();
    },
  );

  it("dismisses a dialog opened by its trigger", async () => {
    const { store } = renderWithProviders(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Triggered</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByText("Open"));
    await act(async () => {
      store.get(windowHoldsAtom).at(-1)?.close?.();
    });
    expect(screen.queryByText("Triggered")).toBeNull();
    expect(store.get(windowHoldsAtom)).toHaveLength(0);
  });

  it("closes the inner dialog when both dialogs mount open", async () => {
    commandStream();
    const outerClose = vi.fn();
    const closeTab = vi.fn();
    renderWithDefaultStore(
      <>
        <Dialog open onOpenChange={outerClose}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Outer</DialogTitle>
            <Modal />
          </DialogContent>
        </Dialog>
        <Commands closeTab={closeTab} newTab={vi.fn()} />
      </>,
    );
    await waitFor(() => expect(screen.queryByText("Example")).toBeNull());
    expect(outerClose).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("does not close an outer hold beneath an inner hold without a close callback", async () => {
    commandStream();
    const outerClose = vi.fn();
    const closeTab = vi.fn();
    getDefaultStore().set(windowHoldsAtom, [{ close: outerClose }, {}]);
    renderWithDefaultStore(<Commands closeTab={closeTab} newTab={vi.fn()} />);
    await act(async () => {});
    expect(outerClose).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("ignores an open dialog in a hidden app tab", () => {
    const { store } = renderWithProviders(
      <ActiveTabProvider isActive={false}>
        <Modal />
      </ActiveTabProvider>,
    );
    expect(store.get(windowHoldsAtom)).toHaveLength(0);
  });

  it("keeps a deletion dialog open for both Escape and Command-W while deletion is pending", async () => {
    let finish = () => {};
    const deleting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onOpenChange = vi.fn();
    const closeTab = vi.fn();
    const dialog = (
      <DeleteWithProgressDialog
        description="Remove the selected item."
        items={[1]}
        onDelete={() => deleting}
        onOpenChange={onOpenChange}
        open
        title="Remove item?"
      />
    );
    const { rerender } = renderWithDefaultStore(dialog);
    fireEvent.click(screen.getByRole("button", { name: /Move to/ }));
    commandStream();
    rerender(
      <>
        {dialog}
        <Commands closeTab={closeTab} newTab={vi.fn()} />
      </>,
    );
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
    await act(async () => {
      finish();
    });
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("closes the app tab when no overlay is open", async () => {
    commandStream();
    const closeTab = vi.fn();
    renderWithDefaultStore(<Commands closeTab={closeTab} newTab={vi.fn()} />);
    await waitFor(() => expect(closeTab).toHaveBeenCalledOnce());
  });
});
