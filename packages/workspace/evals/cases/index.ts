import { BACKGROUND_PROCESS_EVALS } from "./background-processes";
import { BROWSER_SELECTION_EVALS } from "./browser-selection";
import { CHECK_EVALS } from "./check";
import { FILES_FENCE_EVALS } from "./files-fence";
import { IMAGE_REGION_EVALS } from "./image-region";
import { PDF_SKILL_EVALS } from "./pdf-skill";
import { PROJECT_FOLDER_DISCIPLINE_EVALS } from "./project-folder-discipline";
import { PROJECT_INSTRUCTIONS_EVALS } from "./project-instructions";
import { SHOW_EVALS } from "./show";
import { UNREADABLE_MEDIA_EVALS } from "./unreadable-media";
import { WEB_SEARCH_EVALS } from "./web-search";

export const EVALS = [
  ...BACKGROUND_PROCESS_EVALS,
  ...BROWSER_SELECTION_EVALS,
  ...CHECK_EVALS,
  ...FILES_FENCE_EVALS,
  ...IMAGE_REGION_EVALS,
  ...PDF_SKILL_EVALS,
  ...PROJECT_FOLDER_DISCIPLINE_EVALS,
  ...PROJECT_INSTRUCTIONS_EVALS,
  ...SHOW_EVALS,
  ...UNREADABLE_MEDIA_EVALS,
  ...WEB_SEARCH_EVALS,
];
