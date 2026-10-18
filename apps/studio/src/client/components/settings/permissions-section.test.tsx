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
        alwaysOpen: {
          caches: [],
          chats: home,
          programs: [],
          workFolders: home,
        },
        apps: [],
        enforced: true,
        folders: [{ addedAt: new Date(0), level: "allow", path }],
        home,
        places: [],
        dangerouslyAllowEveryFolder: false,
      });

      expect(
        await screen.findByRole("combobox", { name: `Access for ${name}` }),
      ).toBeDefined();
      expect(screen.getByText(name)).toBeDefined();
      expect(screen.getByText(where)).toBeDefined();
    },
  );

  // The window stubs run as a Mac.
  it.each([
    ["ask", "Allowed", true],
    ["never", "Not allowed", false],
  ] as const)(
    "with Other apps' files at %s, shows the caches as %s",
    async (level, caches, listed) => {
      const { queryClient } = renderWithProviders(<PermissionsSection />);
      queryClient.setQueryData(rpcClient.workspace.permissions.get.queryKey(), {
        alwaysOpen: {
          caches: ["/Users/sam/Library/Caches", "/Users/sam/.cache"],
          chats: "/Users/sam/Instrument/.instrument/chats",
          programs: [],
          workFolders: "/Users/sam/.instrument/work",
        },
        apps: [],
        dangerouslyAllowEveryFolder: false,
        enforced: true,
        folders: [],
        home: "/Users/sam",
        places: [{ id: "appFiles", level, paths: ["/Users/sam/Library"] }],
      });

      const rows = await screen.findAllByText(
        /^(Chat work folders|Chat history|Caches)$/,
      );
      expect(
        rows.map((row) =>
          row.closest(".flex.items-center")?.textContent?.trim(),
        ),
      ).toEqual([
        "Chat work folders.instrument › workAllowed",
        "Chat historyInstrument › .instrument › chatsRead only",
        `CachesLibrary › Caches, .cache${caches}`,
      ]);
      expect(screen.queryByText(/names, sizes and dates/) !== null).toBe(
        listed,
      );
    },
  );
});
