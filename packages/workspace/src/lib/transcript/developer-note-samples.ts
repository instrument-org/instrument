import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";

const MESSAGE = "msg_01M0000000000000000000000T";
const SESSION = "ses_01M0000000000000000000TASK";

/**
 * One payload for every data part there is. A part added without a sample here
 * doesn't compile, and the test beside this says what a sample must come to: if
 * its text reaches the model, a developer's card has that text.
 */
export const DATA_PART_SAMPLES = {
  actions: { rows: [{ count: 2, kind: "file", minutes: 1 }] },
  appEvent: {
    apps: {},
    events: [{ event: "connected", name: "Notion", slug: "notion" }],
  },
  asks: {
    asks: [
      {
        file: { name: "plan.md", path: "/work/plan.md" },
        instruction: "Shorter",
        target: "lines 1-2",
      },
    ],
  },
  attachments: {
    files: [
      {
        filename: "plan.pdf",
        filePath: "attachments/plan.pdf",
        mimeType: "application/pdf",
        size: 1024,
      },
    ],
  },
  backgroundProcesses: {
    ended: [],
    running: [{ command: "pnpm build", id: "bg_1", runningForMs: 1000 }],
  },
  branchedFrom: {
    chat: "2026-11-08-help-desk-pricing-7k3q",
    folder: "/work/Chats/Help desk pricing",
    records: "/work/.instrument/chats/2026-11-08-help-desk-pricing-7k3q",
    title: "Help desk pricing",
    work: "/home/.instrument/work/Instrument/2026-11-08-help-desk-pricing-7k3q",
  },
  browserStatus: {
    status: "tabs",
    tabs: [{ id: "t1", openedBy: "task", url: "https://example.com" }],
  },
  chatContext: { chats: [], sentAt: 0 },
  contextRollover: { droppedMessages: 4, retainedUserMessages: 2 },
  dateChange: { date: "2026-11-06" },
  environmentChange: { computer: "A test computer" },
  fileChanges: { files: [] },
  folderChanges: { added: [{ path: "/work/notes" }], removed: [] },
  fromChat: { kind: "assignment", text: "Compare the two." },
  intent: { text: "Words from a sample." },
  jobEvent: {
    events: [
      {
        command: "pnpm build",
        durationMs: 1000,
        id: "bg_1",
        logFilePath: "logs/bg_1.log",
        status: "failed",
      },
    ],
  },
  maxSteps: { maxStepCount: 25 },
  memory: {
    forgotten: [],
    memories: [{ at: 0, name: "plan-names", text: "A sample memory." }],
    more: 0,
    sentAt: 0,
    tells: "whole",
    told: {},
  },
  messageGap: { minutes: 90 },
  modelChange: { from: { modelId: "a" }, to: { modelId: "b" } },
  outputLimit: { continuations: 2 },
  pageTakeover: {
    page: { title: "Example", url: "https://example.com/" },
    stage: "taken",
    tab: "tab_01M0000000000000000000000T",
  },
  permissionAnswer: { answer: "allowed", kind: "folder", target: "/work" },
  project: { project: { instructions: "Sample words.", name: "Pricing" } },
  questionAnswer: {
    answer: { replies: [{ picked: ["Friday"] }] },
    partId: "prt_01M0000000000000000000000T",
    questions: ["Which day?"],
  },
  chatChanges: {
    changes: [
      { after: true, before: false, chat: "chat-1", field: "archived" },
    ],
  },
  ratingCard: {},
  requestFailure: { error: "It failed." },
  requestNote: { kind: "turn", text: "Sample words." },
  setupChanges: {
    changes: [{ change: "added", kind: "skill", name: "launch" }],
  },
  setupNews: {
    changes: [{ change: "added", kind: "skill", name: "launch" }],
    told: {},
  },
  signedIn: { waitedFor: "image" },
  skillMentions: { names: ["launch"] },
  stepFacts: {
    apps: [],
    counts: [],
    files: [],
    hosts: [],
    settled: true,
    step: "prt_01M0000000000000000000000T",
  },
  taskEvent: {
    events: [{ sessionId: SESSION, status: "done", title: "A task" }],
  },
  toolResultsCleared: { results: 3, through: MESSAGE },
  unknown: { originalType: "data-gone", reason: "no schema" },
  viewContext: { screen: "conversation" },
  workSummary: { words: "Read two pages" },
  workspaceInstructions: { file: "AGENTS.md", instructions: "Sample words." },
} satisfies Record<SessionMessageDataPart.Name, unknown>;
