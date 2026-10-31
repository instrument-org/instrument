// A studio-drive sequence (`studio-drive.mjs run`) that puts the running app into each
// state the baseline draws and takes a 1280x800 picture of it at 1x in the light theme,
// named by the baseline frame's `measure` key. measure.mjs runs it; args are
// { dir, folder, only?: string[] }. What only a developer sees in the bar (the workspace
// chip, the dev panel, the theme switch, server exceptions) is hidden from the pictures,
// since a fixture pins developer mode on and the app's own rpc needs it.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Each state, by key: how to get there from wherever the last one left the app. Every
 * one starts with menus and dialogs put away; the tab states run last, since they leave
 * tabs open.
 */
const SURFACES = {
  chats: async (h) => {
    await h.go("/chats");
  },
  chat: async (h) => {
    await h.go("/chats/red-and-blue-squares");
  },
  "inbox-view-menu": async (h) => {
    await h.go("/chats/red-and-blue-squares");
    await h.app.click({ text: "View: Chats" });
  },
  "inbox-search": async (h) => {
    await h.go("/chats/red-and-blue-squares");
    await h.app.click({ selector: "input[placeholder^=Search]" });
    await h.app.type("squares");
  },
  "inbox-topic": async (h) => {
    await h.topic();
    await h.go("/chats/red-and-blue-squares");
    await h.app.click({ text: "View: Chats" });
    await h.app.click({ text: "💼 Pricing", selector: "[role=menuitemradio]" });
    h.after(async () => {
      await h.app.click({ text: "View: Pricing" });
      await h.app.click({ text: "Chats", selector: "[role=menuitemradio]" });
    });
  },
  bell: async (h) => {
    await h.go("/chats/red-and-blue-squares");
    await h.app.click({ selector: "button[aria-label^=Notifications]" });
  },
  "status-pill": async (h) => {
    await h.go("/chats/red-and-blue-squares");
    await h.showPill();
    await h.app.click({ text: "Can't reach Instrument" });
  },
  "files-table": async (h) => {
    await h.files("Table view", "pricing-comparison.html");
  },
  "files-list": async (h) => {
    await h.files("List view");
  },
  "files-grid": async (h) => {
    await h.files("Grid view");
  },
  "files-columns": async (h) => {
    await h.files("Columns view", "pricing-comparison.html");
  },
  "files-sort-menu": async (h) => {
    await h.files("Table view");
    await h.app.click({ text: "Sort by" });
  },
  "files-search": async (h) => {
    await h.files("Table view");
    await wait(300);
    await h.app.click({ selector: 'button[aria-label="Search"]' });
  },
  "files-omnibar-typing": async (h) => {
    await h.files("Table view");
    await h.app.eval(`document.querySelector('[role=combobox]').focus()`);
    await h.app.type("pri");
  },
  "files-no-sidebar": async (h) => {
    await h.files("Table view", "pricing-comparison.html");
    await h.app.click({ text: "Hide the sidebar" });
    h.after(() => h.app.click({ text: "Show the sidebar" }));
  },
  "files-beside": async (h) => {
    const file = `${h.folder}/pricing-comparison.html`;
    await h.go(`/files?file=${encodeURIComponent(file)}&path=&root=~&tree=${encodeURIComponent(h.folder)}`, 1600);
  },
  "browser-home": async (h) => {
    await h.go("/browser");
  },
  "browser-typing": async (h) => {
    await h.go("/browser");
    await h.app.eval(`document.querySelector('[role=combobox]').focus()`);
    await h.app.type("zen");
  },
  "browser-page": async (h) => {
    await h.go("/browser");
    await h.app.eval(`document.querySelector('[role=combobox]').focus()`);
    await h.app.type("https://example.com");
    await h.app.press("Enter");
    await wait(2500);
  },
  "new-tab": async (h) => {
    await h.go("/new-tab");
  },
  "command-menu": async (h) => {
    await h.go("/chats/red-and-blue-squares");
    await h.app.press("Meta+k");
  },
  apps: async (h) => {
    await h.go("/apps");
  },
  "settings-general": async (h) => {
    await h.settings("General");
  },
  "settings-providers": async (h) => {
    await h.settings("Providers");
  },
  "settings-permissions": async (h) => {
    await h.settings("Permissions");
  },
  "settings-memory": async (h) => {
    await h.settings("Memory");
  },
  feedback: async (h) => {
    await h.go("/chats/red-and-blue-squares");
    await h.app.click({ text: "Feedback", selector: 'nav[aria-label="Places"] button' });
  },
  draft: async (h) => {
    await h.go("/chats/red-and-blue-squares");
    await h.app.click({ selector: 'nav button[aria-label="New"]' });
    h.after(() => h.app.click({ selector: 'button[aria-label="Close"]' }));
  },
  "tabs-five": async (h) => {
    await h.go("/browser");
    await h.app.goto("/chats/red-and-blue-squares", { newTab: true });
    await h.app.goto(`/files?path=&root=${encodeURIComponent(h.folder)}`, { newTab: true });
    await h.app.goto("/apps", { newTab: true });
    await h.app.goto(`/files?file=${encodeURIComponent(`${h.folder}/pricing-comparison.html`)}&path=&root=~&tree=${encodeURIComponent(h.folder)}`, { newTab: true });
    await wait(1500);
  },
  "tab-hover": async (h) => {
    for (const p of ["/new-tab", "/browser", "/release-notes"]) await h.app.goto(p, { newTab: true });
    await wait(600);
    const at = await h.app.eval(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find((e) => e.textContent.includes('Red and blue')); const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await h.app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await wait(1200);
  },
};

export default async (app, args) => {
  const out = [];
  const folder = args.folder;
  const afters = [];
  const h = {
    app,
    folder,
    after: (fn) => afters.push(fn),
    // Closes every window tab but the one up, so each state starts from one tab.
    oneTab: async () => {
      for (let i = 0; i < 20; i++) {
        const count = await app.eval(`document.querySelectorAll('[role=tablist][aria-label="Open tabs"] [role=tab]').length`);
        if (count <= 1) break;
        await app.click({ selector: '[role=tab][aria-selected=true] button[aria-label^="Close"]' });
        await wait(250);
      }
    },
    // Files the fixture's chat under the scenario's Pricing topic, as the kit's rows are.
    topic: async () => {
      const t = await app.rpc("workspace.topics.create", { name: "Pricing", emoji: "💼", color: "#ebaf86" });
      await app.rpc("workspace.chats.setTopic", { id: "red-and-blue-squares", topic: t.id });
    },
    go: async (href, ms = 900) => {
      await app.goto(href);
      await wait(ms);
    },
    showPill: () => app.eval(`[...document.querySelectorAll('[data-measure-hidden]')].filter((e) => e.textContent.includes("Can't reach")).forEach((e) => { e.style.display = ''; e.removeAttribute('data-measure-hidden'); })`),
    files: async (view, select) => {
      await app.goto(`/files?path=&root=${encodeURIComponent(folder)}${select ? `&select=${encodeURIComponent(select)}` : ""}`);
      await wait(900);
      await app.click({ text: view });
      await wait(400);
    },
    settings: async (tab) => {
      await app.goto("/chats/red-and-blue-squares");
      await wait(600);
      await app.openModal("settings");
      await wait(600);
      await app.click({ text: tab });
      h.after(() => app.closeModal());
    },
  };
  // The network pill says the API is out, which in a dev run is where the API is rather
  // than what a person sees; the states about it show it again (showPill).
  // Everything in the bar's right corner but the bell and an Update pill: the workspace
  // chip, the dev panel and server exceptions show only in developer mode, and the
  // network pill says the API is out, which in a dev run is where the API is rather
  // than what a person sees. The state about the pill shows it again (showPill).
  const hideDevChrome = () =>
    app.eval(`(() => {
      let n = document.querySelector('button[aria-label^="Notifications"]');
      for (let i = 0; i < 4 && n.parentElement.children.length <= 2; i++) n = n.parentElement;
      for (const e of n.parentElement.children) {
        if (e === n || /^Update/.test(e.textContent.trim()) || e.style.display === 'none') continue;
        e.style.display = 'none';
        e.setAttribute('data-measure-hidden', '');
      }
    })()`);

  const before = await app.rpc("preferences.get");
  await h.topic();
  await h.oneTab();
  await app.rpc("preferences.setTheme", { theme: "light" });
  await app.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait(800);
  for (const [key, run] of Object.entries(SURFACES)) {
    if (args.only && !args.only.includes(key)) continue;
    try {
      await app.press("Escape");
      await app.press("Escape");
      await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 640 });
      if (!key.startsWith("tab")) await h.oneTab();
      // A draft left open by an earlier state or run sits over everything after it.
      if (await app.eval(`!!document.querySelector('button[aria-label="Discard draft"]')`)) await app.click({ selector: 'button[aria-label="Close"]' });
      await hideDevChrome();
      await run(h);
      await wait(700);
      // Again just before the picture, since a screen coming up can draw the bar anew.
      await hideDevChrome();
      if (key === "status-pill") await h.showPill();
      await app.shot(`${args.dir}/${key}.png`);
      out.push(key);
    } catch (error) {
      out.push(`${key} FAILED: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
    }
    for (const fn of afters.splice(0)) await Promise.resolve(fn()).catch(() => {});
  }
  await app.eval(`document.querySelectorAll('[data-measure-hidden]').forEach((e) => { e.style.display = ''; e.removeAttribute('data-measure-hidden'); })`);
  if (before?.theme && before.theme !== "light") await app.rpc("preferences.setTheme", { theme: before.theme });
  await app.cdp.send("Emulation.clearDeviceMetricsOverride");
  return out;
};
