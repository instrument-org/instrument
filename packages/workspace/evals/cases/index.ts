import { CHECK_EVALS } from "./check";
import { IMAGE_REGION_EVALS } from "./image-region";
import { PDF_SKILL_EVALS } from "./pdf-skill";
import { WEB_SEARCH_EVALS } from "./web-search";

export const EVALS = [
  ...CHECK_EVALS,
  ...IMAGE_REGION_EVALS,
  ...PDF_SKILL_EVALS,
  ...WEB_SEARCH_EVALS,
];
