import fs from "node:fs";
import path from "node:path";

import { type ComputerUseHost } from "../../types";

/**
 * A driver that answers for a small desktop of its own, TextEdit with one open
 * document and Stickies: what `type` puts in the document shows in the next
 * snapshot, and every call is logged. For a real agent's run, where nothing on
 * the computer should be touched.
 */
const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const documentFile = path.join(__dirname, "document.txt");
fs.appendFileSync(path.join(__dirname, "calls.jsonl"), JSON.stringify(args) + "\\n");
const body = fs.existsSync(documentFile) ? fs.readFileSync(documentFile, "utf8") : "";
const answer = (data) => process.stdout.write(JSON.stringify({ command: args[0], data, ok: true, version: "2.6" }));
const refuse = (code, message) =>
  process.stdout.write(JSON.stringify({ command: args[0], error: { code, disposition: { retry: "safe" }, message }, ok: false, version: "2.6" }));
const delivered = { disposition: { delivery: "delivered_verified", retry: "unsafe" } };
const app = (name, bundle_id, pid) => ({ bundle_id, name, pid, presentation: "foreground" });
switch (args[0]) {
  case "list-apps":
    answer({ apps: [app("TextEdit", "com.apple.TextEdit", 501), app("Stickies", "com.apple.Stickies", 502)] });
    break;
  case "list-windows":
    answer(args.includes("TextEdit") ? [{ accessible: true, id: "w-1", is_focused: true, pid: 501, title: "Shopping" }] : [{ accessible: true, id: "w-2", pid: 502, title: "Sticky" }]);
    break;
  case "snapshot":
    answer({
      app: "TextEdit",
      complete: true,
      ref_count: 2,
      snapshot_id: "sdesk1",
      tree: {
        children: [
          { name: "Save", ref_id: "@sdesk1:e1", role: "button" },
          { name: "Body", ref_id: "@sdesk1:e2", role: "textarea", value: body },
        ],
        name: "Shopping",
        role: "window",
      },
      window: { id: "w-1", title: "Shopping" },
    });
    break;
  case "type":
    if (args[1] === "@sdesk1:e2") {
      fs.appendFileSync(documentFile, args[2]);
      answer(delivered);
    } else {
      refuse("STALE_REF", "That element is no longer there");
    }
    break;
  case "launch":
    answer({ app: "TextEdit", pid: 501 });
    break;
  default:
    answer(delivered);
}
`;

export function fakeDesktopHost(dir: string): ComputerUseHost {
  fs.mkdirSync(dir, { recursive: true });
  const binaryPath = path.join(dir, "agent-desktop");
  fs.writeFileSync(binaryPath, SCRIPT, { mode: 0o755 });
  return {
    binaryPath,
    isEnabled: () => true,
    isReady: () => true,
    ownBundleId: "com.example.own",
    stateDir: () => dir,
  };
}

/** What the fake desktop's document says now. */
export function fakeDesktopDocument(dir: string): string {
  const file = path.join(dir, "document.txt");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}
