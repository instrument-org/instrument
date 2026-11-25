import { microphones } from "@/electron-main/lib/list-microphones";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import {
  changeKeptState,
  getKeptState,
} from "@/electron-main/stores/workspace/kept-state";
import {
  AgentCompletionNotificationModeSchema,
  getWorkspacePreferences,
  WorkspacePreferencesSchema,
} from "@/electron-main/stores/workspace/preferences";
import { AGENT_SETTINGS, type AgentSettingId } from "@/shared/agent-settings";
import {
  DICTATION_LANGUAGES,
  DictationLanguageSchema,
} from "@/shared/dictation";
import {
  microphoneName,
  microphoneNames,
  resolveMicrophone,
} from "@/shared/dictation-microphone";
import { SEARCH_ENGINES, SearchEngineIdSchema } from "@/shared/search-engines";
import { APP_ZOOM_KEY, clampZoom, ZOOM_MAX, ZOOM_MIN } from "@/shared/zoom";
import { APP_NAME_SLUG } from "@instrument-org/shared";
import {
  type AppSetting,
  type AppSettings,
} from "@instrument-org/workspace/electron";

type Value = AppSetting["value"];

/** How one setting is read and set, where `AGENT_SETTINGS` says what it is. */
interface Access {
  choices?: () => Promise<Value[]> | Value[];
  read: () => Promise<Value> | Value;
  takes?: string;
  /** Sets it to one of `choices`, or to words `takes` describes. */
  write?: (value: string) => Promise<void> | void;
}

/** The value for the system's own choice, where a person's pick is optional. */
const DEFAULT_MICROPHONE: Value = {
  label: "System default",
  value: "default",
};
const DETECT_LANGUAGE: Value = { label: "Auto-detect", value: "auto" };

const THEMES = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
];

const NOTIFICATIONS = [
  { label: "Always", value: "always" },
  { label: "Not focused", value: "unfocused" },
  { label: "Never", value: "never" },
];

const ENGINES = SearchEngineIdSchema.options.map((id) => ({
  label: SEARCH_ENGINES[id].name,
  value: id,
}));

const ON_OFF = [
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
];

function choiceOf(choices: readonly Value[], value: string): Value {
  return (
    choices.find((each) => each.value === value) ?? { label: value, value }
  );
}

function onOff(read: () => boolean, write?: (on: boolean) => void): Access {
  return {
    choices: () => ON_OFF,
    read: () => choiceOf(ON_OFF, read() ? "on" : "off"),
    ...(write && {
      write: (value: string) => {
        write(value === "on");
      },
    }),
  };
}

function percent(factor: number): Value {
  const text = `${Math.round(factor * 100).toString()}%`;
  return { label: text, value: text };
}

function zoomNow(): number {
  const kept = getKeptState("view", APP_ZOOM_KEY);
  return typeof kept === "number" && Number.isFinite(kept)
    ? clampZoom(kept)
    : 1;
}

function setZoom(value: string) {
  const asked = /^(\d{1,3})\s*%?$/.exec(value)?.[1];
  const factor = asked === undefined ? undefined : Number(asked) / 100;
  if (factor === undefined || factor < ZOOM_MIN || factor > ZOOM_MAX) {
    throw new Error(`zoom takes ${ZOOM_RANGE}, not "${value}".`);
  }
  changeKeptState("view", APP_ZOOM_KEY, clampZoom(factor));
}

const ZOOM_RANGE = `a whole percent from ${percent(ZOOM_MIN).value} to ${percent(ZOOM_MAX).value}`;

/** Each microphone by the name Settings gives it, which is how it is picked. */
async function microphoneChoices() {
  const inputs = await microphones();
  const names = microphoneNames(inputs);
  return inputs.flatMap((input) => {
    const name = names.get(input.deviceId);
    return name ? [{ input, name }] : [];
  });
}

async function microphoneNow(): Promise<Value> {
  const chosen = getMachinePreferences().get("dictationMicrophone");
  if (!chosen) {
    return DEFAULT_MICROPHONE;
  }
  const listed = await microphoneChoices();
  const { deviceId } = resolveMicrophone(
    chosen,
    listed.map(({ input }) => input),
  );
  const name =
    listed.find(({ input }) => input.deviceId === deviceId)?.name ??
    microphoneName(chosen.label);
  return { label: name, value: name };
}

async function setMicrophone(value: string) {
  if (value === DEFAULT_MICROPHONE.value) {
    getMachinePreferences().delete("dictationMicrophone");
    return;
  }
  const found = (await microphoneChoices()).find(({ name }) => name === value);
  if (!found) {
    throw new Error(`"${value}" is not connected.`);
  }
  getMachinePreferences().set("dictationMicrophone", found.input);
}

const ACCESS: Record<AgentSettingId, Access> = {
  "block-ads": onOff(
    () => getWorkspacePreferences().get("blockAds"),
    (on) => {
      getWorkspacePreferences().set("blockAds", on);
    },
  ),
  "bookmarks-bar": onOff(
    () => getWorkspacePreferences().get("showBookmarksBar"),
    (on) => {
      getWorkspacePreferences().set("showBookmarksBar", on);
    },
  ),
  "dictation-language": {
    choices: languageChoices,
    read: () =>
      choiceOf(
        languageChoices(),
        getMachinePreferences().get("dictationLanguage") ??
          DETECT_LANGUAGE.value,
      ),
    write: (value) => {
      if (value === DETECT_LANGUAGE.value) {
        getMachinePreferences().delete("dictationLanguage");
      } else {
        getMachinePreferences().set(
          "dictationLanguage",
          DictationLanguageSchema.parse(value),
        );
      }
    },
  },
  "dictation-microphone": {
    choices: async () => [
      DEFAULT_MICROPHONE,
      ...(await microphoneChoices()).map(({ name }) => ({
        label: name,
        value: name,
      })),
    ],
    read: microphoneNow,
    write: setMicrophone,
  },
  "dictation-sounds": onOff(
    () => getMachinePreferences().get("dictationSounds"),
    (on) => {
      getMachinePreferences().set("dictationSounds", on);
    },
  ),
  "keep-history": onOff(() => getWorkspacePreferences().get("keepHistory")),
  notifications: {
    choices: () => NOTIFICATIONS,
    read: () =>
      choiceOf(
        NOTIFICATIONS,
        getWorkspacePreferences().get("agentCompletionNotifications"),
      ),
    write: (value) => {
      getWorkspacePreferences().set(
        "agentCompletionNotifications",
        AgentCompletionNotificationModeSchema.parse(value),
      );
    },
  },
  "offer-feedback": onOff(
    () => getMachinePreferences().get("offerFeedback"),
    (on) => {
      getMachinePreferences().set("offerFeedback", on);
    },
  ),
  "search-engine": {
    choices: () => ENGINES,
    read: () =>
      choiceOf(ENGINES, getWorkspacePreferences().get("searchEngine")),
    write: (value) => {
      getWorkspacePreferences().set(
        "searchEngine",
        SearchEngineIdSchema.parse(value),
      );
    },
  },
  "send-error-reports": onOff(() =>
    getMachinePreferences().get("sendErrorReportsAutomatically"),
  ),
  "share-activity": onOff(() =>
    getWorkspacePreferences().get("shareActionsWithChats"),
  ),
  "suggest-next-message": onOff(
    () => getWorkspacePreferences().get("suggestNextMessage"),
    (on) => {
      getWorkspacePreferences().set("suggestNextMessage", on);
    },
  ),
  "suggest-searches": onOff(() =>
    getWorkspacePreferences().get("suggestSearches"),
  ),
  theme: {
    choices: () => THEMES,
    read: () => choiceOf(THEMES, getWorkspacePreferences().get("theme")),
    write: (value) => {
      getWorkspacePreferences().set(
        "theme",
        WorkspacePreferencesSchema.shape.theme.parse(value),
      );
    },
  },
  zoom: {
    read: () => percent(zoomNow()),
    takes: ZOOM_RANGE,
    write: setZoom,
  },
};

function languageChoices(): Value[] {
  return [
    DETECT_LANGUAGE,
    ...DICTATION_LANGUAGES.map(({ code, name }) => ({
      label: name,
      value: code,
    })),
  ];
}

// `Object.keys` widens the keys to `string`; they are the record's ids.
const IDS = Object.keys(AGENT_SETTINGS) as AgentSettingId[];

function isId(id: string): id is AgentSettingId {
  return Object.hasOwn(AGENT_SETTINGS, id);
}

function linkOf(id: AgentSettingId) {
  const setting = AGENT_SETTINGS[id];
  const row = "row" in setting ? setting.row : id;
  return row === false ? undefined : `${APP_NAME_SLUG}://settings/${row}`;
}

async function settingOf(id: AgentSettingId): Promise<AppSetting> {
  const { changeable, detail, title } = AGENT_SETTINGS[id];
  const { choices, read, takes } = ACCESS[id];
  const link = linkOf(id);
  return {
    changeable,
    ...(choices && { choices: await choices() }),
    detail,
    id,
    ...(link === undefined ? {} : { link }),
    ...(takes === undefined ? {} : { takes }),
    title,
    value: await read(),
  };
}

/** The app's settings as `instrument settings` reads and sets them. */
export const agentSettings: AppSettings = {
  list: () => Promise.all(IDS.map(settingOf)),
  set: async (id, value) => {
    if (!isId(id)) {
      throw new Error(`no setting "${id}".`);
    }
    const { choices, write } = ACCESS[id];
    if (!AGENT_SETTINGS[id].changeable || !write) {
      throw new Error(`${AGENT_SETTINGS[id].title} is the user's to change.`);
    }
    if (!choices) {
      await write(value);
      return;
    }
    const all = await choices();
    const asked = value.toLowerCase();
    const picked =
      all.find((each) => each.value.toLowerCase() === asked) ??
      all.find((each) => each.label.toLowerCase() === asked);
    if (!picked) {
      throw new Error(
        `${id} takes ${all.map((each) => each.value).join(", ")}, not "${value}".`,
      );
    }
    await write(picked.value);
  },
};
