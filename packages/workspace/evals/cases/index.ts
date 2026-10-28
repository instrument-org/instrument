import { WORKSPACE_INSTRUCTIONS_EVALS } from "./workspace-instructions";
import { APP_ACCOUNTS_EVALS } from "./app-accounts";
import { APP_IMPORT_FILE_EVALS } from "./app-import-file";
import { APP_OTHER_COMPUTER_EVALS } from "./app-other-computer";
import { APP_GUIDANCE_EVALS } from "./app-guidance";
import { APP_SCRIPTING_EVALS } from "./app-scripting";
import { APP_SCRIPTING_API_EVALS } from "./app-scripting-api";
import { APP_SIGN_IN_CARD_EVALS } from "./app-sign-in-card";
import { APP_SIGN_IN_REFUSED_EVALS } from "./app-sign-in-refused";
import { BACKGROUND_PROCESS_EVALS } from "./background-processes";
import { PROCESS_CONTROL_EVALS } from "./process-control";
import { BROWSER_DATA_EVALS } from "./browser-data";
import { BROWSER_SELECTION_EVALS } from "./browser-selection";
import { CHAT_HISTORY_EVALS } from "./chat-history";
import { CONTEXT_ROLLOVER_EVALS } from "./context-rollover";
import { COST_STUDY_EVALS } from "./cost-study";
import { CREATE_PAGE_SKILL_EVALS } from "./create-page-skill";
import { DEVELOPER_TOOLS_EVALS } from "./developer-tools";
import { DOCUMENT_DESIGN_EVALS } from "./document-design";
import { FILES_FENCE_EVALS } from "./files-fence";
import { HANDOFF_EVALS } from "./handoff";
import { IMAGE_BUDGET_EVALS } from "./image-budget";
import { IMAGE_OPTIONS_EVALS } from "./image-options";
import { IMAGE_REGION_EVALS } from "./image-region";
import { INTERRUPTION_EVALS } from "./interruptions";
import { INSTRUMENT_GUIDE_EVALS } from "./instrument-guide";
import { MEMORY_EVALS } from "./memory";
import { MESSAGE_BLOCK_EVALS } from "./message-blocks";
import { CHAT_EVALS } from "./chat";
import { DISCRETION_EVALS } from "./discretion";
import { OUTBOUND_EVALS } from "./outbound";
import { PDF_SKILL_EVALS } from "./pdf-skill";
import { PERMISSIONS_EVALS } from "./permissions";
import { QUESTIONS_EVALS } from "./questions";
import { REACH_EVALS } from "./reach";
import { REPLY_LINKS_EVALS } from "./reply-links";
import { REPLY_LINKS_HARD_EVALS } from "./reply-links-hard";
import { SANDBOXED_PYTHON_EVALS } from "./sandboxed-python";
import { SCENARIO_EVALS } from "./scenarios";
import { SKILLS_IN_PLACE_EVALS } from "./skills-in-place";
import { TEXT_TOOLS_EVALS } from "./text-tools";
import { TIME_ZONE_EVALS } from "./time-zone";
import { SOURCE_LINKS_EVALS } from "./source-links";
import { TASK_SESSION_EVALS } from "./task-sessions";
import { TASK_TABS_EVALS } from "./task-tabs";
import { UNPROMPTED_TOOL_EVALS } from "./unprompted-tools";
import { UNREADABLE_MEDIA_EVALS } from "./unreadable-media";
import { WEB_SCRIPTING_EVALS } from "./web-scripting";
import { WEB_SEARCH_EVALS } from "./web-search";
import { WINDOW_TABS_EVALS } from "./window-tabs";
import { WORKER_EVALS } from "./worker";
import { WORK_FOLDER_EVALS } from "./work-folder";
import { WORKSPACE_HYGIENE_EVALS } from "./workspace-hygiene";
import { WORKSPACE_PARTS_EVALS } from "./workspace-parts";
import { WHITEBOARD_EVALS } from "./whiteboard";

export const EVALS = [
  ...WORKSPACE_INSTRUCTIONS_EVALS,
  ...APP_ACCOUNTS_EVALS,
  ...APP_IMPORT_FILE_EVALS,
  ...APP_OTHER_COMPUTER_EVALS,
  ...APP_GUIDANCE_EVALS,
  ...APP_SCRIPTING_EVALS,
  ...APP_SCRIPTING_API_EVALS,
  ...APP_SIGN_IN_CARD_EVALS,
  ...APP_SIGN_IN_REFUSED_EVALS,
  ...BACKGROUND_PROCESS_EVALS,
  ...PROCESS_CONTROL_EVALS,
  ...BROWSER_DATA_EVALS,
  ...BROWSER_SELECTION_EVALS,
  ...CHAT_HISTORY_EVALS,
  ...CONTEXT_ROLLOVER_EVALS,
  ...COST_STUDY_EVALS,
  ...CREATE_PAGE_SKILL_EVALS,
  ...DEVELOPER_TOOLS_EVALS,
  ...DISCRETION_EVALS,
  ...DOCUMENT_DESIGN_EVALS,
  ...FILES_FENCE_EVALS,
  ...WHITEBOARD_EVALS,
  ...HANDOFF_EVALS,
  ...IMAGE_BUDGET_EVALS,
  ...IMAGE_OPTIONS_EVALS,
  ...IMAGE_REGION_EVALS,
  ...INTERRUPTION_EVALS,
  ...INSTRUMENT_GUIDE_EVALS,
  ...MEMORY_EVALS,
  ...WORKSPACE_PARTS_EVALS,
  ...WORKSPACE_HYGIENE_EVALS,
  ...MESSAGE_BLOCK_EVALS,
  ...CHAT_EVALS,
  ...OUTBOUND_EVALS,
  ...PDF_SKILL_EVALS,
  ...PERMISSIONS_EVALS,
  ...QUESTIONS_EVALS,
  ...REACH_EVALS,
  ...REPLY_LINKS_EVALS,
  ...REPLY_LINKS_HARD_EVALS,
  ...SANDBOXED_PYTHON_EVALS,
  ...SCENARIO_EVALS,
  ...SKILLS_IN_PLACE_EVALS,
  ...TEXT_TOOLS_EVALS,
  ...TIME_ZONE_EVALS,
  ...SOURCE_LINKS_EVALS,
  ...TASK_SESSION_EVALS,
  ...TASK_TABS_EVALS,
  ...UNPROMPTED_TOOL_EVALS,
  ...UNREADABLE_MEDIA_EVALS,
  ...WEB_SCRIPTING_EVALS,
  ...WEB_SEARCH_EVALS,
  ...WINDOW_TABS_EVALS,
  ...WORKER_EVALS,
  ...WORK_FOLDER_EVALS,
];
