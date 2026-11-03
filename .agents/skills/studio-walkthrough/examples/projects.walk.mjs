// The Projects walkthrough: make a project, file chats under it, work inside
// it, and see that its instructions reach the agent. Starts from the
// `household` seed (household.seed.json): four chats, Claude Haiku for New.
//
//   node scripts/walkthrough.mjs take examples/projects.walk.mjs --seed household --out <take dir>
import { createAct } from "../scripts/act.mjs";

const MENU_ITEM = "[role=menu] [role^=menuitem]";

export default async (app, args) => {
  const act = await createAct(app, { out: args.out, viewport: { w: 1240, h: 840 } });
  await app.goto("/chats");
  await act.prepare();
  await act.move({ x: 860, y: 520 });
  await act.hold(600);
  await act.begin({ title: "Projects", build: args.build });
  try {
    return await take(act, app);
  } catch (error) {
    const summary = await act.end();
    return { failed: String(error), ...summary, status: summary.status.map((s) => s.kind) };
  }
};

async function take(act, app) {
  await act.hold(900);

  // 1. Make a project ------------------------------------------------------
  await act.chapter("Make a project", "A project keeps related chats together, with instructions every one of them follows.");
  await act.click({ text: "View: Chats" });
  await act.hold(350);
  await act.click({ text: "New project" });
  await act.waitFor('document.querySelector("[role=dialog]")');
  await act.hold(700);
  await act.click({ text: "Choose a mark" });
  await act.hold(300);
  await act.type("house");
  await act.hold(250);
  await act.click({ label: "house" });
  await act.hold(250);
  await act.click({ placeholder: "Name it" });
  await act.type("Kitchen remodel");
  await act.hold(300);
  await act.click({ label: "Color #ebaf86" });
  await act.hold(300);
  await act.caption("Instructions go with every chat filed here.");
  await act.click({ selector: "[role=dialog] textarea" });
  await act.type("Our budget is $25,000. Compare prices in a short table and flag anything over budget.");
  await act.hold(600);
  await act.still("new-project-dialog", "Naming a project and giving it instructions", { poster: true });
  await act.click({ text: "Create" });
  await act.hold(1400);
  await act.still("new-project-empty", "A new project, waiting for its first chat");

  // 2. File chats under it ------------------------------------------------
  await act.chapter("File chats under it", "Any chat can go under a project from its row.");
  await act.click({ contains: "Kitchen remodel", selector: "button" });
  await act.hold(300);
  await act.click({ text: "Chats", selector: MENU_ITEM });
  await act.hold(700);
  for (const row of ["Kitchen cabinet quotes", "Backsplash tile ideas"]) {
    await act.hover({ contains: row }, { ms: 450 });
    await act.click({ label: "Project" });
    await act.hold(450);
    await act.click({ contains: "Kitchen remodel", selector: MENU_ITEM });
    await act.hold(700);
  }
  await act.still("chats-filed", "Two chats filed under Kitchen remodel");

  // 3. Work inside it -----------------------------------------------------
  await act.chapter("Work inside it", "Pick the project to see only its chats and its instructions.");
  await act.click({ text: "View: Chats" });
  await act.hold(300);
  await act.click({ contains: "Kitchen remodel", selector: MENU_ITEM });
  await act.hold(900);
  await act.camera({ contains: "Our budget is", selector: "p, div" }, { zoom: 1.6 });
  await act.hold(1800);
  await act.camera(null);
  await act.click({ contains: "Kitchen cabinet quotes" });
  await act.hold(1600);
  await act.still("project-chat", "A chat filed under the project, with its pill in the title");

  // 4. Its instructions reach the agent ----------------------------------
  await act.chapter("Ask inside it", "A new chat started here follows the project's instructions.");
  await act.click({ text: "New" });
  await act.hold(900);
  await act.move({ x: 880, y: 330 });
  await act.type("Can we afford the oak shaker cabinets plus $9,000 of countertops?");
  await act.hold(400);
  const before = await act.evaluate("window.__studioDrive.state().path");
  await act.key("Enter");
  await act.caption("Instrument answers within the project's budget.");
  const sent = Date.now();
  const opened = 'window.__studioDrive.state().path.match(/^\\/chats\\/([^/?]+)/)';
  await act.waitFor(`window.__studioDrive.state().path !== ${JSON.stringify(before)} && ${opened}`, { timeout: 20000 });
  const chatId = (await act.evaluate(`${opened}[1]`));
  await app.waitForIdle({ chatId, settleMs: 800, timeout: 180000 });
  const answeredMs = Date.now() - sent;
  await act.hold(1500);
  await act.still("answer-in-project", "The answer, checked against the project's budget");
  await act.hold(1200);
  const assets = await act.assets();
  const summary = await act.end();
  return { ...summary, status: summary.status.map((s) => s.kind), answeredMs, assets, chatId };
}
