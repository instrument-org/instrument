import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./oxlint-rules";

RuleTester.describe = describe;
RuleTester.it = it;

const rule = plugin.rules["no-os-words"];
if (!rule) {
  throw new Error("The plugin has no studio/no-os-words rule");
}

/** A line that writes `word` where every system shows it. */
const writes = (code: string, word: string) => ({
  code,
  errors: [{ data: { word }, messageId: "osWord" }],
});

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("no-os-words", rule, {
  invalid: [
    writes(`const label = "Quick " + "Look";`, "Quick Look"),
    writes(`const label = name + " in Quick " + ("Lo" + "ok");`, "Quick Look"),
    writes(`const label = "Reveal in " + \`File Explorer\`;`, "File Explorer"),
    writes(`const label = "Reveal in Explorer";`, "Explorer"),
    writes(`const line = "It stays on your Mac.";`, "your Mac"),
    writes(`const line = "It stays on your PC.";`, "your PC"),
    writes(`const line = "Turn it on in macOS settings.";`, "macOS settings"),
    writes(`const hint = "Press Cmd+K to search.";`, "Cmd"),
    writes(`const hint = "Hold Option to copy.";`, "Hold Option"),
    writes(`const hint = "Option-click a file.";`, "Option"),
    writes(`const label = "Photos Library";`, "Library"),
    writes(`const label = <p>Kept in the Library folder</p>;`, "Library"),
  ],
  valid: [
    // Only a string of its own says the word.
    `const label = "Quick " + look;`,
    `const label = "Skill Library";`,
    `const accelerator = "CmdOrCtrl+K";`,
    `const line = "Pick an option below.";`,
    `const path = "~/Library/Caches";`,
    `if (kind === "Finder") {}`,
    `console.log("Opened " + "Quick Look");`,
  ],
});

const shadowRule = plugin.rules["no-shared-shadow-on-float"];
if (!shadowRule) {
  throw new Error("The plugin has no studio/no-shared-shadow-on-float rule");
}

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("no-shared-shadow-on-float", shadowRule, {
  invalid: [
    `const c = "fixed inset-0 shadow-lg";`,
    `const c = "rounded-md bg-popover shadow-md";`,
    `const c = <DialogContent className="p-0 shadow-2xl" />;`,
    `const c = <AlertDialogContent className="shadow-xl" />;`,
  ].map((code) => ({ code, errors: [{ messageId: "sharedShadowOnFloat" }] })),
  valid: [
    `const c = "fixed inset-0 shadow-float-lg";`,
    `const c = "rounded-md border shadow-xs";`,
    `const c = <DialogContent className="p-0 shadow-float-lg" />;`,
    `const c = <div className="p-0 shadow-2xl" />;`,
  ],
});

const commandKeyRule = plugin.rules["no-either-command-key"];
if (!commandKeyRule) {
  throw new Error("The plugin has no studio/no-either-command-key rule");
}

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("no-either-command-key", commandKeyRule, {
  invalid: [
    `if ((event.metaKey || event.ctrlKey) && event.key === "k") {}`,
    `const mod = e.ctrlKey || e.metaKey;`,
    `const newTab = event.metaKey || event.ctrlKey || event.shiftKey;`,
  ].map((code) => ({ code, errors: [{ messageId: "eitherCommandKey" }] })),
  valid: [
    `const mod = event[conventions.commandKey];`,
    `if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {}`,
    `if (event.metaKey && event.ctrlKey) {}`,
  ],
});

const syncReadRule = plugin.rules["no-sync-content-read"];
if (!syncReadRule) {
  throw new Error("The plugin has no studio/no-sync-content-read rule");
}

/** A line that reads a file's contents synchronously through `name`. */
const readsSync = (code: string, name: string) => ({
  code,
  errors: [{ data: { name }, messageId: "syncContentRead" }],
});

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-sync-content-read", syncReadRule, {
  invalid: [
    readsSync(`fs.readFileSync(file, "utf8");`, "readFileSync"),
    readsSync(
      `import { readFileSync } from "node:fs"; readFileSync(file);`,
      "readFileSync",
    ),
    readsSync(
      `import { readFileSync as read } from "fs"; read(file);`,
      "readFileSync",
    ),
    readsSync(`fs.appendFileSync(file, line);`, "appendFileSync"),
    readsSync(`fs.readSync(fd, buffer, 0, 8, 0);`, "readSync"),
    readsSync(`fs.openSync(file, "r");`, "openSync"),
    readsSync(`fs.openSync(file);`, "openSync"),
    readsSync(`fs.openSync(file, flags);`, "openSync"),
    readsSync(`readJsonRecordSync(file);`, "readJsonRecordSync"),
    readsSync(`updateJsonRecordSync(file, change);`, "updateJsonRecordSync"),
  ],
  valid: [
    `fs.statSync(file);`,
    `fs.readdirSync(dir);`,
    `fs.existsSync(file);`,
    `fs.realpathSync(file);`,
    `fs.lstatSync(file);`,
    `fs.writeFileSync(file, text);`,
    `fs.openSync(file, "w");`,
    `await fs.promises.readFile(file, "utf8");`,
    `import { readFile } from "node:fs/promises"; await readFile(file);`,
  ],
});
