import { z } from "zod";

/** A setting's value, as the command takes it and as Settings words it. */
const SettingValueSchema = z.object({ label: z.string(), value: z.string() });

/** One of the app's settings, as the agent reads it. */
export const AppSettingSchema = z.object({
  /** Said after a change, where the change does not show everywhere at once. */
  afterChange: z.string().optional(),
  /** Whether a chat may change it. Off, the person does, at `link`. */
  changeable: z.boolean(),
  /** The values it takes, where they are few enough to name. */
  choices: z.array(SettingValueSchema).optional(),
  detail: z.string(),
  id: z.string(),
  /** Its address in the app, where a link opens it. */
  link: z.string().optional(),
  /** What it takes where that is not one of `choices`: `50% to 200%`. */
  takes: z.string().optional(),
  title: z.string(),
  value: SettingValueSchema,
});

export type AppSetting = z.output<typeof AppSettingSchema>;

/** The app's settings, which the app keeps and the workspace reads and sets through here. */
export interface AppSettings {
  /** Every setting the agent is told of. */
  list: () => Promise<AppSetting[]>;
  /** Sets one by its id. Throws, in words for the agent, what it cannot set. */
  set: (id: string, value: string) => Promise<void>;
}
