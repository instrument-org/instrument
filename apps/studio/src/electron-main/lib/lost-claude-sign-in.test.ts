import { expect, it } from "vitest";

import { lostClaudeSignIn } from "./lost-claude-sign-in";

const out = { kind: "signed-out" };
const signedIn = { kind: "signed-in" };

it.each([
  ["expired", { next: { ...out, expired: true } }, true],
  ["dropped while the app ran", { before: signedIn }, true],
  ["dropped after it was noted", { noted: true }, true],
  ["never signed in", {}, false],
  ["signed out by the person", { before: signedIn, signingOut: true }, false],
  ["signed in again", { next: signedIn, noted: true }, false],
])("reads %s", (_name, given, lost) => {
  expect(
    lostClaudeSignIn({
      before: out,
      next: out,
      noted: false,
      signingOut: false,
      ...given,
    }),
  ).toBe(lost);
});
