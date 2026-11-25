import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { systemNote } from "./system-note";
import { TAKEOVER_WORDS } from "../../lib/screen-words";

/**
 * The note a Take over or a Continue reaches the agent with: the person took
 * a page it was working in, which stopped it, or gave the page back; or closed
 * the page, which stopped it, and pressed Continue. Either way the page may have moved on, so it is named as it stood then.
 */
export function pageTakeoverModelNote({
  page,
  stage,
  tab,
}: SessionMessageDataPart.PageTakeoverDataPart): string {
  const at = `${page.url}${page.title ? ` ("${page.title}")` : ""}`;
  switch (stage) {
    case "closed": {
      return systemNote`The user closed tab ${tab}, at ${at}, and that stopped your work.`;
    }
    case "continued": {
      return systemNote`The user pressed ${TAKEOVER_WORDS.giveBack} after closing tab ${tab}, at ${at}, which may still be closed. Carry on with what you were doing.`;
    }
    case "returned": {
      return systemNote`The user gave tab ${tab} back with ${TAKEOVER_WORDS.giveBack}; it is now at ${at}. Look at the page before going on, since they may have changed it, then carry on with what you were doing.`;
    }
    case "taken": {
      return systemNote`The user took over tab ${tab}, at ${at}, and that stopped your work. They may change the page while they have it.`;
    }
  }
}
