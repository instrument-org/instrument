import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../../tests/render";
import { PermissionsSection } from "./permissions-section";

type View = RPCOutput["workspace"]["permissions"]["get"];

const NO_PLACES: View = {
  alwaysOpen: { caches: [], chats: "", programs: [], workFolders: "" },
  apps: [],
  dangerouslyAllowEveryFolder: false,
  folders: [],
  home: "/Users/sam",
  places: [],
  untouched: true,
};

function showView(view: View) {
  const { queryClient } = renderWithProviders(<PermissionsSection />);
  queryClient.setQueryData(
    rpcClient.workspace.permissions.get.queryKey(),
    view,
  );
}

describe("PermissionsSection", () => {
  it.each([
    [true, false],
    [false, true],
  ])(
    "with the rules untouched %s, shows Reset permissions: %s",
    async (untouched, shown) => {
      showView({ ...NO_PLACES, untouched });
      await screen.findByText("Folders");
      expect(
        screen.queryByRole("button", { name: "Reset permissions" }) !== null,
      ).toBe(shown);
    },
  );

  it.each([
    // A backslash is a character a name can hold on a Mac or Linux.
    [
      "/Users/sam",
      "/Users/sam/Documents/a\\b",
      "a\\b",
      "sam › Documents › a\\b",
    ],
    [
      "C:\\Users\\sam",
      "C:\\Users\\sam\\Documents\\Clients",
      "Clients",
      "sam › Documents › Clients",
    ],
  ])(
    "with home at %s, lists %s as %s at %s",
    async (home, path, name, where) => {
      window.api.homeDir = home;
      showView({
        ...NO_PLACES,
        folders: [{ addedAt: new Date(0), level: "allow", path }],
        home,
      });

      expect(
        await screen.findByRole("combobox", { name: `Access for ${name}` }),
      ).toBeDefined();
      expect(screen.getByTitle(where).previousElementSibling?.textContent).toBe(
        name,
      );
      window.api.homeDir = "/Users/sam";
    },
  );

  it("sets a folder the person allowed under the place it is in, and one in no place at the end", async () => {
    showView({
      ...NO_PLACES,
      folders: [
        { addedAt: new Date(0), level: "allow", path: "/Users/sam/Projects" },
        {
          addedAt: new Date(0),
          level: "allow",
          path: "/Users/sam/Documents/Taxes",
        },
      ],
      places: [
        { id: "desktop", level: "ask", paths: ["/Users/sam/Desktop"] },
        { id: "documents", level: "ask", paths: ["/Users/sam/Documents"] },
        { id: "downloads", level: "ask", paths: ["/Users/sam/Downloads"] },
      ],
    });

    const rows = await screen.findAllByRole("combobox", {
      name: /^Access for /,
    });
    expect(rows.map((row) => row.getAttribute("aria-label")))
      .toMatchInlineSnapshot(`
      [
        "Access for Desktop",
        "Access for Documents",
        "Access for Taxes",
        "Access for Downloads",
        "Access for Projects",
      ]
    `);
  });

  it.each([
    ["user-namespaces-closed", /AppImage on Ubuntu/],
    ["no-bubblewrap", /bubblewrap package/],
  ] as const)(
    "warns that the agent's programs don't run, and offers to run them anyway, %s",
    async (sandboxOff, reason) => {
      showView({ ...NO_PLACES, home: "/home/sam", sandboxOff });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(
        "The agent can't run programs right now",
      );
      expect(alert.textContent).toMatch(reason);
      expect(
        screen.getByRole("switch", { name: /Run programs without a sandbox/ }),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Learn more" })).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Send a report" }),
      ).toBeDefined();
    },
  );

  it("warns while folders are used without asking, with a way to turn it off", async () => {
    showView({ ...NO_PLACES, dangerouslyAllowEveryFolder: true });

    expect(
      (await screen.findByRole("status")).textContent,
    ).toMatchInlineSnapshot(
      `"Instrument uses folders without askingIt reads and changes any folder that isn’t marked Not allowed. It still asks before using your passwords and keys.Turn off"`,
    );
    expect(screen.getByRole("button", { name: "Turn off" })).toBeDefined();
  });

  // The window stubs run as a Mac.
  it.each([
    ["ask", "Always allowed", true],
    ["never", "Not allowed", false],
  ] as const)(
    "with Other apps' files at %s, shows the caches as %s",
    async (level, caches, listed) => {
      showView({
        ...NO_PLACES,
        alwaysOpen: {
          caches: ["/Users/sam/Library/Caches", "/Users/sam/.cache"],
          chats: "/Users/sam/Instrument/.instrument/chats",
          programs: [],
          workFolders: "/Users/sam/.instrument/work",
        },
        places: [
          { id: "output", level: "allow", paths: ["/Users/sam/Instrument"] },
          { id: "appFiles", level, paths: ["/Users/sam/Library"] },
        ],
      });

      (await screen.findByText("Folders every chat can use")).click();

      const rows = await screen.findAllByText(
        /^(Instrument folder|Each chat’s files|Past chats|Caches)$/,
      );
      const folderRows = rows.map((row) => row.closest(".group\\/folder-row"));
      expect(
        folderRows.map((row) => [
          row?.querySelector("[title]")?.getAttribute("title"),
          row?.querySelector("[role=combobox], [data-level]")?.textContent ??
            row?.lastElementChild?.textContent,
        ]),
      ).toEqual([
        ["sam › Instrument", "Always allowed"],
        ["sam › .instrument › work", "Always allowed"],
        ["sam › Instrument › .instrument › chats", "Read only"],
        [undefined, caches],
      ]);
      expect(folderRows[3]?.textContent).toContain(
        "sam/Library/Caches, sam/.cache",
      );
      expect(screen.queryByText(/names, sizes and dates/) !== null).toBe(
        listed,
      );
    },
  );

  it("says where macOS blocks what the person allowed, and nowhere else", async () => {
    const { queryClient } = renderWithProviders(<PermissionsSection />);
    queryClient.setQueryData(rpcClient.workspace.permissions.get.queryKey(), {
      ...NO_PLACES,
      apps: [
        { addedAt: new Date(0), level: "allow", name: "Reminders" },
        { addedAt: new Date(0), level: "allow", name: "Notes" },
      ],
      folders: [
        {
          addedAt: new Date(0),
          level: "allow",
          path: "/Users/sam/Desktop/Pricing",
        },
        { addedAt: new Date(0), level: "allow", path: "/Users/sam/Projects" },
      ],
    } satisfies View);
    queryClient.setQueryData(rpcClient.workspace.permissions.macos.queryKey(), {
      apps: ["Reminders"],
      folders: ["/Users/sam/Desktop"],
    });

    await screen.findByTitle("sam › Desktop › Pricing");
    expect(screen.getAllByText("Your Mac is blocking this.")).toHaveLength(2);
  });
});
