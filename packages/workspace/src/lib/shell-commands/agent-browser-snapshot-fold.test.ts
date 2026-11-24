import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agentBrowserPath } from "../agent-browser";
import {
  foldSnapshotText,
  parseSnapshot,
  renderSnapshot,
} from "./agent-browser-snapshot-fold";

const tree = (text: string) => {
  const parsed = parseSnapshot(text);
  if (!parsed) {
    throw new Error("the fixture is not a snapshot");
  }
  return parsed;
};

describe("parseSnapshot", () => {
  // One line for each thing `render_tree` in the CLI's snapshot.rs can print.
  const everyKind = [
    '- navigation "Primary" [ref=e4]',
    '  - link "Say \\"hi\\" [now]" [ref=e5]',
    "  - link [ref=e6]",
    '  - button "More" [expanded=false, ref=e7] hint="icon:chevron"',
    '  - generic "Row" [ref=e8] clickable [cursor:pointer, onclick]',
    '    - checkbox "Pick" [checked=mixed, disabled, required, ref=e9]',
    '- heading "Orders" [level=1, ref=e10]',
    '- textbox "Name" [ref=e11]: Ada: Lovelace',
    "- combobox [expanded=false, ref=e12]: All",
    '  - option "All" [selected, ref=e13]',
  ].join("\n");

  it("reads every kind of line and prints it back unchanged", () => {
    expect(renderSnapshot(tree(everyKind))).toBe(everyKind);
    expect(
      tree(everyKind).map(function pick({
        attrs,
        children,
        name,
        ref,
        role,
        tail,
      }): string {
        return [
          `${role} ${name} @${ref} [${attrs.join("|")}]${tail}`,
          ...children.map((child) => `  ${pick(child)}`),
        ].join("\n");
      }),
    ).toMatchInlineSnapshot(`
      [
        "navigation "Primary" @e4 []
        link "Say \\"hi\\" [now]" @e5 []
        link  @e6 []
        button "More" @e7 [expanded=false] hint="icon:chevron"
        generic "Row" @e8 [] clickable [cursor:pointer, onclick]
        checkbox "Pick" @e9 [checked=mixed|disabled|required]",
        "heading "Orders" @e10 [level=1]",
        "textbox "Name" @e11 []: Ada: Lovelace",
        "combobox  @e12 [expanded=false]: All
        option "All" @e13 [selected]",
      ]
    `);
  });

  it.each([
    [
      "a field whose value runs over several lines",
      '- textbox "Message" [ref=e2]: first line\n\nsecond line\n- button "Send" [ref=e3]',
    ],
    [
      "a typed list in a field's value, whose lines have no ref",
      '- textbox "Notes" [ref=e2]: Shopping\n- milk\n- eggs',
    ],
    [
      "a value that repeats a ref of the page",
      '- textbox "Notes" [ref=e2]: pasted\n- button "Send" [ref=e3]\n- button "Send" [ref=e3]',
    ],
    [
      "a line two levels under the one before",
      '- link "A" [ref=e1]\n    - link "B" [ref=e2]',
    ],
    ["a page with no controls", "(no interactive elements)"],
    ["a delta", '{\n  "kind": "delta"\n}'],
  ])("reads nothing from %s", (_, text) => {
    expect(parseSnapshot(text)).toBeUndefined();
    expect(foldSnapshotText(text)).toBe(text);
  });
});

describe("foldSnapshotText", () => {
  it("folds a closed combobox's options into one line of their names", () => {
    expect(
      foldSnapshotText(
        [
          '- navigation "Primary" [ref=e4]',
          "  - combobox [expanded=false, ref=e34]: All Departments",
          '    - option "All Departments" [selected, ref=e78]',
          '    - option "Black Friday" [ref=e79]',
          '    - option "Sold out, \\"soon\\"" [disabled, ref=e80]',
          '  - searchbox "Search" [ref=e35]',
        ].join("\n"),
      ),
    ).toMatchInlineSnapshot(`
      "- navigation "Primary" [ref=e4]
        - combobox [expanded=false, ref=e34]: All Departments
          - 3 options, chosen with \`select @e34 <name>\`: "All Departments" [selected], "Black Friday", "Sold out, \\"soon\\"" [disabled]
        - searchbox "Search" [ref=e35]"
    `);
  });

  it.each([
    [
      "an open combobox",
      '- combobox [expanded=true, ref=e1]\n  - option "A" [ref=e2]\n  - option "B" [ref=e3]',
    ],
    [
      "a combobox that does not say whether it is open",
      '- combobox [ref=e1]\n  - option "A" [ref=e2]',
    ],
    [
      "a listbox, whose options are on screen",
      '- listbox "slider" [ref=e1]\n  - option "slide 1 of 6" [selected, ref=e2]\n  - option "slide 2 of 6" [ref=e3]',
    ],
    [
      "a combobox with a listbox in it",
      '- combobox [expanded=false, ref=e1]\n  - listbox [ref=e2]\n    - option "A" [ref=e3]',
    ],
    [
      "a combobox with anything but options in it",
      '- combobox [expanded=false, ref=e1]\n  - button "Clear" [ref=e2]\n  - option "A" [ref=e3]',
    ],
    [
      "options that print more than a name",
      '- combobox [expanded=false, ref=e1]\n  - option "A" [ref=e2] hint="icon:star"\n  - option "B" [ref=e3] hint="icon:moon"',
    ],
    [
      "two options of one name",
      '- combobox [expanded=false, ref=e1]\n  - option "A" [ref=e2]\n  - option "A" [ref=e3]',
    ],
    [
      "an option with no name",
      '- combobox [expanded=false, ref=e1]\n  - option [selected, ref=e2]\n  - option "A" [ref=e3]',
    ],
    [
      "options that take fewer characters than the line would",
      '- combobox [expanded=false, ref=e1]\n  - option "A" [ref=e2]\n  - option "B" [ref=e3]',
    ],
    [
      "a combobox with no options",
      '- combobox "City" [expanded=false, ref=e1]',
    ],
    [
      "a menu, a tab list, a tree and a grid",
      '- menuitem "File" [expanded=false, ref=e1]\n  - menuitem "Open" [ref=e2]\n- tab "One" [selected, ref=e3]\n- treeitem "src" [expanded=false, ref=e4]\n  - treeitem "lib" [ref=e5]\n- gridcell "A1" [ref=e6]',
    ],
  ])("leaves %s as printed", (_, text) => {
    expect(foldSnapshotText(text)).toBe(text);
  });
});

const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Snapshot fold fixture</title>
  </head>
  <body>
    <nav aria-label="Primary">
      <a href="#orders">Orders</a>
    </nav>
    <h1>Order a shirt</h1>
    <label for="size">Size</label>
    <select id="size">
      <option>Small</option>
      <option selected>Medium</option>
      <option disabled>Large, tall</option>
      <option value="xl">Extra "wide" [XL]</option>
    </select>
    <label for="qty">Quantity</label>
    <select id="qty">
      <optgroup label="Few"><option>1</option><option>2</option></optgroup>
      <optgroup label="Many"><option>10</option><option>20</option><option>50</option></optgroup>
    </select>
    <select aria-label="Plan">
      <option value="">Choose</option>
      <option value="a">Monthly</option>
      <option value="b">Monthly</option>
      <option>Yearly</option>
      <option>Every two years</option>
    </select>
    <select aria-label="Gift"><option>No</option><option>Yes</option></select>
    <select aria-label="Sizes in stock" multiple>
      <option>S</option>
      <option selected>M</option>
    </select>
    <div role="combobox" tabindex="0" aria-label="Fit" aria-expanded="false" aria-controls="fits">Regular</div>
    <div role="combobox" tabindex="0" aria-label="Sleeve" aria-expanded="true" aria-owns="sleeves">Long</div>
    <ul id="sleeves" role="listbox" aria-label="Sleeve lengths">
      <li role="option" aria-selected="true" tabindex="-1">Long</li>
      <li role="option" tabindex="-1">Short</li>
    </ul>
    <ul role="listbox" aria-label="Gift wrap">
      <li role="option" aria-selected="true" tabindex="0">None</li>
      <li role="option" tabindex="-1">Paper</li>
    </ul>
    <label for="note">Note</label>
    <textarea id="note">Leave it at the door</textarea>
    <button type="button">Add to cart</button>
  </body>
</html>
`;

/** A value whose later lines read as controls, one of them with a ref of the page's. */
const MULTI_LINE_VALUE = [
  "Shopping:",
  "- milk",
  '- combobox "Pasted" [expanded=false, ref=e2]',
  '  - option "One" [ref=e9001]',
].join("\n");

// The fold reads the text the installed CLI prints, which is the only form
// the CLI gives the tree in. This takes a snapshot of a real page with the
// real binary and a headless browser, so a release that prints the tree
// another way fails here rather than leaving every snapshot unfolded.
describe("the installed agent-browser's snapshot of a real page", () => {
  const session = `snapshot-fold-test-${process.pid}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-fold-"));
  const run = (...args: string[]) =>
    execFileSync(agentBrowserPath(), ["--session", session, ...args], {
      encoding: "utf8",
      env: { ...process.env, AGENT_BROWSER_IDLE_TIMEOUT_MS: "60000" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
  /** Why the page could not be opened: a computer with no browser to launch. */
  let noBrowser: string | undefined;

  beforeAll(() => {
    const page = path.join(dir, "page.html");
    fs.writeFileSync(page, FIXTURE);
    try {
      run("open", pathToFileURL(page).href);
    } catch (error) {
      noBrowser = String(error);
    }
  }, 60_000);

  afterAll(() => {
    try {
      run("close");
    } catch {
      // Nothing was opened.
    }
    fs.rmSync(dir, { force: true, recursive: true });
  });

  it("reads back byte for byte and folds only the closed selects", (context) => {
    if (noBrowser !== undefined) {
      context.skip(`agent-browser could not open a page: ${noBrowser}`);
    }
    const text = run("snapshot", "-i").trimEnd();

    expect(text).toMatchInlineSnapshot(`
      "- navigation "Primary" [ref=e1]
        - link "Orders" [ref=e13]
      - heading "Order a shirt" [level=1, ref=e2]
      - combobox "Size" [expanded=false, ref=e3]: Medium
        - option "Small" [ref=e19]
        - option "Medium" [selected, ref=e20]
        - option "Large, tall" [disabled, ref=e21]
        - option "Extra \\"wide\\" [XL]" [ref=e22]
      - combobox "Quantity" [expanded=false, ref=e4]: 1
        - option "1" [selected, ref=e32]
        - option "2" [ref=e33]
        - option "10" [ref=e34]
        - option "20" [ref=e35]
        - option "50" [ref=e36]
      - combobox "Plan" [expanded=false, ref=e5]: Choose
        - option "Choose" [selected, ref=e23]
        - option "Monthly" [ref=e24]
        - option "Monthly" [ref=e25]
        - option "Yearly" [ref=e26]
        - option "Every two years" [ref=e27]
      - combobox "Gift" [expanded=false, ref=e6]: No
        - option "No" [selected, ref=e28]
        - option "Yes" [ref=e29]
      - listbox "Sizes in stock" [ref=e7]
        - option "S" [ref=e14]
        - option "M" [selected, ref=e15]
      - combobox "Fit" [expanded=false, ref=e8]: Regular
      - combobox "Sleeve" [expanded=true, ref=e9]: Long Long
        - listbox "Sleeve lengths" [ref=e16]
          - option "Long" [selected, ref=e30]
          - option "Short" [ref=e31]
      - listbox "Gift wrap" [ref=e10]
        - option "None" [selected, ref=e17]
        - option "Paper" [ref=e18]
      - textbox "Note" [ref=e11]: Leave it at the door
      - button "Add to cart" [ref=e12]"
    `);
    expect(renderSnapshot(tree(text))).toBe(text);
    expect(foldSnapshotText(text)).toMatchInlineSnapshot(`
      "- navigation "Primary" [ref=e1]
        - link "Orders" [ref=e13]
      - heading "Order a shirt" [level=1, ref=e2]
      - combobox "Size" [expanded=false, ref=e3]: Medium
        - 4 options, chosen with \`select @e3 <name>\`: "Small", "Medium" [selected], "Large, tall" [disabled], "Extra \\"wide\\" [XL]"
      - combobox "Quantity" [expanded=false, ref=e4]: 1
        - 5 options, chosen with \`select @e4 <name>\`: "1" [selected], "2", "10", "20", "50"
      - combobox "Plan" [expanded=false, ref=e5]: Choose
        - option "Choose" [selected, ref=e23]
        - option "Monthly" [ref=e24]
        - option "Monthly" [ref=e25]
        - option "Yearly" [ref=e26]
        - option "Every two years" [ref=e27]
      - combobox "Gift" [expanded=false, ref=e6]: No
        - option "No" [selected, ref=e28]
        - option "Yes" [ref=e29]
      - listbox "Sizes in stock" [ref=e7]
        - option "S" [ref=e14]
        - option "M" [selected, ref=e15]
      - combobox "Fit" [expanded=false, ref=e8]: Regular
      - combobox "Sleeve" [expanded=true, ref=e9]: Long Long
        - listbox "Sleeve lengths" [ref=e16]
          - option "Long" [selected, ref=e30]
          - option "Short" [ref=e31]
      - listbox "Gift wrap" [ref=e10]
        - option "None" [selected, ref=e17]
        - option "Paper" [ref=e18]
      - textbox "Note" [ref=e11]: Leave it at the door
      - button "Add to cart" [ref=e12]"
    `);
  });

  it("chooses an option of a folded select by the name on its line", (context) => {
    if (noBrowser !== undefined) {
      context.skip(`agent-browser could not open a page: ${noBrowser}`);
    }
    run("select", "@e3", 'Extra "wide" [XL]');

    expect(run("get", "value", "@e3").trim()).toBe("xl");
  });

  it("leaves a page with a field value of several lines as printed", (context) => {
    if (noBrowser !== undefined) {
      context.skip(`agent-browser could not open a page: ${noBrowser}`);
    }
    run(
      "eval",
      `document.querySelector("#note").value = ${JSON.stringify(MULTI_LINE_VALUE)}; 1`,
    );
    const text = run("snapshot", "-i").trimEnd();

    expect(text).toContain(MULTI_LINE_VALUE);
    expect(foldSnapshotText(text)).toBe(text);
  });
});
