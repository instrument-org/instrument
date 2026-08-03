import { type PresetSessionData } from "../helpers";
import { session as errorApi } from "./error-api";
import { session as errorApiKey } from "./error-api-key";
import { session as errorConsecutive } from "./error-consecutive";
import { session as errorHidingBehaviors } from "./error-hiding-behaviors";
import { session as errorInsufficientCredits } from "./error-insufficient-credits";
import { session as errorModelNotAllowed } from "./error-model-not-allowed";
import { session as errorModelNotFound } from "./error-model-not-found";
import { session as errorMultiple } from "./error-multiple";
import { session as errorNoImageModel } from "./error-no-image-model";
import { session as errorNoModelRequested } from "./error-no-model-requested";
import { session as errorNoWebSearchModel } from "./error-no-web-search-model";
import { session as errorTimeout } from "./error-timeout";
import { session as errorUnknown } from "./error-unknown";
import { session as expandableUserMessage } from "./expandable-user-message";
import { session as fileFolderAttachments } from "./file-folder-attachments";
import { session as maxStepsResume } from "./max-steps-resume";
import { session as mermaidDiagrams } from "./mermaid-diagrams";
import { session as multiTurn } from "./multi-turn";
import { session as toolsBash } from "./tools-bash";
import { session as toolsEmptyMessageLeading } from "./tools-empty-message-leading";
import { session as toolsInputAvailable } from "./tools-input-available";
import { session as toolsInputStreaming } from "./tools-input-streaming";
import { session as toolsMultiStepBoundary } from "./tools-multi-step-boundary";
import { session as toolsNoExplanation } from "./tools-no-explanation";
import { session as toolsOutputError } from "./tools-output-error";
import { session as toolsValid } from "./tools-valid";

// Explicit, not a glob: an eager glob plus module-scope registration produced
// a duplicate entry per file every time HMR re-ran one of them.
export const sessionData: PresetSessionData[] = [
  errorApiKey,
  errorApi,
  errorConsecutive,
  errorHidingBehaviors,
  errorInsufficientCredits,
  errorModelNotAllowed,
  errorModelNotFound,
  errorMultiple,
  errorNoImageModel,
  errorNoModelRequested,
  errorNoWebSearchModel,
  errorTimeout,
  errorUnknown,
  expandableUserMessage,
  fileFolderAttachments,
  maxStepsResume,
  mermaidDiagrams,
  multiTurn,
  toolsBash,
  toolsEmptyMessageLeading,
  toolsInputAvailable,
  toolsInputStreaming,
  toolsMultiStepBoundary,
  toolsNoExplanation,
  toolsOutputError,
  toolsValid,
];
