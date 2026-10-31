// ---- setup ------------------------------------------------------------------------
// Setup fills the app window at its own 1080x720 (SETUP_WIDTH/HEIGHT in
// electron-main/windows/setup-size.ts), measured off the `new` scenario (2026-10-23):
// the sage-to-paper ground, the lights in the 40px band, each page's serif title
// centered under it, and a footer with Back at the left and Continue at the right.

/** The app mark: the app icon from BRAND_URI, clipped to the macOS rounded square. */
const brandMark = (cls = "size-20") =>
  `<img src="${BRAND_URI.instrument}" class="block ${cls} shrink-0 rounded-[22%] shadow-md" alt="">`;

const SETUP = { w: 1080, h: 720 };

/** The window while setup is up: the ground, the lights, `body` and the footer at its foot. */
const setupWin = ({ body = "", foot = "", over = "" } = {}) => `
  <div class="relative flex h-full flex-col overflow-hidden text-foreground [color-scheme:light]" style="background:linear-gradient(180deg,#dde7e2,#f4f3f0 45%,#f5f4f2)">
    <div class="flex h-10 shrink-0 items-center">${trafficLights}</div>
    <div class="flex min-h-0 flex-1 flex-col">${body}</div>
    ${foot}
    ${over}
  </div>`;

/** Setup's footer: Back at the left, then `next` (a label, or "" for none) and an optional quiet `skip`. */
const setupFoot = ({
  back = true,
  next = "Continue",
  skip = "",
  off = false,
} = {}) => `
  <div class="flex shrink-0 items-center justify-between px-8 pt-5 pb-6">
    <div class="flex min-w-50">${back ? `<span class="flex h-9 items-center gap-2 px-5 text-sm text-muted-foreground"><i class="ph ph-caret-left"></i>Back</span>` : ""}</div>
    <div class="flex items-center gap-6">
      ${skip ? `<span class="flex h-9 items-center px-5 text-sm text-muted-foreground">${skip}</span>` : ""}
      ${next ? `<span class="flex h-10 items-center rounded-lg px-5 text-base font-medium ${off ? "bg-brand-700/40 text-white/80" : "bg-brand-700 text-white"}">${next}</span>` : ""}
    </div>
  </div>`;

/** One setup page: optional `hero` over the serif title and the gray line, then `body`. `align` center sits mid-window. */
const setupPage = ({
  hero = "",
  title,
  sub = "",
  body = "",
  align = "top",
}) => `
  <div class="flex flex-1 flex-col items-center px-17 pb-6 ${align === "center" ? "justify-center" : "pt-11"}">
    ${hero ? `<div class="mb-6 flex justify-center">${hero}</div>` : ""}
    <h1 class="max-w-235 text-center font-serif text-3xl/[38px] font-medium">${title}</h1>
    ${sub ? `<p class="mt-3 max-w-150 text-center text-base text-pretty text-muted-foreground">${sub}</p>` : ""}
    ${body}
  </div>`;

/** A 380px setup button: `tone` brand (filled green), plain (white, raised) or outline. `marks` lead the label. */
const setupButton = (
  label,
  { tone = "plain", marks = "", waiting = false } = {},
) => {
  const t =
    tone === "brand"
      ? "bg-brand-700 text-white"
      : tone === "outline"
        ? "border border-border bg-transparent"
        : "border border-border bg-white shadow-sm";
  return `<div class="flex h-10 w-95 items-center justify-center gap-2 rounded-lg text-base font-medium ${t}">${waiting ? `<i class="ph ph-spinner-gap text-[16px]"></i><span class="text-muted-foreground">Cancel</span>` : `${marks}${label}`}</div>`;
};

/** "How would you like to use AI?", the step a new person signs in on. `waiting` puts Google's button in its browser wait (spinner and Cancel). */
const setupChooseAI = ({
  waiting = false,
  google = (b) => b,
  subs = (b) => b,
} = {}) =>
  setupWin({
    body: setupPage({
      align: "center",
      title: "How would you like to use AI?",
      sub: "Sign in with Google, or use a subscription or key you already pay for.",
      body: `<div class="mt-12 flex flex-col items-center gap-3">
        ${google(setupButton("Continue with Google", { marks: brand("google"), waiting }))}
        ${subs(setupButton("Use an existing subscription", { tone: "outline", marks: `${brand("openai")}${brand("claude")}${brand("grok")}` }))}
        <p class="mt-5 text-base text-muted-foreground">Or add an API provider manually</p>
      </div>`,
    }),
    foot: `<p class="shrink-0 pb-6 text-center text-sm text-muted-foreground">By continuing, you agree to our <u>Terms of Service</u> and <u>Privacy Policy</u>.</p>`,
  });

/** A 576px white card of hairline-divided rows: [mark, title, line, end] each. */
const setupRows = (rows) => `
  <div class="mt-8 w-144 rounded-3xl border border-border bg-white px-4 py-2">
    ${rows
      .map(
        ([mark, title, line, end], i) => `
      <div class="flex items-center gap-3.5 py-2.5">
        <span class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-white shadow-sm">${mark}</span>
        <div class="min-w-0 flex-1 text-left ${i ? "" : ""}"><p class="text-sm">${title}</p><p class="text-sm text-muted-foreground">${line}</p></div>
        ${end}
      </div>${i < rows.length - 1 ? `<div class="ml-16 border-t border-border"></div>` : ""}`,
      )
      .join("")}
  </div>`;

const setupRowButton = (label) =>
  `<span class="flex h-9 w-29 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-sm font-medium shadow-sm">${label}</span>`;

/** "Which subscription do you have?" with ChatGPT, Claude and Grok. `sub` replaces the line under the title; `pick` wraps one row's button. */
const setupSubscriptions = ({ sub, pick = {} } = {}) =>
  setupWin({
    body: setupPage({
      title: "Which subscription do you have?",
      sub:
        sub ??
        "Instrument will use it for AI. You'll sign in on their site, and you'll have the option to add a free Instrument account after that.",
      body: setupRows(
        [
          ["openai", "ChatGPT", "Plus, Pro or another paid plan"],
          ["claude", "Claude", "Pro, Max or another paid plan"],
          ["grok", "Grok", "Your plan needs to include Grok API access."],
        ].map(([key, title, line]) => [
          brand(key, "size-7"),
          title,
          line,
          (pick[key] ?? ((b) => b))(setupRowButton("Sign in")),
        ]),
      ),
    }),
    foot: setupFoot({ next: "" }),
  });

/** The makers behind a plan's models, as the card's Models row draws them. */
const PLAN_MAKERS = ["openai", "anthropic", "googlegemini", "grok"];

/**
 * One plan card as the shared PlanCards draws it: name (green on the plan with the most
 * usage), price, the gray usage box with its meter and makers, the features, and the button
 * (`leading` gets the brand fill). `free` prices it as the beta offer's free months.
 */
const planCard = ({
  name,
  amount,
  usage,
  filled,
  segments = 4,
  features = [],
  cta,
  heaviest = false,
  leading = false,
  free,
  badge = "",
  w = "w-64",
}) => `
  <div class="flex ${w} flex-col gap-3 rounded-3xl border p-5 text-left ${heaviest ? "border-brand-100 bg-gradient-to-b from-brand-50 to-white shadow-md" : "border-border bg-white"}">
    <div class="flex items-center gap-2"><span class="flex-1 text-base font-medium ${heaviest ? "text-brand-600" : "text-muted-foreground"}">${name}</span>${badge ? `<span class="rounded-md border border-border px-1.5 py-0.5 text-xs">${badge}</span>` : ""}</div>
    ${
      free
        ? `<div><p class="flex items-baseline gap-1"><span class="text-4xl font-semibold tracking-tight">$0</span><span class="text-sm text-gray-400">for ${free}</span></p><p class="text-sm text-muted-foreground">then ${amount}/month</p></div>`
        : `<p class="flex items-baseline gap-1"><span class="text-4xl font-semibold tracking-tight">${amount}</span><span class="text-sm text-gray-400">/ month</span></p>`
    }
    <div class="flex flex-col gap-4 rounded-xl bg-black/5 px-3.5 py-2.5 text-sm">
      <div class="flex flex-col gap-2">
        <div class="flex justify-between"><span class="text-muted-foreground">AI usage</span><span class="font-semibold">${usage}</span></div>
        <div class="flex gap-1">${Array.from({ length: segments }, (_, i) => `<span class="h-1.5 flex-1 rounded-full ${i < filled ? "bg-brand-600" : "bg-black/5"}"></span>`).join("")}</div>
      </div>
      <div class="flex justify-between"><span class="text-muted-foreground">Models</span><span class="flex gap-2">${PLAN_MAKERS.map((m) => brand(m)).join("")}</span></div>
    </div>
    <ul class="flex flex-col gap-1.5 text-sm">${features.map((f) => `<li class="flex items-center gap-2"><i class="ph ph-check text-brand-600"></i><span class="text-gray-700">${f}</span></li>`).join("")}</ul>
    ${cta ? `<div class="mt-auto">${cta}</div>` : ""}
  </div>`;

/** A plan card's button: `leading` is the brand fill, else the dark default. */
const planButton = (label, { leading = false } = {}) =>
  `<div class="flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium text-white ${leading ? "bg-brand-700" : "bg-gray-900"}">${label}</div>`;

/** The offer's two plans as setup's plan step shows them on a no-card trial. */
const OFFER_PLANS = [
  {
    name: "Basic",
    amount: "$10",
    usage: "Standard",
    filled: 1,
    features: ["Standard AI usage", "Web search", "Image generation"],
  },
  {
    name: "Pro",
    amount: "$40",
    usage: "4× Standard",
    filled: 4,
    heaviest: true,
    features: ["4× Standard AI usage", "Web search", "Image generation"],
  },
];
