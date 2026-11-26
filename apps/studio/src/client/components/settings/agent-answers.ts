import { type AgentAnswer } from "@/client/components/window/agent-answers";
import {
  type AGENT_SETTINGS,
  type AgentSettingId,
} from "@/shared/agent-settings";

import { type SettingId } from "./settings-index";

/** A setting `instrument settings` can change. */
type ChangeableSettingId = {
  [Id in AgentSettingId]: (typeof AGENT_SETTINGS)[Id]["changeable"] extends true
    ? Id
    : never;
}[AgentSettingId];

const READ_ONLY = {
  not: "the person's to change: `instrument settings` says what it is and links its row",
} as const;

const NO_SWITCH = {
  not: "shows where something stands, or links to it, with nothing to set",
} as const;

const DEVELOPER = { not: "drawn in developer mode alone" } as const;

const SIGN_IN = {
  not: "a sign-in, a key or the plan, which `instrument settings` never changes",
} as const;

const PERMISSION = {
  not: "a permission, which `instrument settings` never changes",
} as const;

/**
 * Every row of Settings (`SettingId`), answered by the setting
 * `instrument settings` changes there. A setting with no row of its own
 * (`row: false` in `AGENT_SETTINGS`) is set elsewhere in the app.
 */
export const SETTING_ANSWERS = {
  account: SIGN_IN,
  "activity-history": NO_SWITCH,
  "add-provider": SIGN_IN,
  "always-open": PERMISSION,
  "api-server": DEVELOPER,
  "billing-portal": SIGN_IN,
  "broken-folders": NO_SWITCH,
  "chatgpt-account": SIGN_IN,
  "claude-account": SIGN_IN,
  "clear-activity": { not: "deletes, which `instrument settings` never does" },
  "dictation-language": "dictation-language",
  "dictation-microphone": "dictation-microphone",
  "dictation-sounds": "dictation-sounds",
  // The row's other switch, send-error-reports, is read only.
  "diagnostic-log": "offer-feedback",
  "grok-account": SIGN_IN,
  "instrument-folder": {
    not: "moves where every chat, project and memory is stored, which is the person's",
  },
  "keep-history": READ_ONLY,
  libreoffice: { not: "deletes, which `instrument settings` never does" },
  "memory-folder": NO_SWITCH,
  "memory-import": {
    not: "an import the person starts in a chat of its own; the agent saves memories with `instrument memory`",
  },
  "microphone-access": {
    not: "the computer's permission, which only the person can give",
  },
  notifications: "notifications",
  "open-source": NO_SWITCH,
  plan: SIGN_IN,
  "release-channel": DEVELOPER,
  "reset-permissions": PERMISSION,
  "search-engine": "search-engine",
  "secure-storage": NO_SWITCH,
  "send-feedback": {
    not: "a chat offers to send a problem itself, and sends it only with the person's yes",
  },
  "share-activity": READ_ONLY,
  "new-skill": {
    not: "starts a chat that writes a skill, which the agent does in any chat",
  },
  "suggest-next-message": "suggest-next-message",
  "suggest-searches": READ_ONLY,
  theme: "theme",
  "use-folders-without-asking": PERMISSION,
  version: NO_SWITCH,
  workspaces: DEVELOPER,
  zoom: "zoom",
} as const satisfies Record<SettingId, AgentAnswer<ChangeableSettingId>>;
