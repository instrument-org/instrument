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
