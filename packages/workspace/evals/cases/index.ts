import { APP_ACCOUNTS_EVALS } from "./app-accounts";
import { APP_IMPORT_FILE_EVALS } from "./app-import-file";
import { APP_SCRIPTING_EVALS } from "./app-scripting";
import { BACKGROUND_PROCESS_EVALS } from "./background-processes";
import { BROWSER_SELECTION_EVALS } from "./browser-selection";
import { CONTEXT_ROLLOVER_EVALS } from "./context-rollover";
import { CREATE_PAGE_SKILL_EVALS } from "./create-page-skill";
import { DOCUMENT_DESIGN_EVALS } from "./document-design";
import { FILES_FENCE_EVALS } from "./files-fence";
import { GIT_OVER_MOUNTS_EVALS } from "./git-over-mounts";
import { IMAGE_REGION_EVALS } from "./image-region";
import { INSTRUMENT_GUIDE_EVALS } from "./instrument-guide";
import { LARGE_FOLDER_SEARCH_EVALS } from "./large-folder-search";
import { MEMORY_EVALS } from "./memory";
import { MESSAGE_BLOCK_EVALS } from "./message-blocks";
import { CHAT_EVALS } from "./chat";
import { PDF_SKILL_EVALS } from "./pdf-skill";
import { QUESTIONS_EVALS } from "./questions";
import { REACH_EVALS } from "./reach";
import { SANDBOXED_PYTHON_EVALS } from "./sandboxed-python";
import { SOURCE_LINKS_EVALS } from "./source-links";
import { TASK_TABS_EVALS } from "./task-tabs";
import { UNREADABLE_MEDIA_EVALS } from "./unreadable-media";
import { WEB_SEARCH_EVALS } from "./web-search";
import { WINDOW_TABS_EVALS } from "./window-tabs";
import { WORKER_EVALS } from "./worker";

export const EVALS = [
  ...APP_ACCOUNTS_EVALS,
  ...APP_IMPORT_FILE_EVALS,
  ...APP_SCRIPTING_EVALS,
  ...BACKGROUND_PROCESS_EVALS,
  ...BROWSER_SELECTION_EVALS,
  ...CONTEXT_ROLLOVER_EVALS,
  ...CREATE_PAGE_SKILL_EVALS,
  ...DOCUMENT_DESIGN_EVALS,
  ...FILES_FENCE_EVALS,
  ...GIT_OVER_MOUNTS_EVALS,
  ...IMAGE_REGION_EVALS,
  ...INSTRUMENT_GUIDE_EVALS,
  ...LARGE_FOLDER_SEARCH_EVALS,
  ...MEMORY_EVALS,
  ...MESSAGE_BLOCK_EVALS,
  ...CHAT_EVALS,
  ...PDF_SKILL_EVALS,
  ...QUESTIONS_EVALS,
  ...REACH_EVALS,
  ...SANDBOXED_PYTHON_EVALS,
  ...SOURCE_LINKS_EVALS,
  ...TASK_TABS_EVALS,
  ...UNREADABLE_MEDIA_EVALS,
  ...WEB_SEARCH_EVALS,
  ...WINDOW_TABS_EVALS,
  ...WORKER_EVALS,
];
