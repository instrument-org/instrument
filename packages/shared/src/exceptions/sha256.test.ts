import { expect, it } from "vitest";

import { sha256Hex } from "./sha256";

// Digests from node:crypto, which this package cannot import.
it.each([
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "a".repeat(55),
    "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
  ],
  [
    "a".repeat(56),
    "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
  ],
  [
    "a".repeat(1000),
    "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
  ],
  [
    "TypeError\nout/main/index readChat \u2713",
    "67eb2b80ba730ffaf2d901c2efa702af5b513881d90be32778480af92e4bb483",
  ],
])("hashes case %#", (text, digest) => {
  expect(sha256Hex(text)).toBe(digest);
});
