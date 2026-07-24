import { describe, expect, it } from "vitest";

import { isPrivateAddress } from "./private-address";

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "100.100.0.1",
    "169.254.169.254", // cloud metadata
    "172.16.5.5",
    "192.168.0.1",
    "::1",
    "fe80::1",
    "fc00::abcd",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:169.254.169.254", // IPv4-mapped metadata
  ])("blocks private/loopback/link-local %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "142.250.72.14", "2606:4700:4700::1111"])(
    "allows public %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("ignores non-IP hostnames (they are resolved elsewhere)", () => {
    expect(isPrivateAddress("example.com")).toBe(false);
  });
});
