import { z } from "zod";

import {
  SETTINGS_ARE_THE_CHATS,
  SETTINGS_COMMAND,
} from "../../model-text/commands/settings-command";
import { type AppSetting, AppSettingSchema } from "../app-settings";
import { appSettings, recordSettingChange } from "../setting-changes";
import { defineCapability } from "./define";

const NAME = SETTINGS_COMMAND.name;

/** The value as the command takes it, with Settings' word for it where they differ. */
function valueWords({ label, value }: AppSetting["value"]) {
  return label.toLowerCase() === value.toLowerCase()
    ? value
    : `${value} (${label})`;
}

function linkOf({ link, title }: AppSetting) {
  return link === undefined ? undefined : `[${title}](${link})`;
}

function settingText(setting: AppSetting): string {
  const takes =
    setting.takes ??
    (setting.choices ? setting.choices.map(valueWords).join(", ") : undefined);
  const link = linkOf(setting);
  return [
    `${setting.id}: ${setting.title}`,
    `  ${setting.detail}`,
    `  Now: ${valueWords(setting.value)}`,
    ...(setting.changeable
      ? takes === undefined
        ? []
        : [`  Takes: ${takes}`]
      : [`  The user changes this one themselves; link it.`]),
    ...(link === undefined ? [] : [`  Link: ${link}`]),
  ].join("\n");
}

async function settingById(id: string): Promise<AppSetting> {
  const all = await appSettings().list();
  const found = all.find((each) => each.id === id.toLowerCase());
  if (!found) {
    throw new Error(
      `no setting "${id}" here. The settings: ${all.map((each) => each.id).join(", ")}. The rest of Settings is the user's to change: load the instrument-guide skill and link it.`,
    );
  }
  return found;
}

export const settingsList = defineCapability({
  input: z.object({}),
  name: "settings.list",
  output: z.array(AppSettingSchema),
  run: () => appSettings().list(),
  summary:
    "Every setting here: what it is, its value now, what it takes, and which the user changes themselves.",
  surfaces: { cli: { help: "", words: ["settings", "list"] } },
  text: (settings) => settings.map(settingText).join("\n\n"),
});

export const settingsGet = defineCapability({
  input: z.object({
    id: z.string({ error: `get: which setting? ${NAME} list names them.` }),
  }),
  name: "settings.get",
  output: AppSettingSchema,
  run: ({ id }) => settingById(id),
  summary: "One setting: what it is, its value now and what it takes.",
  surfaces: {
    cli: { help: "", positional: ["id"], words: ["settings", "get"] },
  },
  text: settingText,
});

export const settingsSet = defineCapability({
  input: z.object({
    id: z.string({ error: `set: which setting? ${NAME} list names them.` }),
    value: z
      .string({ error: `set: to what? ${NAME} get <id> says what it takes.` })
      .trim()
      .min(1, `set: to what? ${NAME} get <id> says what it takes.`),
  }),
  name: "settings.set",
  output: z.object({ after: AppSettingSchema, before: AppSettingSchema }),
  async run({ id, value }) {
    const before = await settingById(id);
    if (!before.changeable) {
      const link = linkOf(before);
      throw new Error(
        `${before.title} is the user's to change.${link ? ` Link it for them: ${link}.` : ""}`,
      );
    }
    await appSettings().set(before.id, value);
    const after = await settingById(before.id);
    recordSettingChange({
      after: after.value,
      before: before.value,
      id: after.id,
      title: after.title,
      ...(after.link === undefined ? {} : { link: after.link }),
    });
    return { after, before };
  },
  summary:
    "Change one setting, at once. A card under the reply says what changed, with Undo.",
  surfaces: {
    cli: {
      help: "",
      positional: ["id", "value"],
      rest: true,
      words: ["settings", "set"],
    },
  },
  text: ({ after, before }) =>
    after.value.value === before.value.value
      ? `${after.title} was ${valueWords(after.value)} already.`
      : `${after.title} is ${valueWords(after.value)}. It was ${valueWords(before.value)}.`,
  where: { roleRefusal: SETTINGS_ARE_THE_CHATS, roles: ["chat"] },
});
