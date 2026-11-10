import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectChangesCard } from "./project-changes-card";

const { undoChanges } = vi.hoisted(() => ({
  undoChanges: vi.fn(() => Promise.resolve({ skipped: 0, undone: 3 })),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      projects: {
        list: {
          queryOptions: () => ({
            queryFn: () => [
              {
                color: "#765fca",
                icon: "cooking-pot",
                id: "prj_1",
                name: "Kitchen",
              },
              { id: "prj_2", name: "Events", retired: true },
            ],
            queryKey: ["projects"],
          }),
        },
        undoChanges: { call: undoChanges },
      },
    },
  },
}));

const changes = [
  {
    fields: [
      { after: "cooking-pot", before: null, field: "icon" as const },
      { after: null, before: "🐭", field: "emoji" as const },
      { after: "Kitchen", before: "Remy", field: "name" as const },
    ],
    name: "Kitchen",
  },
  {
    fields: [{ after: true, before: false, field: "retired" as const }],
    name: "Events",
  },
];

describe("ProjectChangesCard", () => {
  it("heads the card with what changed and gives each project its lines", async () => {
    renderWithProviders(<ProjectChangesCard changes={changes} />);
    expect(screen.getByText("Changed 2 projects")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Kitchen" })).toBeTruthy();
    });
    expect(screen.getByText("New icon")).toBeTruthy();
    expect(screen.getByText(/Renamed from/).textContent).toBe(
      "Renamed from “Remy”",
    );
    expect(screen.getByText("Deleted")).toBeTruthy();
    // A deleted project has no details to open.
    expect(screen.queryByRole("button", { name: "Events" })).toBeNull();
  });

  it("undoes the changes and says so", async () => {
    renderWithProviders(<ProjectChangesCard changes={changes} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(screen.getByText("Undone")).toBeTruthy();
    });
    expect(undoChanges).toHaveBeenCalledWith({ changes });
  });
});
