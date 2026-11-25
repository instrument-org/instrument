import { APP_NAME } from "@instrument-org/shared";

/**
 * The settings a chat reads and changes with `instrument settings`, by id.
 * One with a row in Settings has that row's id (`settings-index.ts`), which a
 * test holds, so its link lands there; `row: false` is for one set elsewhere
 * in the app, and `row` names the row for one drawn inside another.
 *
 * `changeable: false` is the person's to change: a chat says what it is and
 * links it. Permissions, sign-ins, keys, the plan, the models chats run on
 * (which decide what the person is billed) and anything that deletes are not
 * here at all, and never become changeable here.
 */
export const AGENT_SETTINGS = {
  theme: {
    changeable: true,
    detail: "The app's color scheme. system follows the computer's.",
    title: "Theme",
  },
  zoom: {
    changeable: true,
    detail: `How large everything in ${APP_NAME} is. Pages in its browser have a zoom of their own.`,
    title: "Zoom",
  },
  notifications: {
    changeable: true,
    detail: `Whether a desktop notification shows when a task finishes: always, only while ${APP_NAME} is not the window in front (unfocused), or never. The computer's own notification permission for ${APP_NAME} also has to be on.`,
    title: "Notify when tasks finish",
  },
  "dictation-microphone": {
    changeable: true,
    detail:
      "The microphone dictation records from. default is the computer's own input, and the only choice until the computer lets the app use a microphone.",
    title: "Dictation microphone",
  },
  "dictation-language": {
    changeable: true,
    detail:
      "The language dictation listens for. auto detects it. Dictation also needs the computer to let the app use a microphone.",
    title: "Dictation language",
  },
  "dictation-sounds": {
    changeable: true,
    detail: "A short sound when dictation starts and when it stops.",
    title: "Dictation sounds",
  },
  "suggest-next-message": {
    changeable: true,
    detail:
      "After each reply, a few next messages the user might send are offered under it, which adds a little to their AI usage.",
    title: "Suggest a next message",
  },
  "search-engine": {
    changeable: true,
    detail:
      "Where words typed into the address field are searched, and where they are sent for suggestions when those are on.",
    title: "Search engine",
  },
  "suggest-searches": {
    changeable: false,
    detail:
      "What the user types into the address field goes to their search engine as they type, so it can suggest searches.",
    title: "Suggest searches",
  },
  "block-ads": {
    changeable: true,
    detail: `Ads and trackers are blocked on every page in ${APP_NAME}'s browser. A page already open follows once it is reloaded. For your own tabs alone, use agent-browser adblock.`,
    row: false,
    title: "Block ads",
  },
  "bookmarks-bar": {
    changeable: true,
    detail:
      "The bookmarks bar shows on every tab but a chat's. Off, it shows on a new tab alone.",
    row: false,
    title: "Bookmarks bar",
  },
  "offer-feedback": {
    changeable: true,
    detail: `${APP_NAME} now and then asks how a chat went, and a chat may offer to send a problem to the team. Nothing is sent without the user's yes.`,
    row: "diagnostic-log",
    title: "Ask for feedback",
  },
  "keep-history": {
    changeable: false,
    detail: `${APP_NAME} keeps the pages, files and chats the user opens.`,
    title: "Keep a history",
  },
  "share-activity": {
    changeable: false,
    detail: `Chats see what the user just did in ${APP_NAME}.`,
    title: "Chats can see this",
  },
  "send-error-reports": {
    changeable: false,
    detail: "Crash and error reports are sent without asking. Chats never are.",
    row: "diagnostic-log",
    title: "Send error reports automatically",
  },
} as const satisfies Record<
  string,
  {
    changeable: boolean;
    detail: string;
    row?: false | string;
    title: string;
  }
>;

export type AgentSettingId = keyof typeof AGENT_SETTINGS;
