import { APP_NAME_SLUG } from "../constants";

export type WorkspaceServerURL = string & { WorkspaceServerURL: true };
export const SYNTHETIC_MODEL_ID = `${APP_NAME_SLUG}-synthetic`;
export type SyntheticModelId = typeof SYNTHETIC_MODEL_ID;
