// ---- controls -------------------------------------------------------------------
// Studio's buttons and form controls (components/ui), for dialogs, Settings and cards,
// so a frame never hand-rolls a switch or a checkbox again.

/**
 * A button as ui/button.tsx draws it. `tone`: default (white, raised), brand (the green
 * fill), secondary, outline, ghost, destructive or link; `size`: default (36), sm (32),
 * xs (24) or lg (40). `icon` is a Phosphor name that leads the label; `round` makes it a pill.
 */
const button = (label, { tone = "default", size = "default", icon = "", cls = "", round = false } = {}) => {
  const tones = {
    default: "bg-card text-card-foreground shadow-sm ring-1 ring-black/5",
    brand: "bg-brand-600 text-white shadow-xs",
    secondary: "bg-secondary text-secondary-foreground shadow-xs",
    outline: "border border-black/5 text-muted-foreground",
    ghost: "text-foreground",
    destructive: "bg-destructive text-white",
    link: "text-primary underline underline-offset-4",
  };
  const sizes = {
    default: "h-9 gap-2 px-4 text-sm",
    sm: "h-8 gap-1.5 px-3 text-sm",
    xs: "h-6 gap-1.5 px-2.5 text-xs",
    lg: "h-10 gap-2 px-6 text-sm",
  };
  return `<span class="inline-flex shrink-0 items-center justify-center ${round ? "rounded-full" : "rounded-lg"} font-medium whitespace-nowrap ${sizes[size]} ${tones[tone]} ${cls}">${icon ? `<i class="ph ph-${icon} text-[15px]"></i>` : ""}${label}</span>`;
};

/** A square icon button: `ring` for the ringed toolbar kind Files uses, `on` for pressed. */
const iconButton = (icon, { size = 8, ring = false, on = false, cls = "" } = {}) =>
  `<span class="grid ${size === 7 ? "size-7" : size === 6 ? "size-6" : "size-8"} shrink-0 place-items-center rounded-lg ${ring ? "bg-card ring-1 ring-border" : ""} ${on ? "bg-foreground/8 text-foreground" : "text-foreground/70"} ${cls}"><i class="ph ph-${icon} text-[16px]"></i></span>`;

/** A switch (ui/switch.tsx), on in the brand's dark ink, off in the input grey. */
const toggle = (on = false) =>
  `<span class="inline-flex h-[18px] w-8 shrink-0 items-center rounded-full p-px shadow-xs ${on ? "bg-primary" : "bg-input"}"><span class="block size-4 rounded-full bg-background shadow-xs ${on ? "translate-x-[14px]" : ""}"></span></span>`;

/** A checkbox (ui/checkbox.tsx): `on` checked, `"mixed"` for the dash. */
const checkbox = (on = false) =>
  on
    ? `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-primary text-primary-foreground"><i class="ph ph-${on === "mixed" ? "minus" : "check"} text-[12px]"></i></span>`
    : `<span class="size-4 shrink-0 rounded-[4px] border border-input bg-card shadow-xs"></span>`;

/** A radio dot (ui/radio-group.tsx). */
const radio = (on = false) =>
  `<span class="grid size-4 shrink-0 place-items-center rounded-full border ${on ? "border-primary" : "border-input bg-card"} shadow-xs">${on ? `<span class="size-2 rounded-full bg-primary"></span>` : ""}</span>`;

/** A segmented control: `options` are labels (or [label, icon]), `on` the chosen index. */
const segmented = (options, on = 0) =>
  `<span class="inline-flex h-8 shrink-0 items-center rounded-lg bg-foreground/8 p-0.5 text-[13px]">${options
    .map((o, i) => {
      const [label, icon] = Array.isArray(o) ? o : [o, ""];
      return `<span class="flex h-7 items-center gap-1.5 rounded-md px-2.5 ${i === on ? "bg-background font-medium text-foreground shadow-xs" : "text-foreground/60"}">${icon ? `<i class="ph ph-${icon} text-[14px]"></i>` : ""}${label}</span>`;
    })
    .join("")}</span>`;

/** A select's trigger (the `input-select` button): the value and a caret, `icon` leading it. */
const selectBox = (value, { icon = "", w = "" } = {}) =>
  `<span class="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-gradient-to-b from-white to-[#fafaf9] px-3 text-sm text-foreground shadow-sm ring-1 ring-black/5" ${w ? `style="width:${w}px"` : ""}>${icon ? `<i class="ph ph-${icon} text-[16px]"></i>` : ""}<span class="min-w-0 flex-1 truncate">${value}</span><i class="ph ph-caret-down text-[12px] text-muted-foreground"></i></span>`;

/** A text field (ui/input.tsx). `value` in ink, else `ph` as its placeholder; `focus` rings it. */
const textField = ({ value = "", ph = "", icon = "", focus = false, h = 9, cls = "" } = {}) =>
  `<span class="flex ${h === 8 ? "h-8" : "h-9"} min-w-0 items-center gap-2 rounded-lg border bg-card px-3 text-sm shadow-xs ${focus ? "border-ring ring-3 ring-ring/30" : "border-input"} ${cls}">${icon ? `<i class="ph ph-${icon} text-[15px] text-muted-foreground"></i>` : ""}<span class="min-w-0 flex-1 truncate ${value ? "text-foreground" : "text-muted-foreground"}">${value || ph}</span>${focus ? `<span class="-ml-2 h-4 w-px bg-foreground"></span>` : ""}</span>`;

/** A many-line field (ui/textarea.tsx). */
const textArea = ({ value = "", ph = "", rows = 3, focus = false } = {}) =>
  `<div class="rounded-lg border bg-card px-3 py-2 text-sm leading-5 shadow-xs ${focus ? "border-ring ring-3 ring-ring/30" : "border-input"}" style="min-height:${rows * 20 + 18}px"><span class="${value ? "" : "text-muted-foreground"}">${value || ph}</span></div>`;

/** A small badge (ui/badge.tsx): `tone` default, brand, warn or muted. */
const badge = (label, { tone = "muted" } = {}) =>
  `<span class="inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium ${{ default: "bg-foreground text-background", brand: "bg-brand-50 text-brand-700", warn: "bg-yellow-50 text-yellow-800 ring-1 ring-yellow-200", muted: "bg-foreground/6 text-muted-foreground" }[tone]}">${label}</span>`;

/** A usage meter: `filled` from 0 to 1, `tone` brand or warn. */
const meter = (filled, { tone = "brand", w = "100%" } = {}) =>
  `<span class="block h-1.5 overflow-hidden rounded-full bg-foreground/8" style="width:${w}"><span class="block h-full rounded-full ${tone === "warn" ? "bg-warning-500" : "bg-brand-500"}" style="width:${Math.round(filled * 100)}%"></span></span>`;

/** A spinner (ui/spinner.tsx). */
const spinner = (cls = "text-[16px] text-muted-foreground") =>
  `<i class="ph ph-circle-notch animate-spin ${cls}"></i>`;
