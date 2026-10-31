// ---- composing ------------------------------------------------------------------
// Measured off the documents fixture (2026-10-04) at 1240x840: the draft is a compose
// window 600 wide, 20 from the window's right edge and flush to its foot, with a 48px
// head. The reply box opens up into a row over the words while the caret is in it.

/** The model control: the provider's mark and the model's name, muted, with a caret. `warn` is the amber unavailable state. */
const modelTrigger = (
  name,
  { mark = "instrumentglyph", warn = false } = {},
) => `
  <span class="flex h-6 min-w-0 items-center gap-2 rounded-lg px-1.5 text-[12px] font-medium ${warn ? "text-warning-700" : "text-gray-400"}">${warn ? `<i class="ph ph-warning text-[16px]"></i>` : brand(mark)}<span class="truncate">${name}</span><i class="ph ph-caret-down text-[11px]"></i></span>`;

/** The amber bar that leads the reply box, and the draft under its head, when the chosen model has a problem, with the way to fix it (`action`) at its end. */
const modelProblem = (text, { action = "Add a provider" } = {}) =>
  `<span class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg bg-yellow-50 py-1 pr-1 pl-2.5 text-[12px] text-yellow-900 ring-1 ring-yellow-200"><i class="ph ph-warning text-[16px] text-yellow-700"></i><span class="min-w-0 flex-1 truncate">${text}</span>${action ? `<span class="flex h-6 shrink-0 items-center rounded-md bg-white px-2 font-medium text-foreground shadow-xs ring-1 ring-border">${action}</span>` : ""}</span>`;

/** The draft: a compose window docked at the window's bottom right. Pass it as appWindow's `over`. `model` is the head's model control; `over` draws on top of the compose window (a picker hanging from its head). */
const composeWin = ({
  title = "New chat",
  model = modelTrigger("Auto"),
  words = "",
  ph = "What do you need?",
  h = 600,
  over = "",
} = {}) => `
  <div class="absolute bottom-0 z-40 flex w-[600px] flex-col rounded-t-2xl border border-b-0 border-border bg-card shadow-2xl" style="right:20px;height:${h}px">
    <div class="flex h-12 shrink-0 items-center gap-1.5 px-3">
      <span class="flex h-7 items-center px-1.5 text-[13px] font-medium">${title}</span>
      <span class="flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground"><i class="ph ph-plus text-[12px]"></i>Topic</span>
      <div class="ml-auto flex min-w-0 items-center gap-2 pl-2">${model}<span class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span></div>
      <div class="ml-1 flex shrink-0 items-center gap-0.5 border-l border-border pl-2 text-muted-foreground">${["minus", "arrows-out-simple", "x"].map((i) => `<span class="grid size-7 place-items-center"><i class="ph ph-${i} text-[16px]"></i></span>`).join("")}</div>
    </div>
    <div class="min-h-24 flex-1 px-4 pt-1 text-[15px] leading-6 ${words ? "" : "text-gray-400"}">${words || ph}</div>
    <div class="mx-2 flex shrink-0 flex-col gap-4 rounded-t-xl bg-gray-200 p-4">
      <div class="grid grid-cols-3 gap-4">${[
        ["globe", "Browser"],
        ["desktop", "This Mac"],
        ["squares-four", "Apps"],
      ]
        .map(
          ([i, l]) =>
            `<div class="flex flex-col items-center gap-2"><div class="grid h-28 w-full place-items-center rounded-xl bg-card ring-1 ring-border"><i class="ph ph-${i} text-[28px] text-muted-foreground"></i></div><span class="text-[13px] font-medium">${l}</span></div>`,
        )
        .join("")}</div>
      <div class="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-1.5 text-[12px] text-muted-foreground"><span class="flex-1">Drop files here</span><span class="flex h-7 items-center gap-1.5 rounded-lg bg-card px-2.5 text-foreground ring-1 ring-border"><i class="ph ph-paperclip"></i>Attach files</span><span class="flex h-7 items-center gap-1.5 rounded-lg bg-card px-2.5 text-foreground ring-1 ring-border"><i class="ph ph-folder"></i>Add a folder</span></div>
    </div>
    ${over}
  </div>`;

/** The reply box opened up: `extras` (a model notice, chips) over the words, then the plus and the arrow. Pass it as thread's `replyEl`. */
const replyBoxOpen = ({
  extras = "",
  text = "",
  ph = "Talk to Instrument",
} = {}) => `
  <div class="flex flex-col gap-1.5 rounded-[22px] bg-[light-dark(#ffffff,#262624)] p-1.5 shadow-sm">
    ${extras ? `<div class="flex items-center gap-1.5 px-0.5">${extras}</div>` : ""}
    <div class="flex items-center gap-2">
      ${plusButton}
      <span class="flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text || ph}</span>
      <span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span>
    </div>
  </div>`;

/** The reply box's plus menu as built, as wide as the reply box (`w`). `model` is the model row: "Choose a model" with none chosen, else "Model · <name>". */
const plusMenu = ({ left, top, w = 326, model = "Choose a model" } = {}) =>
  menu(
    [
      [`<i class="ph ph-globe text-[15px]"></i>`, "Browser"],
      [`<i class="ph ph-desktop text-[15px]"></i>`, "This Mac"],
      "rule",
      [`<i class="ph ph-paperclip text-[15px]"></i>`, "Attach files"],
      [`<i class="ph ph-folder text-[15px]"></i>`, "Add a folder"],
      "rule",
      [
        `<i class="ph ph-shapes text-[15px]"></i>`,
        "Apps",
        `<i class="ph ph-caret-right"></i>`,
      ],
      [
        `<i class="ph ph-cube text-[15px]"></i>`,
        "Skills",
        `<i class="ph ph-caret-right"></i>`,
      ],
      [`<i class="ph ph-cpu text-[15px]"></i>`, model],
    ],
    { left, top, w },
  );
