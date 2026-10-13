import {
  filePreviewAtom,
  openFilePreviewAtom,
} from "@/client/atoms/file-preview";
import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { renderWithDefaultStore } from "@/tests/render";
import { act } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";

import { FilePreviewModal } from "./file-preview-modal";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ subscribe: () => () => {} }),
}));

afterEach(() => {
  getDefaultStore().set(filePreviewAtom, { file: null, isOpen: false });
});

it("holds the window while open, so Cmd+W closes the preview rather than the tab", () => {
  const store = getDefaultStore();
  renderWithDefaultStore(<FilePreviewModal />);
  expect(store.get(windowHoldsAtom)).toHaveLength(0);

  act(() => {
    store.set(openFilePreviewAtom, {
      filename: "notes.pdf",
      mimeType: "application/pdf",
      url: "file:///notes.pdf",
    });
  });
  const holds = store.get(windowHoldsAtom);
  expect(holds).toHaveLength(1);

  act(() => {
    holds.at(-1)?.close?.();
  });
  expect(store.get(filePreviewAtom).isOpen).toBe(false);
  expect(store.get(windowHoldsAtom)).toHaveLength(0);
});
