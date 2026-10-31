// ---- model picker ----------------------------------------------------------------

/** The picker's size as built: PANEL_WIDTH and PANEL_HEIGHT in model-picker.tsx. */
const PICKER_W = 680;
const PICKER_H = 520;

/** The connections in the picker's rail, in the order Settings lists them. */
const PICKER_CONNS = [
  { k: "instrument", name: "Instrument", mark: "instrumentglyph" },
  { k: "chatgpt", name: "ChatGPT plan", mark: "openai" },
  { k: "anthropic", name: "Anthropic", mark: "anthropic" },
  { k: "openrouter", name: "OpenRouter", mark: "openrouter" },
];

/** The chosen row: the pressed tint and a check at its end. */
const PICKED = "bg-accent text-accent-foreground";
const pickedCheck = `<i class="ph ph-check text-[16px]"></i>`;

/** The picker's popover placed in a window frame, `left`/`top` in the window's pixels. */
const pickerPop = (inner, { left = 0, top = 0 } = {}) => `
  <div class="absolute z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-xl" style="left:${left}px;top:${top}px;width:${PICKER_W}px;height:${PICKER_H}px">${inner}</div>`;

/** The picker alone, filling a PICKER_W x PICKER_H frame, for a frame about what is inside it. */
const pickerCrop = (inner) =>
  `<div class="flex h-full flex-col bg-popover text-foreground [color-scheme:light]">${inner}</div>`;

const pickerSearch = (q = "") => `
  <div class="shrink-0 border-b border-border p-2">
    <div class="flex h-8 items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 text-[14px]">
      <i class="ph ph-magnifying-glass text-[15px] text-muted-foreground"></i>
      <span class="${q ? "" : "text-muted-foreground"}">${q || "Search models"}</span>${q ? `<span class="-ml-1.5 h-4 w-px bg-foreground"></span>` : ""}
    </div>
  </div>`;

/** The rail: `open` is lit, `held` (the connection with the chosen model) carries a small check, `mark` gets the click. */
const pickerRail = (open, { held = "", mark = "" } = {}) => `
  <div class="flex w-50 shrink-0 flex-col gap-0.5 border-r border-border bg-muted/40 p-2">
    ${PICKER_CONNS.map((c) => {
      const it = `<div class="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-[14px] ${open === c.k ? "bg-black/[0.06] font-medium" : ""}">${brand(c.mark)}<span class="min-w-0 flex-1 truncate">${c.name}</span>${held === c.k ? `<i class="ph ph-check text-[14px] text-muted-foreground"></i>` : ""}</div>`;
      return mark === c.k ? clickable(it) : it;
    }).join("")}
    <div class="flex-1"></div>
    <div class="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-[14px] text-muted-foreground"><i class="ph ph-plus text-[16px]"></i>Add a provider</div>
  </div>`;

/** A group label in the list (a maker under OpenRouter, Older versions). */
const pickerHead = (t, mark = "") =>
  `<div class="flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-[12px] font-medium text-muted-foreground">${mark ? brand(mark, "size-3.5") : ""}${t}</div>`;

/** A model row as ModelRow draws it: the maker's mark, the name, an optional line under it, the check when chosen. */
const pickerRow = (name, { mark = "", sub = "", on = false } = {}) => `
  <div class="flex items-center gap-2.5 rounded-md px-2.5 ${sub ? "py-1.5" : "min-h-9"} ${on ? PICKED : ""}">
    ${mark ? brand(mark) : ""}
    <span class="flex min-w-0 flex-1 flex-col"><span class="truncate text-[14px] ${on ? "font-medium" : ""}">${name}</span>${sub ? `<span class="truncate text-[12px] ${on ? "opacity-80" : "text-muted-foreground"}">${sub}</span>` : ""}</span>
    ${on ? pickedCheck : ""}
  </div>`;

/** Auto as AutoRow draws it at the head of a longer Instrument list, with the rule under it. */
const pickerAutoRow = ({ on = false } = {}) => `
  <div class="flex min-h-9 items-center gap-2.5 rounded-md px-2.5 ${on ? PICKED : ""}">
    ${brand("instrumentglyph")}
    <span class="flex min-w-0 flex-1 items-baseline gap-2"><span class="text-[14px] ${on ? "font-medium" : ""}">Auto</span><span class="text-[12px] font-medium text-brand-700">Recommended</span><span class="truncate text-[12px] ${on ? "opacity-80" : "text-muted-foreground"}">Included with your subscription</span></span>
    ${on ? pickedCheck : ""}
  </div>
  <div class="mx-2.5 my-2 h-px bg-border"></div>`;

/** Auto as AutoOnly draws it when it is all Instrument offers: centered, with its one button. */
const pickerAutoOnly = ({ on = false } = {}) => `
  <div class="flex flex-col items-center gap-3 px-6 pt-16 pb-10 text-center">
    ${brand("instrumentglyph", "size-9")}
    <div class="flex flex-col items-center gap-1">
      <span class="flex items-center gap-2 text-[16px] font-medium">Auto<span class="text-[12px] font-medium text-brand-700">Recommended</span></span>
      <span class="text-[14px] text-muted-foreground">Included with your subscription</span>
    </div>
    ${on ? `<span class="mt-1 flex h-8 items-center gap-1.5 px-3 text-[14px] font-medium"><i class="ph ph-check text-[16px]"></i>In use</span>` : `<span class="mt-1 flex h-8 items-center rounded-lg bg-brand-600 px-3 text-[14px] font-medium text-white">Use Auto</span>`}
  </div>`;

/** The whole panel: search over the rail and the open connection's list. */
const modelPicker = ({
  open = "instrument",
  held = "",
  list = "",
  q = "",
  mark = "",
} = {}) =>
  `${pickerSearch(q)}<div class="flex min-h-0 flex-1">${pickerRail(q ? "" : open, { held, mark })}<div class="min-w-0 flex-1 overflow-hidden p-2">${list}</div></div>`;
