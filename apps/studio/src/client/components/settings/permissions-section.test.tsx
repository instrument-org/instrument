import { rpcClient } from "@/client/rpc/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../../tests/render";
import { PermissionsSection } from "./permissions-section";

describe("PermissionsSection", () => {
  it.each([
    // A backslash is a character a name can hold on a Mac or Linux.
    ["/Users/sam", "/Users/sam/Documents/a\\b", "a\\b", "Documents › a\\b"],
    [
      "C:\\Users\\sam",
      "C:\\Users\\sam\\Documents\\Clients",
      "Clients",
      "Documents › Clients",
    ],
  ])(
    "with home at %s, lists %s as %s in %s",
    async (home, path, name, where) => {
      const { queryClient } = renderWithProviders(<PermissionsSection />);
      queryClient.setQueryData(rpcClient.workspace.permissions.get.queryKey(), {
        apps: [],
        enforced: true,
        folders: [{ addedAt: new Date(0), level: "allow", path }],
        home,
        places: [],
        withoutAsking: false,
      });

      expect(
        await screen.findByRole("combobox", { name: `Access for ${name}` }),
      ).toBeDefined();
      expect(screen.getByText(name)).toBeDefined();
      expect(screen.getByText(where)).toBeDefined();
    },
  );
});
