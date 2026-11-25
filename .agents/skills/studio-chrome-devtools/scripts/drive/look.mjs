// What the window shows, as text a script prints or a failure carries.
// Pure over `__studioDrive.look()` and what the words read beside it
// (look.test.mjs).

/** One group as a line, with its sides under it. */
function groupLines(group) {
  const sides = group.sides.map((side) =>
    side.tabs
      .map((tab) => `${tab.isUp ? "[" : ""}${tab.title || "(untitled)"}${tab.isUp ? "]" : ""}`)
      .join(" "),
  );
  const title =
    group.sides
      .map((side) => side.tabs.find((tab) => tab.isUp)?.title ?? "")
      .filter(Boolean)
      .join(" | ") || "(empty)";
  const lines = [
    `${group.isUp ? "▶" : " "} ${title}${group.isPinned ? " (pinned)" : ""}`,
  ];
  if (group.isUp || group.sides.some((side) => side.tabs.length > 1)) {
    group.sides.forEach((side, index) => {
      const where =
        group.sides.length === 1 ? "tabs" : index === 0 ? "left" : "right";
      const keyboard =
        group.sides.length > 1 && side.hasKeyboard ? " (keyboard)" : "";
      lines.push(`    ${where}${keyboard}: ${sides[index]}`);
    });
  }
  return lines;
}

/**
 * The summary: the window, its groups and tabs ([up]), the address of what
 * is up, and whatever stands in front (a dialog, a menu, toasts), then the
 * screen as an outline when given.
 */
export function describeLook(look, extras = {}) {
  const lines = [
    `window ${look.window.width}x${look.window.height}${look.window.zoom === 1 ? "" : ` zoom ${look.window.zoom}`}, ${look.theme}, sidebar ${look.sidebarOpen ? "open" : "hidden"}${look.project ? `, project ${look.project}` : ""}`,
    "groups:",
    ...look.groups.flatMap((group) => groupLines(group).map((line) => `  ${line}`)),
  ];
  const up = look.groups.find((group) => group.isUp);
  const keyboardSide =
    up?.sides.find((side) => side.hasKeyboard) ?? up?.sides[0];
  const tab = keyboardSide?.tabs.find((each) => each.isUp);
  if (tab) {
    lines.push(`up: ${tab.kind} ${tab.address}`);
  }
  if (extras.focus) {
    lines.push(`keyboard: ${extras.focus}`);
  }
  for (const dialog of extras.dialogs ?? []) {
    lines.push(`dialog: ${dialog}`);
  }
  if (extras.menu) {
    lines.push(`menu: ${extras.menu.join(" | ")}`);
  }
  for (const toast of extras.toasts ?? []) {
    lines.push(`toast: ${toast}`);
  }
  if (extras.busy?.length) {
    lines.push(`still busy: ${extras.busy.join(", ")}`);
  }
  if (extras.screen) {
    lines.push("screen:", extras.screen.replaceAll(/^/gm, "  "));
  }
  return lines.join("\n");
}

/** The rows of a menu as one line each shows them: `Copy  ⌘C`, `✓ Show Bookmarks Bar`. */
export function menuLines(rows, depth = 0) {
  return rows.flatMap((row) => [
    `${"  ".repeat(depth)}${row.checked ? "✓ " : ""}${row.label.replaceAll(/&(?!&)/g, "")}${row.enabled ? "" : " (disabled)"}${row.accelerator ? `  ${row.accelerator}` : ""}`,
    ...(row.submenu && depth < 1 ? menuLines(row.submenu, depth + 1) : []),
  ]);
}
