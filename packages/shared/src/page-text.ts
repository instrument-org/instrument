import { z } from "zod";

/** The most of a page `instrument window read` hands back, which bounds what crosses to the sandbox. */
export const PAGE_TEXT_MAX = 200_000;

/** The most form fields a read lists, and of one field's value. */
const FIELDS_MAX = 200;
const VALUE_MAX = 300;

/**
 * Runs in the page: its text as rendered, lines kept, and a line per form
 * field on screen with what it holds now, since the rendered text leaves out
 * what is typed into a field, so a filled form reads the same as an empty one
 * without it. A password field says only whether it is filled.
 */
export const READ_PAGE_TEXT = `(() => {
  const fold = (words) => String(words ?? "").replace(/\\s+/g, " ").trim();
  const skip = new Set(["hidden", "submit", "button", "reset", "image", "file"]);
  // A label's own words, without the text of a control inside it (a select's options).
  const labelText = (label) => {
    if (!label) return "";
    const copy = label.cloneNode(true);
    copy.querySelectorAll("select, textarea, input").forEach((control) => control.remove());
    return fold(copy.textContent);
  };
  const labelOf = (el) =>
    fold(
      labelText(el.labels && el.labels[0]) ||
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.id ||
        "",
    ).slice(0, 80) || "(unlabeled)";
  const quote = (value) => {
    const text = String(value);
    return text === ""
      ? "empty"
      : JSON.stringify(text.length > ${VALUE_MAX} ? text.slice(0, ${VALUE_MAX}) + "…" : text);
  };
  const fields = [];
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (fields.length >= ${FIELDS_MAX}) break;
    if (el.getClientRects().length === 0) continue;
    const label = labelOf(el);
    if (el instanceof HTMLSelectElement) {
      const picked = [...el.selectedOptions].map((option) => fold(option.text));
      fields.push(label + " (select): " + (picked.length ? picked.map(quote).join(", ") : "nothing picked"));
    } else if (el instanceof HTMLTextAreaElement) {
      fields.push(label + " (text area): " + quote(el.value));
    } else {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (skip.has(type)) continue;
      if (type === "checkbox" || type === "radio") {
        fields.push(label + " (" + type + "): " + (el.checked ? "checked" : "not checked"));
      } else if (type === "password") {
        fields.push(label + " (password): " + (el.value ? "filled, hidden here" : "empty"));
      } else {
        fields.push(label + ": " + quote(el.value));
      }
    }
  }
  return { fields, text: String(document.body?.innerText ?? "") };
})()`;

const PageTextSchema = z.object({
  fields: z.array(z.string()),
  text: z.string(),
});

/**
 * What a read hands back from what `READ_PAGE_TEXT` returned: the page's
 * text, cut to leave room for the fields, then the fields under a heading.
 * Nothing when the page answered with something else.
 */
export function pageTextOf(raw: unknown): string | undefined {
  const parsed = PageTextSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  const { fields, text } = parsed.data;
  const block =
    fields.length === 0
      ? ""
      : `\n\nForm fields, as they are filled in now:\n${fields.join("\n")}`;
  return text.slice(0, Math.max(0, PAGE_TEXT_MAX - block.length)) + block;
}
