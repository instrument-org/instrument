import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceServerPort } from "../logic/server/url";
import { createSandboxFetch } from "./sandbox-fetch";

const sandboxFetch = createSandboxFetch({ maxResponseSize: 1024 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSandboxFetch", () => {
  it.each([
    "http://10.110.1.20/status",
    "http://192.168.1.1/",
    "http://172.16.0.5/",
    "http://169.254.169.254/",
    "http://100.64.0.1/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://homeassistant.local:8123/api/",
    "http://127.0.0.1:3000/",
  ])("reaches %s", async (url) => {
    const fetchSpy = vi.fn(() => new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sandboxFetch(url);

    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it.each(["127.0.0.1", "127.0.0.2", "[::1]", "[::ffff:127.0.0.1]", "0.0.0.0"])(
    "refuses the workspace server's port on %s",
    async (host) => {
      const fetchSpy = vi.fn(() => new Response("ok"));
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        sandboxFetch(`http://${host}:${getWorkspaceServerPort()}/`),
      ).rejects.toThrow("Network access denied");
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("refuses a redirect into the workspace server before following it", async () => {
    const fetchSpy = vi.fn(
      () =>
        new Response(null, {
          headers: {
            Location: `http://127.0.0.1:${getWorkspaceServerPort()}/`,
          },
          status: 307,
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sandboxFetch("http://192.168.1.1/")).rejects.toThrow(
      "workspace server",
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("caps the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response("x".repeat(2048))),
    );

    await expect(sandboxFetch("http://192.168.1.1/")).rejects.toThrow(
      "Response body too large",
    );
  });
});
