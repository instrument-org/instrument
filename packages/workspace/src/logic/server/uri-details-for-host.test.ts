import { describe, expect, it } from "vitest";

import { uriDetailsForHost } from "./uri-details-for-host";
import { getWorkspaceServerPort } from "./url";

const port = getWorkspaceServerPort();

describe("uriDetailsForHost", () => {
  it.each([
    [
      `task-id.localhost:${port}`,
      { domain: `localhost:${port}`, id: "task-id", origin: "app" },
    ],
    [
      `assets.task-id.localhost:${port}`,
      { domain: `localhost:${port}`, id: "task-id", origin: "assets" },
    ],
    [
      `assets.task-id.lvh.me:${port}`,
      { domain: `lvh.me:${port}`, id: "task-id", origin: "assets" },
    ],
    [
      `assets.localhost:${port}`,
      { domain: `localhost:${port}`, id: "assets", origin: "app" },
    ],
  ] as const)("parses %s", (host, expected) => {
    expect(uriDetailsForHost(host)._unsafeUnwrap()).toEqual(expected);
  });

  it("rejects an asset origin without a task id", () => {
    expect(
      uriDetailsForHost(`assets..localhost:${port}`)._unsafeUnwrapErr(),
    ).toBe("missing-subdomain");
  });
});
