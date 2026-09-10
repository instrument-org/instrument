import { BACKGROUND_PROCESS_EVALS } from "./background-processes";
import { BROWSER_SELECTION_EVALS } from "./browser-selection";
import { CONTEXT_ROLLOVER_EVALS } from "./context-rollover";
import { CREATE_PAGE_SKILL_EVALS } from "./create-page-skill";
import { FILES_FENCE_EVALS } from "./files-fence";
import { IMAGE_REGION_EVALS } from "./image-region";
import { ORCHESTRATOR_EVALS } from "./orchestrator";
import { PDF_SKILL_EVALS } from "./pdf-skill";
import { PROJECT_FOLDER_DISCIPLINE_EVALS } from "./project-folder-discipline";
import { PROJECT_INSTRUCTIONS_EVALS } from "./project-instructions";
import { SANDBOXED_PYTHON_EVALS } from "./sandboxed-python";
import { SHOW_EVALS } from "./show";
import { SOURCE_LINKS_EVALS } from "./source-links";
import { UNREADABLE_MEDIA_EVALS } from "./unreadable-media";
import { WEB_SEARCH_EVALS } from "./web-search";
import { WORKER_EVALS } from "./worker";

export const EVALS = [
  ...BACKGROUND_PROCESS_EVALS,
  ...BROWSER_SELECTION_EVALS,
  ...CONTEXT_ROLLOVER_EVALS,
  ...CREATE_PAGE_SKILL_EVALS,
  ...FILES_FENCE_EVALS,
  ...IMAGE_REGION_EVALS,
  ...ORCHESTRATOR_EVALS,
  ...PDF_SKILL_EVALS,
  ...PROJECT_FOLDER_DISCIPLINE_EVALS,
  ...PROJECT_INSTRUCTIONS_EVALS,
  ...SANDBOXED_PYTHON_EVALS,
  ...SHOW_EVALS,
  ...SOURCE_LINKS_EVALS,
  ...UNREADABLE_MEDIA_EVALS,
  ...WEB_SEARCH_EVALS,
  ...WORKER_EVALS,
];
