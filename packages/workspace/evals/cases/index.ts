import { BROWSER_SELECTION_EVALS } from "./browser-selection";
import { CHECK_EVALS } from "./check";
import { PDF_SKILL_EVALS } from "./pdf-skill";
import { WEB_SEARCH_EVALS } from "./web-search";

export const EVALS = [
  ...BROWSER_SELECTION_EVALS,
  ...CHECK_EVALS,
  ...PDF_SKILL_EVALS,
  ...WEB_SEARCH_EVALS,
];
