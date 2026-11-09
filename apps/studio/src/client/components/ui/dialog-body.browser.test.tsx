import { ZOOM_MAX, zoomAtom } from "@/client/atoms/zoom";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

// Rects are on-screen px, the units `innerHeight` is in (see the zoom tests).
function rectOf(selector: string) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`no ${selector} in the document`);
  }
  return element.getBoundingClientRect();
}

describe("DialogBody", () => {
  it.each([1, ZOOM_MAX])(
    "scrolls the body and keeps the footer in the dialog at %sx",
    async (zoom) => {
      const store = createStore();
      store.set(zoomAtom, zoom);
      await renderInBrowser(
        <Dialog open>
          <DialogContent aria-describedby={undefined} maxHeight="20rem">
            <DialogHeader>
              <DialogTitle>Tall</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <div style={{ height: 4000 }} />
            </DialogBody>
            <DialogFooter>
              <button data-testid="action" type="button">
                Send
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>,
        { store },
      );

      const content = rectOf("[data-slot='dialog-content']");
      const action = rectOf("[data-testid='action']");
      const body = document.querySelector("[data-slot='dialog-body']");
      expect({
        actionInDialog: Math.round(action.bottom) <= Math.round(content.bottom),
        actionOnScreen: Math.round(action.bottom) <= globalThis.innerHeight,
        bodyScrolls: (body?.scrollHeight ?? 0) > (body?.clientHeight ?? 0),
      }).toEqual({
        actionInDialog: true,
        actionOnScreen: true,
        bodyScrolls: true,
      });
    },
  );
});

describe("AlertDialogBody", () => {
  it("scrolls the body and keeps the footer in the dialog", async () => {
    await renderInBrowser(
      <AlertDialog open>
        <AlertDialogContent aria-describedby={undefined} maxHeight="20rem">
          <AlertDialogHeader>
            <AlertDialogTitle>Tall</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <div style={{ height: 4000 }} />
          </AlertDialogBody>
          <AlertDialogFooter>
            <button data-testid="action" type="button">
              Delete
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const content = rectOf("[data-slot='alert-dialog-content']");
    const action = rectOf("[data-testid='action']");
    const body = document.querySelector("[data-slot='alert-dialog-body']");
    expect({
      actionInDialog: Math.round(action.bottom) <= Math.round(content.bottom),
      bodyScrolls: (body?.scrollHeight ?? 0) > (body?.clientHeight ?? 0),
    }).toEqual({ actionInDialog: true, bodyScrolls: true });
  });
});
