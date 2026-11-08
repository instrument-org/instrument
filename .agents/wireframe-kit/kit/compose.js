// ---- composing ------------------------------------------------------------------
// Re-measured 2026-11-07. New on the Chat screen writes a new chat beside the list
// (chat.js `newChat`). Anywhere else it docks a draft (compose-window.tsx): a 600-wide
// window on a stone shell, 20 from the window's right edge and flush to its foot, its
// 44px head over the chat's composer on a white card, and under that, once something is
// open, a well that is the draft's own pane. The composer's chips are that pane's tabs.

/** The model control: the provider's mark and the model's name, muted, with a caret. `warn` is the amber unavailable state. */
const modelTrigger = (
  name,
  { mark = "instrumentglyph", warn = false } = {},
) => `
  <span class="flex h-6 min-w-0 items-center gap-2 rounded-lg px-1.5 text-[12px] font-medium ${warn ? "text-warning-700" : "text-gray-400"}">${warn ? `<i class="ph ph-warning text-[16px]"></i>` : brand(mark)}<span class="truncate">${name}</span><i class="ph ph-caret-down text-[11px]"></i></span>`;

/** The amber row inside a draft's composer, and over a picker's list, when the chosen model has a problem (model-notice.tsx), with the way to fix it (`action`) at its end. */
const modelProblem = (text, { action = "Add a provider" } = {}) =>
  `<span class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg bg-yellow-50 py-1 pr-1 pl-2.5 text-xs text-yellow-900 ring-1 ring-yellow-300 ring-inset"><i class="ph ph-warning text-[16px] text-yellow-700"></i><span class="min-w-0 flex-1 truncate">${text}</span>${action ? `<span class="flex h-6 shrink-0 items-center rounded-md bg-white px-2.5 font-medium text-foreground shadow-xs ring-1 ring-black/10">${action}</span>` : ""}</span>`;

/** The note that floats over a chat's reply box (reply-note.tsx), 8px above it: the model's problem in yellow ("warn"), or a quiet white one ("neutral"), with its one button. Pass it as thread's or newChat's `foot`. */
const replyNote = (text, { action = "Add a provider", tone = "warn", icon = "warning" } = {}) =>
  `<div class="mb-2 flex min-h-8 items-center gap-2 rounded-xl py-1 pr-1 pl-3 text-xs shadow-xs ring-1 ring-inset ${tone === "warn" ? "bg-yellow-50 text-yellow-900 ring-yellow-300" : "bg-white text-foreground/70 ring-black/[0.06]"}"><i class="ph ph-${icon} text-[16px] ${tone === "warn" ? "text-yellow-700" : "text-foreground/45"}"></i><span class="min-w-0 flex-1 py-1 leading-snug">${text}</span>${action ? `<span class="inline-flex h-6 shrink-0 items-center rounded-md bg-white px-2.5 font-medium text-foreground shadow-xs ring-1 ring-black/10">${action}</span>` : ""}</div>`;

/**
 * A chip over a composer's words (attached-item-preview.tsx, context-chip.tsx): 28px,
 * the tab's mark and name on a faint ground with a hairline. `on` raises the one the
 * pane or the draft's well shows; `x` draws the × that leaves it out. `t` is a tab.
 */
const composerChip = (t, { on = false, x = true } = {}) =>
  `<span class="inline-flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1.5 rounded-[9px] pl-1.5 text-[12.5px] text-foreground ring-1 ${x ? "pr-1" : "pr-2"} ${on ? "bg-foreground/[0.09] font-medium ring-foreground/20" : "bg-foreground/4 ring-border"}"><span class="grid size-4 shrink-0 place-items-center">${tabMark(t, "size-4 text-[8px]")}</span><span class="truncate">${tabTitle(t)}</span>${x ? `<span class="grid size-5 shrink-0 place-items-center text-muted-foreground"><i class="ph ph-x text-[12px]"></i></span>` : ""}</span>`;

/** What is in view behind a docked draft, offered beside its plus as a dashed "Add <name>" (context-chip.tsx ContextSuggestion); nothing goes until it is pressed. */
const offerChip = (t) =>
  `<span class="inline-flex h-7 max-w-56 min-w-0 shrink items-center gap-1.5 rounded-[9px] border border-dashed border-border pr-1.5 pl-1.5 text-[12.5px] text-muted-foreground"><span class="grid size-4 shrink-0 place-items-center opacity-70">${tabMark(t, "size-4 text-[8px]")}</span><span class="min-w-0 truncate">Add ${tabTitle(t)}</span><i class="ph ph-plus text-[12px]"></i></span>`;

/**
 * A docked draft (compose-window.tsx): a 600-wide window at the window's bottom right,
 * over Files, Browser or Apps. Its 44px head says "New chat" with the project slot
 * (`project` fills it), then trash, minimize, expand and ×. Under it the chat's composer
 * on a white card: `chips` over the words (or "What do you need?"), and along its foot
 * the plus with `offer` beside it, then the model, the mic and send. `well` (a tab, or
 * finished HTML) opens the draft's pane under the composer and grows the window to 640.
 * `over` draws on top of it (a picker hanging from it). Pass it as appWindow's `over`.
 */
const composeWin = ({
  title = "New chat",
  model = modelTrigger("Auto"),
  words = "",
  ph = "What do you need?",
  chips = "",
  offer = "",
  notice = "",
  project = "",
  well = null,
  h,
  over = "",
} = {}) => {
  const height = h ?? (well ? 640 : null);
  const wellHtml = well
    ? typeof well === "string"
      ? well
      : `${locRow(well, { close: true })}<div class="relative min-h-0 flex-1 overflow-hidden">${page(well)}</div>`
    : "";
  return `
  <div class="absolute bottom-0 z-40 flex w-[600px] flex-col overflow-hidden rounded-t-2xl bg-gray-100 text-foreground shadow-2xl ring-1 ring-gray-300" style="right:20px;${height ? `height:${height}px` : ""}">
    <div class="flex h-11 shrink-0 items-center gap-1.5 pr-2 pl-3">
      <span class="inline-flex h-7 shrink-0 items-center px-1.5 text-[13px] font-medium">${title}</span>
      ${projectSlot(project)}
      <div class="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground">${windowButton("trash", { dim: !words && !chips })}<span class="mx-1 h-4 w-px bg-border"></span>${windowButton("minus")}${windowButton("arrows-out-simple")}${windowButton("x")}</div>
    </div>
    <div class="mx-2 mb-2 flex shrink-0 flex-col gap-2 rounded-[18px] bg-card px-3 pt-3 pb-2 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_4px_12px_-4px_rgb(0_0_0/0.08)] ring-1 ring-black/6">
      ${notice}
      ${chips ? `<div class="flex flex-wrap items-start gap-1.5">${chips}</div>` : ""}
      <div class="min-h-12 text-[14px] leading-6 ${words ? "" : "text-gray-400"}">${words || ph}</div>
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">${plusButton}${offer}</div>
        <div class="flex min-w-0 items-center gap-1.5">${model}<span class="grid size-8 shrink-0 place-items-center text-foreground/60"><i class="ph ph-microphone text-[17px]"></i></span><span class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[18px] text-white"></i></span></div>
      </div>
    </div>
    ${well ? `<div class="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-card shadow-xs ring-1 ring-border" style="--color-background:var(--color-card)">${wellHtml}</div>` : ""}
    ${over}
  </div>`;
};

/** One of a floating window's own buttons (compose-window.tsx WindowButton): a 28px ghost icon. */
const windowButton = (icon, { dim = false } = {}) =>
  `<span class="grid size-7 place-items-center ${dim ? "opacity-50" : ""}"><i class="ph ph-${icon} text-[16px]"></i></span>`;

/** A draft or a popped-out chat put down (ComposeBar): a 300-wide dark bar along the window's foot with its first words, brought back by a press, closed by its ×. `right` places it from the window's right edge. */
const composeBar = (text = "New chat", { right = 20, chat = false } = {}) =>
  `<div class="absolute bottom-0 z-40 flex h-9 w-[300px] items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl" style="right:${right}px"><span class="flex h-full min-w-0 flex-1 items-center gap-2 px-3"><i class="ph ph-${chat ? "chats-circle" : "circle-dashed"} text-[14px]"></i><span class="min-w-0 flex-1 truncate">${text}</span></span><span class="grid h-full w-8 shrink-0 place-items-center text-white/80"><i class="ph ph-x text-[14px]"></i></span></div>`;

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
      ${replyEnds}
    </div>
  </div>`;

/** The reply box's plus menu (composer-add-menu.tsx), 288 wide from the composer's left edge: Browser and This Mac, the attach actions, then Apps, Skills and the model row ("Choose a model" with none chosen, else "Model · <name>"; empty leaves it out, as a draft's menu does). */
const plusMenu = ({ left, top, w = 288, model = "Choose a model" } = {}) =>
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
      ...(model ? [[`<i class="ph ph-cpu text-[15px]"></i>`, model]] : []),
    ],
    { left, top, w },
  );
