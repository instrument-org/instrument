# Recipes

Setups and traps from earlier runs. `app` is the object a `studio-drive.mjs run` script gets. Add to this file when a run needed a setup or hit a trap that isn't here.

## Fixture state

The `documents` fixture (`fixtures/workspaces/documents/`) has one chat, `red-and-blue-squares`, and it starts archived, so the Inbox is empty until you unarchive it.

```js
await app.rpc("workspace.chats.unarchive", { id: "red-and-blue-squares" });
await app.rpc("workspace.chats.unread", { id: "red-and-blue-squares" });
```

A project, with a folder added to it. A second `create` with the same name fails with BAD_REQUEST, and the fixture keeps projects between runs of one boot, so create once per boot.

```js
await app.rpc("workspace.projects.create", {
  name: "Quickbooks", emoji: "🧾", color: "green",
  instructions: "Things to remember.",
  folders: [{ path: "<an absolute folder in your scratchpad>" }],
});
```

Project settings: `app.click("<project>")`, `app.click("Edit")`, then `app.waitFor('document.querySelector("[role=dialog]")')`. Its delete confirmation is `app.click("Delete project")`, then `[role=alertdialog]`.

The Unread filter: click the search field, then the Unread token it offers.

```js
await app.click({ selector: 'input[placeholder="Search"]' });
await app.click("Unread");
```

Tabs, for "how many opened": `(await app.state()).tabs`.

## Traps

- `app.click("Search")` finds nothing: a placeholder isn't text. Use a selector.
- Text split over several nodes doesn't match `app.click(text)` or a `textContent ===` on the first node. Filter and take the innermost: `[...document.querySelectorAll('*')].filter(e => e.textContent === "…").pop()`.
- After navigating, the project rail may not be on screen. Click "Inbox" first, and clear any filter left from an earlier step.
- `app.shot(name, { selector })` crops to an element; mark the element first with a `data-probe` attribute when it has no stable selector.
- There's no dictation in a dev build. Picture a mic or dictation bug from the report's still, or append a stand-in element with the same classes to measure where it would sit.
- A permission prompt, setup's folder step or a first launch needs a scenario (`--scenario`) or the macOS VM (`test-studio-on-mac`). Usually that's over budget: use the report's still.

## Mocking an after

Edit the DOM in an `eval`, then shoot. Swapping a line of copy:

```js
await app.eval(`(() => {
  const el = [...document.querySelectorAll('*')]
    .filter(e => e.textContent === "New chats here go into Notion.").pop();
  el.textContent = "New chats here go into this project.";
})()`);
await app.shot("B-after.png", { selector: "main" });
```

For a dialog variant, replace the description's `innerHTML` and the button's text, using the app's own classes (`text-sm`, `text-muted-foreground`, `border`) so the mock matches the theme.
