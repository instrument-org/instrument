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

/** A line that lists a folder or copies synchronously through `name`. */
const listsSync = (code: string, name: string) => ({
  code,
  errors: [
    { data: { allowed: "0", count: "1", name }, messageId: "syncListing" },
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
    listsSync(`fs.readdirSync(dir);`, "readdirSync"),
    listsSync(
      `import fsSync from "fs"; fsSync.readdirSync(dir);`,
      "readdirSync",
    ),
    listsSync(
      `import { readdirSync as list } from "node:fs"; list(dir);`,
      "readdirSync",
    ),
    listsSync(`const { readdirSync } = fs; readdirSync(dir);`, "readdirSync"),
    listsSync(`fs.opendirSync(dir);`, "opendirSync"),
    listsSync(`fs.globSync("*.md", { cwd });`, "globSync"),
    listsSync(`globSync("*.md");`, "globSync"),
    listsSync(`fs.copyFileSync(from, to);`, "copyFileSync"),
    listsSync(`fs.cpSync(from, to, { recursive: true });`, "cpSync"),
    // A read in a file with listings recorded is a read all the same.
    {
      ...readsSync(
        `fs.readdirSync(dir); fs.readFileSync(file);`,
        "readFileSync",
      ),
      filename: "/repo/src/lib/listed.ts",
      options: [{ "lib/listed.ts": 1 }],
    },
    {
      code: `await fs.promises.readdir(dir);`,
      errors: [{ messageId: "fewer" }],
      filename: "/repo/src/lib/listed.ts",
      options: [{ "lib/listed.ts": 1 }],
    },
  ],
  valid: [
    `fs.statSync(file);`,
    `await fs.promises.readdir(dir);`,
    `await fs.promises.cp(from, to);`,
    {
      code: `fs.readdirSync(dir);`,
      filename: "/repo/src/lib/listed.ts",
      options: [{ "lib/listed.ts": 1 }],
    },
    `fs.existsSync(file);`,
    `fs.realpathSync(file);`,
    `fs.lstatSync(file);`,
    `fs.writeFileSync(file, text);`,
    `fs.openSync(file, "w");`,
    `await fs.promises.readFile(file, "utf8");`,
    `import { readFile } from "node:fs/promises"; await readFile(file);`,
  ],
});

const syncWriteRule = plugin.rules["no-sync-write"];
if (!syncWriteRule) {
  throw new Error("The plugin has no studio/no-sync-write rule");
}

/** A line that writes a file synchronously through `name`, in a file with none recorded. */
const writesSync = (code: string, name: string) => ({
  code,
  errors: [
    { data: { allowed: "0", count: "1", name }, messageId: "syncWrite" },
  ],
});

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-sync-write", syncWriteRule, {
  invalid: [
    writesSync(`fs.writeFileSync(file, text);`, "writeFileSync"),
    writesSync(
      `import { writeFileSync as write } from "node:fs"; write(file, text);`,
      "writeFileSync",
    ),
    writesSync(`fs.writeSync(fd, text);`, "writeSync"),
    writesSync(`writeJsonAtomic(file, value);`, "writeJsonAtomic"),
    {
      code: `fs.writeFileSync(a, text); fs.writeFileSync(b, text);`,
      errors: [
        {
          data: { allowed: "1", count: "2", name: "writeFileSync" },
          messageId: "syncWrite",
        },
        {
          data: { allowed: "1", count: "2", name: "writeFileSync" },
          messageId: "syncWrite",
        },
      ],
      filename: "/repo/src/lib/kept.ts",
      options: [{ "lib/kept.ts": 1 }],
    },
  ],
  valid: [
    `await fs.promises.writeFile(file, text);`,
    `fs.renameSync(from, to);`,
    {
      code: `fs.writeFileSync(file, text);`,
      filename: "/repo/src/lib/kept.ts",
      options: [{ "lib/kept.ts": 1 }],
    },
  ],
});

const queryResultRule = plugin.rules["no-whole-query-result"];
if (!queryResultRule) {
  throw new Error("The plugin has no studio/no-whole-query-result rule");
}

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("no-whole-query-result", queryResultRule, {
  invalid: [
    `function Info() { const size = useQuery(options); return <Walked size={size} />; }`,
    `function Info() { const size = useQuery(options); return <Walked {...size} />; }`,
    `function Info() { const q = useSuspenseQuery(options); return <Walked q={{ q }} />; }`,
    `function useTrash() { const trash = useMutation(options); return useCallback(() => trash.mutate(), [trash]); }`,
    `function Info() { const q = useQuery(options); useEffect(() => {}, [q]); }`,
    `function Info() { const q = useQuery(options); const shown = useMemo(() => q.data, [q]); }`,
  ]
    .map((code) => ({ code, errors: [{ messageId: "wholeQueryResult" }] }))
    .concat({
      // Each mutation that could be the one handed on.
      code: `function Info() { const a = useMutation(one); const b = useMutation(two); const pick = on ? a : b; return <Button run={pick} />; }`,
      errors: [
        { messageId: "wholeQueryResult" },
        { messageId: "wholeQueryResult" },
      ],
    }),
  valid: [
    `function Info() { const size = useQuery(options); return <Walked data={size.data} isFetching={size.isFetching} />; }`,
    `function Info() { const { data } = useQuery(options); return <Walked data={data} />; }`,
    `function Info() { const data = useQuery(options).data; useEffect(() => {}, [data]); }`,
    `function Info() { const trash = useMutation(options); return <Button onClick={() => trash.mutate()} />; }`,
    `function useFeed() { const query = useQuery(options); return { ...query, more }; }`,
    `function useFeed() { return useQuery(options); }`,
    `function Info() { useQuery(options); return null; }`,
    `function Info() { const listings = useQueries({ combine, queries }); useListed({ listings }); }`,
    `function Info() { const q = useQuery(options); const latest = useRef({ q }); }`,
    `function Info() { const q = useQuery(options); useListed({ q }); }`,
    `function Info() { const q = useQuery(options); return isComplete(q) ? null : <Spinner />; }`,
    `function Info() { const a = useMutation(one); const b = useMutation(two); const pick = on ? a : b; return <Button onClick={() => pick.mutate()} />; }`,
  ],
});

const stageRule = plugin.rules["stage-reader-opts-out"];
if (!stageRule) {
  throw new Error("The plugin has no studio/stage-reader-opts-out rule");
}

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("stage-reader-opts-out", stageRule, {
  invalid: [
    `function useHeld() { const stage = useStage(); return stage.now(); }`,
    `const useHeld = () => { const stage = useStage(); return stage.now(); };`,
    // The directive belongs to the function that takes the stage.
    `function Row() { "use no memo"; const read = () => useStage(); return read; }`,
    `function useHeld() { const stage = useStage(); "use no memo"; return stage; }`,
  ].map((code) => ({ code, errors: [{ messageId: "stageReader" }] })),
  valid: [
    `function useHeld() { "use no memo"; const stage = useStage(); return stage.now(); }`,
    `const useHeld = function () { "use no memo"; return useStage().now(); };`,
    `function useOther() { const stage = useStageName(); return stage; }`,
  ],
});

const timerRule = plugin.rules["no-loose-timers"];
if (!timerRule) {
  throw new Error("The plugin has no studio/no-loose-timers rule");
}

/** A line with one loose timer, in a file with none recorded. */
const loose = (code: string, messageId: string) => ({
  code,
  errors: [{ messageId }],
});
const recorded = [{ "client/held.ts": 1 }];
const held = "/repo/src/client/held.ts";

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-loose-timers", timerRule, {
  invalid: [
    loose(`setTimeout(clear, 200);`, "setTimeout"),
    loose(`window.setTimeout(clear, 200);`, "setTimeout"),
    loose(`void setTimeout(clear, 200);`, "setTimeout"),
    loose(`setInterval(tick, 1000);`, "setInterval"),
    loose(`requestAnimationFrame(focus);`, "requestAnimationFrame"),
    loose(`new Promise((done) => setTimeout(done, 50));`, "setTimeout"),
    loose(
      `const frame = requestAnimationFrame(() => requestAnimationFrame(run));`,
      "requestAnimationFrame",
    ),
    loose(`const timer = setTimeout(run, 0);`, "zeroDelay"),
    loose(`const timer = setTimeout(run);`, "zeroDelay"),
    // One more than the file's count, which is the new one, is not known.
    {
      code: `setTimeout(a, 1); setTimeout(b, 1);`,
      errors: [{ messageId: "setTimeout" }, { messageId: "setTimeout" }],
      filename: held,
      options: recorded,
    },
    {
      code: `const timer = setTimeout(a, 1);`,
      errors: [{ messageId: "fewer" }],
      filename: held,
      options: recorded,
    },
  ],
  valid: [
    `const timer = setTimeout(clear, 200);`,
    `timer = setTimeout(clear, 200);`,
    `handles.push(setTimeout(clear, 200));`,
    `const later = (run) => setTimeout(run, 200);`,
    `function later(run) { return setTimeout(run, 200); }`,
    `clearTimeout(timer);`,
    { code: `setTimeout(a, 1);`, filename: held, options: recorded },
  ],
});

const stackedRule = plugin.rules["no-stacked-doc-comments"];
if (!stackedRule) {
  throw new Error("The plugin has no studio/no-stacked-doc-comments rule");
}

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("no-stacked-doc-comments", stackedRule, {
  invalid: [
    {
      code: "/** Gone. */\n/** Here. */\nfunction here() {}",
      errors: [{ messageId: "stacked" }],
    },
    {
      code: "type T = {\n  /** Gone. */\n  /**\n   * Here.\n   */\n  here: string;\n};",
      errors: [{ messageId: "stacked" }],
    },
  ],
  valid: [
    "/** The file. */\n\n/** Here. */\nfunction here() {}",
    "/* oxlint-disable no-console */\n/** Here. */\nfunction here() {}",
    "// A note.\n/** Here. */\nfunction here() {}",
    "/** One. */\nfunction one() {}\n/** Two. */\nfunction two() {}",
  ],
});

const silentRule = plugin.rules["no-silent-rpc"];
if (!silentRule) {
  throw new Error("The plugin has no studio/no-silent-rpc rule");
}

const CALL = "rpcClient.files.paste.call({})";
const unheard = (code: string) => ({
  code,
  errors: [{ messageId: "unheard" }],
});
const silenced = (code: string) => ({
  code,
  errors: [{ messageId: "silenced" }],
});

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("no-silent-rpc", silentRule, {
  invalid: [
    unheard(`void ${CALL};`),
    unheard(`${CALL};`),
    unheard(`void (${CALL});`),
    unheard(`void rpcClient.files?.paste.call({});`),
    unheard(`void rpcClient.files.paste?.call({});`),
    unheard(`void rpcClient[area].paste.call({});`),
    unheard(`void ${CALL}.then(show);`),
    unheard(`void ${CALL}.then(show, undefined);`),
    unheard(`void ${CALL}.then(show, null);`),
    unheard(`void ${CALL}.catch(undefined);`),
    unheard(`void ${CALL}.finally(done);`),
    unheard(`void ${CALL}.then(show).finally(done);`),
    unheard(`void (isMac ? ${CALL} : other());`),
    unheard(`void (ready && ${CALL});`),
    unheard(`ready && void ${CALL};`),
    unheard(`void Promise.all([${CALL}, other()]);`),
    unheard(`useEffect(() => { void ${CALL}; }, []);`),
    unheard(`const run = () => void ${CALL};`),
    unheard(`void (async () => { await ${CALL}; })();`),
    unheard(`(async () => { show(await ${CALL}); })();`),
    unheard(`const b = <button onClick={() => ${CALL}} />;`),
    unheard(`const b = <button onClick={async () => { await ${CALL}; }} />;`),
    unheard(`const b = <button onClick={() => { return ${CALL}; }} />;`),
    unheard(`const b = <p onPointerDown={async () => show(await ${CALL})} />;`),
    unheard(`toast("Moved", { action: { onClick: () => ${CALL} } });`),
    unheard(
      `toast("Moved", { action: { async onClick() { await ${CALL}; } } });`,
    ),
    // A finally has no say in a failure, and a catch around it does.
    unheard(
      `void (async () => { try { await ${CALL}; } finally { done(); } })();`,
    ),
    silenced(`void ${CALL}.catch(() => {});`),
    silenced(`void ${CALL}.catch(() => null);`),
    silenced(`void ${CALL}.catch(() => undefined);`),
    silenced(`void ${CALL}.catch(() => void 0);`),
    silenced(`void ${CALL}.catch(function () {});`),
    silenced(`void ${CALL}.catch(noop);`),
    silenced(`void ${CALL}.then(show, () => {});`),
    silenced(`const list = await ${CALL}.catch(() => null);`),
    silenced(`async function load() { try { await ${CALL}; } catch {} }`),
    silenced(
      `async function load() { try { await ${CALL}; } catch (error) {} }`,
    ),
  ],
  valid: [
    `void ${CALL}.catch((error) => toast.error("Couldn't paste", { cause: error }));`,
    `void ${CALL}.then(show).catch(say);`,
    `void ${CALL}.then(show, say);`,
    `void ${CALL}.catch(say).finally(done);`,
    `void Promise.all([${CALL}, other()]).catch(say);`,
    `void Promise.allSettled([${CALL}]);`,
    `void ${CALL}.catch(() => { /* Only a hint, so nothing is missing. */ });`,
    `async function load() { try { await ${CALL}; } catch { /* Gone already. */ } }`,
    `async function load() { try { await ${CALL}; } catch (error) { say(error); } }`,
    `const b = <button onClick={async () => { try { await ${CALL}; } catch (error) { say(error); } }} />;`,
    `void (async () => { await ${CALL}; })().catch(say);`,
    // Handed on, and so its receiver's.
    `const load = () => ${CALL};`,
    `async function load() { return await ${CALL}; }`,
    `const query = { queryFn: () => ${CALL} };`,
    `const dialog = <Confirm onStop={async () => { await ${CALL}; }} />;`,
    `const files = await ${CALL};`,
    // No call to the main process.
    `void fn.call(self);`,
    `void rpcClient.files.paste.mutationOptions();`,
    { code: `void ${CALL};`, filename: held, options: recorded },
  ],
});

const titleRule = plugin.rules["no-title-under-tooltip"];
if (!titleRule) {
  throw new Error("The plugin has no studio/no-title-under-tooltip rule");
}

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("no-title-under-tooltip", titleRule, {
  invalid: [
    {
      code: `<TooltipTrigger asChild><button title="Linear" /></TooltipTrigger>;`,
      errors: [{ messageId: "title" }],
    },
    {
      code: `<ToolbarTooltip label="Sort"><span><b title="Sort" /></span></ToolbarTooltip>;`,
      errors: [{ messageId: "title" }],
    },
    {
      code: `<TooltipTrigger title="Linear"><svg /></TooltipTrigger>;`,
      errors: [{ messageId: "title" }],
    },
    {
      code: `<TooltipTrigger asChild><svg><title>LM Studio</title></svg></TooltipTrigger>;`,
      errors: [{ messageId: "title" }],
    },
    {
      code: `<TooltipTrigger asChild><button><Favicon url={site} /></button></TooltipTrigger>;`,
      errors: [{ messageId: "markTooltip" }],
    },
    {
      code: `<button title="Linear"><span><Favicon url={site} /></span></button>;`,
      errors: [{ messageId: "markTooltip" }],
    },
  ],
  valid: [
    `<button title="Linear"><Favicon hasTooltip={false} url={site} /></button>;`,
    `<TooltipTrigger asChild><button><Favicon hasTooltip={false} url={site} /></button></TooltipTrigger>;`,
    `<Tooltip><TooltipTrigger asChild><button /></TooltipTrigger><TooltipContent><span title="x" /></TooltipContent></Tooltip>;`,
    // A component's own title prop is not the native one.
    `<TooltipTrigger asChild><Section title="Apps" /></TooltipTrigger>;`,
  ],
});
