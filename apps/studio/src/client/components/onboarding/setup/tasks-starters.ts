import { type SetupTask } from "@/client/components/onboarding/setup/flow";

/** A task setup offers, and whether it starts unchecked because it needs a file. */
export type OfferedTask = SetupTask & { needsFile?: boolean };

/** The twelve kinds of work on "What fills your week?", in the order drawn. */
export const WORK_KINDS = [
  { id: "business", label: "Running a business", phrase: "running a business" },
  { id: "marketing", label: "Marketing & social", phrase: "marketing" },
  { id: "sales", label: "Sales & clients", phrase: "sales" },
  { id: "writing", label: "Writing & research", phrase: "writing" },
  { id: "design", label: "Design & creative", phrase: "creative work" },
  { id: "money", label: "Money & budgets", phrase: "budgets" },
  { id: "admin", label: "Admin & paperwork", phrase: "paperwork" },
  { id: "school", label: "School & teaching", phrase: "school" },
  { id: "home", label: "Home & family", phrase: "home life" },
  { id: "coding", label: "Coding & software", phrase: "coding" },
  { id: "projects", label: "Projects & planning", phrase: "planning" },
  { id: "travel", label: "Travel & events", phrase: "travel" },
] as const;

export type WorkKind = (typeof WORK_KINDS)[number];
export type WorkKindId = WorkKind["id"];

const WEB_PAGE = "Uses the web. Saves a page to your Instrument folder.";
const PICK_FILE = "You'll pick the file when you start it.";
const DRAFT_ONLY = "Writes a draft. Nothing is sent.";

/** Tasks written ahead of time for each kind of work, best first. */
export const STARTER_TASKS: Record<WorkKindId, OfferedTask[]> = {
  admin: [
    {
      detail: PICK_FILE,
      icon: "file",
      needsFile: true,
      prompt: "Read this form and tell me what I need to fill in and by when.",
    },
    {
      detail: "Makes a list you can check off.",
      icon: "list",
      prompt:
        "Make me a checklist of the paperwork I should sort out this month.",
    },
    {
      detail: DRAFT_ONLY,
      icon: "envelope",
      prompt:
        "Draft a polite email asking for an update on a bill I've already paid.",
    },
  ],
  business: [
    {
      detail: WEB_PAGE,
      icon: "tag",
      prompt:
        "Find what three competitors charge for what I sell, and make me a comparison page.",
    },
    {
      detail: PICK_FILE,
      icon: "chart",
      needsFile: true,
      prompt:
        "Turn a sales spreadsheet into a one-page summary of what sold best.",
    },
    {
      detail: "Makes a document you can edit.",
      icon: "file",
      prompt: "Write a one-page plan for what I want to get done this quarter.",
    },
  ],
  coding: [
    {
      detail: PICK_FILE,
      icon: "code",
      needsFile: true,
      prompt:
        "Read this project and explain how it fits together, in plain words.",
    },
    {
      detail: WEB_PAGE,
      icon: "magnifier",
      prompt:
        "Compare three libraries for what I'm building and recommend one.",
    },
    {
      detail: "Makes a document you can edit.",
      icon: "list",
      prompt: "Write a checklist for shipping my next release.",
    },
  ],
  design: [
    {
      detail: WEB_PAGE,
      icon: "palette",
      prompt: "Gather ten examples of work I admire into a mood board page.",
    },
    {
      detail: PICK_FILE,
      icon: "file",
      needsFile: true,
      prompt: "Look at this design and tell me what to fix before I share it.",
    },
    {
      detail: DRAFT_ONLY,
      icon: "envelope",
      prompt: "Draft a short note to a client presenting my latest design.",
    },
  ],
  home: [
    {
      detail: "Makes a plan you can edit.",
      icon: "house",
      prompt: "Plan a week of family dinners, with a shopping list.",
    },
    {
      detail: "Makes a calendar you can edit.",
      icon: "calendar",
      prompt:
        "Make a calendar of who in the family needs to be where this week.",
    },
    {
      detail: WEB_PAGE,
      icon: "magnifier",
      prompt:
        "Find three weekend activities near me that the whole family would enjoy.",
    },
  ],
  marketing: [
    {
      detail: "Makes a calendar you can edit.",
      icon: "calendar",
      prompt: "Plan two weeks of social posts, with captions and photo ideas.",
    },
    {
      detail: DRAFT_ONLY,
      icon: "envelope",
      prompt: "Draft a friendly email to customers about our holiday hours.",
    },
    {
      detail: WEB_PAGE,
      icon: "megaphone",
      prompt:
        "See what my competitors posted this month and tell me what worked.",
    },
  ],
  money: [
    {
      detail: PICK_FILE,
      icon: "chart",
      needsFile: true,
      prompt:
        "Turn my bank statement into a summary of where my money went last month.",
    },
    {
      detail: "Makes a spreadsheet you can edit.",
      icon: "money",
      prompt: "Make me a simple monthly budget I can fill in.",
    },
    {
      detail: WEB_PAGE,
      icon: "magnifier",
      prompt:
        "Compare three savings accounts and make me a page with the differences.",
    },
  ],
  projects: [
    {
      detail: "Makes a plan you can edit.",
      icon: "list",
      prompt: "Break my next project into steps with rough dates.",
    },
    {
      detail: "Makes a calendar you can edit.",
      icon: "calendar",
      prompt: "Plan my week around the three things that matter most.",
    },
    {
      detail: DRAFT_ONLY,
      icon: "envelope",
      prompt: "Draft a short status update for the people on my project.",
    },
  ],
  sales: [
    {
      detail: WEB_PAGE,
      icon: "users",
      prompt:
        "Research a client I'm meeting soon and make me a one-page brief.",
    },
    {
      detail: DRAFT_ONLY,
      icon: "envelope",
      prompt: "Draft a friendly follow-up to a client who went quiet.",
    },
    {
      detail: PICK_FILE,
      icon: "chart",
      needsFile: true,
      prompt: "Turn my list of leads into a plan for who to call first.",
    },
  ],
  school: [
    {
      detail: "Makes a document you can edit.",
      icon: "graduation",
      prompt: "Make a study plan for my next exam, a little each day.",
    },
    {
      detail: PICK_FILE,
      icon: "file",
      needsFile: true,
      prompt: "Turn my notes into a set of practice questions.",
    },
    {
      detail: WEB_PAGE,
      icon: "magnifier",
      prompt:
        "Find three good sources on a topic I'm studying and summarize each one.",
    },
  ],
  travel: [
    {
      detail: "Makes a plan you can edit.",
      icon: "airplane",
      prompt: "Plan a three-day trip, with places to stay and things to do.",
    },
    {
      detail: "Makes a list you can check off.",
      icon: "list",
      prompt: "Make a packing list for my next trip.",
    },
    {
      detail: WEB_PAGE,
      icon: "calendar",
      prompt:
        "Find three venues for an event I'm planning and compare them on a page.",
    },
  ],
  writing: [
    {
      detail: WEB_PAGE,
      icon: "magnifier",
      prompt:
        "Research a topic I'm writing about and make me a page of the key facts.",
    },
    {
      detail: PICK_FILE,
      icon: "pencil",
      needsFile: true,
      prompt: "Read my draft and suggest how to make it clearer.",
    },
    {
      detail: "Makes a document you can edit.",
      icon: "file",
      prompt: "Outline a short article on something I know well.",
    },
  ],
};

/** Tasks for someone who picked no kind of work. */
const GENERAL_TASKS: OfferedTask[] = [
  {
    detail: WEB_PAGE,
    icon: "magnifier",
    prompt:
      "Research something I've been meaning to look into, and make me a page about it.",
  },
  {
    detail: "Makes a calendar you can edit.",
    icon: "calendar",
    prompt: "Plan my week around the three things that matter most.",
  },
  {
    detail: PICK_FILE,
    icon: "file",
    needsFile: true,
    prompt: "Read a document of mine and give me the short version.",
  },
  {
    detail: DRAFT_ONLY,
    icon: "envelope",
    prompt: "Draft a friendly email I've been putting off.",
  },
];

/** How many tasks setup offers. */
export const TASK_COUNT = 4;

/** The kind of work a saved answer names, by its id or its label. */
export function workKindOf(value: string): undefined | WorkKind {
  const wanted = value.trim().toLowerCase();
  return WORK_KINDS.find(
    (kind) => kind.id === wanted || kind.label.toLowerCase() === wanted,
  );
}

/** The kinds of work among the answers, in the order they were picked. */
export function pickedKinds(work: readonly string[]): WorkKind[] {
  return work.flatMap((value) => {
    const kind = workKindOf(value);
    return kind ? [kind] : [];
  });
}

/** The labels of the picked kinds, which is what the model is told. */
export function workLabels(work: readonly string[]): string[] {
  return work.map((value) => workKindOf(value)?.label ?? value);
}

/**
 * Four starter tasks for the kinds picked, taking each kind's best in turn
 * so every kind gets a say, and the general ones when none was picked.
 */
export function starterTasks(work: readonly string[]): OfferedTask[] {
  const lists = pickedKinds(work).map((kind) => STARTER_TASKS[kind.id]);
  if (lists.length === 0) {
    return GENERAL_TASKS;
  }
  const picked: OfferedTask[] = [];
  const longest = Math.max(...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const task = list[index];
      if (task && !picked.some((entry) => entry.prompt === task.prompt)) {
        picked.push(task);
      }
    }
  }
  return [...picked, ...GENERAL_TASKS].slice(0, TASK_COUNT);
}

/** The kinds picked as one phrase: "running a business and marketing". */
export function workPhrase(work: readonly string[]): string | undefined {
  const phrases = pickedKinds(work).map((kind) => kind.phrase);
  if (phrases.length === 0) {
    return undefined;
  }
  const last = phrases.pop();
  return phrases.length === 0
    ? last
    : `${phrases.join(", ")} and ${last ?? ""}`;
}
