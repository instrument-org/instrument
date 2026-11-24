import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingChangesNote } from "./setting-changes-note";

const { undoChanges, values } = vi.hoisted(() => ({
  undoChanges: vi.fn(),
  values: {} as Record<string, string>,
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    preferences: {
      live: {
        get: {
          experimental_liveOptions: () => ({
            queryFn: () => ({}),
            queryKey: ["preferences"],
          }),
        },
      },
    },
    workspace: {
      settings: {
        undoChanges: { call: undoChanges },
        values: {
          queryOptions: (options: { queryKey: unknown[] }) => ({
            queryFn: () => ({ ...values }),
            queryKey: options.queryKey,
          }),
        },
      },
    },
  },
}));

const changes = [
  {
    after: { label: "Dark", value: "dark" },
    before: { label: "System", value: "system" },
    id: "theme",
    link: "instrument://settings/theme",
    title: "Theme",
  },
];

beforeEach(() => {
  values.theme = "dark";
  undoChanges.mockReset();
});

describe("SettingChangesNote", () => {
  it("shows each setting's value before and after, and undoes them", async () => {
    undoChanges.mockResolvedValue({ skipped: 0, undone: 1 });
    renderWithProviders(<SettingChangesNote changes={changes} />);
    expect(screen.getByText("Changed a setting")).toBeDefined();
    expect(screen.getByText("System → Dark")).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Undone")).toBeDefined();
    expect(undoChanges).toHaveBeenCalledWith({ changes });
  });

  it("offers no Undo once the person changed it themselves", async () => {
    values.theme = "light";
    renderWithProviders(<SettingChangesNote changes={changes} />);
    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });
  });
});
