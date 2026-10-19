import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { LOOPBACK_HOST } from "./constants";
import {
  getWorkspaceServerPort,
  getWorkspaceServerURL,
  setWorkspaceServerPort,
} from "./url";

function listen(body: string, host: string, port: number) {
  const server = http.createServer((_request, response) => response.end(body));
  return new Promise<http.Server | undefined>((resolve) => {
    server.once("error", () => resolve(undefined));
    server.listen(port, host, () => resolve(server));
  });
}

describe("getWorkspaceServerURL", () => {
  const initialPort = getWorkspaceServerPort();
  const servers: http.Server[] = [];

  afterEach(() => {
    setWorkspaceServerPort(initialPort);
    for (const server of servers.splice(0)) server.close();
  });

  it("names the address the server binds", () => {
    expect(new URL(getWorkspaceServerURL()).hostname).toBe(LOOPBACK_HOST);
  });

  // A process on IPv6 loopback can hold the same port number, and a caller
  // dialing `localhost` would reach it first.
  it("reaches the bound server past another listener on [::1] at the same port", async () => {
    const bound = await listen("workspace server", LOOPBACK_HOST, 0);
    if (bound) servers.push(bound);
    const address = bound?.address();
    if (!address || typeof address === "string") {
      throw new Error("The test server has no TCP address");
    }
    const squatter = await listen("another process", "::1", address.port);
    if (squatter) servers.push(squatter);

    setWorkspaceServerPort(address.port);
    const response = await fetch(getWorkspaceServerURL());

    expect(await response.text()).toBe("workspace server");
  });
});
