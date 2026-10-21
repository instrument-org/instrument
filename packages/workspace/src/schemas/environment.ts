import { z } from "zod";

/**
 * The facts about the computer a session runs on that its model is told.
 * The session's baseline records them as it is written, and a note on a later
 * message tells the ones that changed (another computer, an OS update, a new
 * time zone, a moved folder). Compared as values, so a build that words them
 * differently has nothing new to tell. Folders are in the shell's spelling,
 * as the agent writes them.
 */
export const EnvironmentSchema = z.object({
  /** Where the workspace's apps are, behind `$INSTRUMENT_APPS`. */
  appsFolder: z.string(),
  /**
   * What this computer's shell has beyond the bash tool's list, as
   * `computerCommandsText` words it; empty for nothing. Absent on a baseline
   * written before it was told, which the next note then tells.
   */
  commands: z.string().optional(),
  /** The OS and its version, as `getSystemInfo` names them. */
  computer: z.string(),
  homeFolder: z.string(),
  /**
   * The options `generate_image` takes for the image model the chat's model
   * picks among the connected providers, as `imageParametersDescription`
   * words them. Absent on a baseline written before it was told.
   */
  imageOptions: z.string().optional(),
  /** Where finished work goes, behind `$INSTRUMENT_OUTPUT`. */
  outputFolder: z.string(),
  /** `process.platform`, which decides the shell guidance a computer gets. */
  platform: z.string(),
  timeZone: z.string(),
  /** The workspace's own skills, behind `$INSTRUMENT_WORKSPACE_SKILLS`. */
  workspaceSkillsFolder: z.string(),
});

export type Environment = z.output<typeof EnvironmentSchema>;

/** The facts that changed, each at its new value. */
export const EnvironmentChangeSchema = EnvironmentSchema.partial();

export type EnvironmentChange = z.output<typeof EnvironmentChangeSchema>;
