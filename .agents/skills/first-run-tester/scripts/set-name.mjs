#!/usr/bin/env node
// Gives a test account the persona's display name, through the API's own
// profile route, so the app greets the tester by it.
//   node set-name.mjs <account file> "<first and last name>"
import { readFileSync } from "node:fs";

const account = JSON.parse(readFileSync(process.argv[2], "utf8"));
const response = await fetch(`${account.api}/auth/update-user`, {
  body: JSON.stringify({ name: process.argv[3] }),
  headers: {
    authorization: `Bearer ${account.token}`,
    "content-type": "application/json",
    origin: account.web ?? account.api,
  },
  method: "POST",
});
console.log(`${account.email}: ${response.status} ${await response.text()}`);
process.exit(response.ok ? 0 : 1);
