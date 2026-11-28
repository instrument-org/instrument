import { describe, expect, it } from "vitest";

import { groupSites } from "./same-icon-sites";

describe("groupSites", () => {
  it("draws one icon for sites whose icons are the same image", () => {
    expect(
      groupSites(
        [
          "https://teapawt.net/mutewinter",
          "https://mutewinter.com",
          "https://teapawt.org/mutewinter",
          "https://xitter.cf/mutewinter",
        ],
        ["icon:cup", "icon:m", "icon:cup", "icon:cup"],
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "hosts": [
            "teapawt.net",
            "teapawt.org",
            "xitter.cf",
          ],
          "url": "https://teapawt.net/mutewinter",
        },
        {
          "hosts": [
            "mutewinter.com",
          ],
          "url": "https://mutewinter.com",
        },
      ]
    `);
  });

  it("leaves out a site whose icon is not known yet", () => {
    expect(
      groupSites(
        ["https://a.example", "https://b.example"],
        ["", "icon:b"],
      ).map(({ url }) => url),
    ).toEqual(["https://b.example"]);
  });

  it("names a host once however many of its pages are in the row", () => {
    expect(
      groupSites(
        ["https://www.geekwire.com/a", "https://www.geekwire.com/b"],
        ["site:geekwire.com", "site:geekwire.com"],
      ),
    ).toEqual([
      { hosts: ["www.geekwire.com"], url: "https://www.geekwire.com/a" },
    ]);
  });
});
