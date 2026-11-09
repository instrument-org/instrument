import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * The note a Take over or a Continue reaches the agent with: the person took
 * a page it was working in, which stopped it, or gave the page back. Either
 * way the page may have moved on, so it is named as it stood then.
 */
export function pageTakeoverModelNote({
  page,
  stage,
  tab,
}: SessionMessageDataPart.PageTakeoverDataPart): string {
  const at = `${page.url}${page.title ? ` ("${page.title}")` : ""}`;
  return stage === "taken"
    ? systemNote`The user took over tab ${tab}, at ${at}, and that stopped your work. They may change the page while they have it.`
    : systemNote`The user gave tab ${tab} back with Continue; it is now at ${at}. Look at the page before going on, since they may have changed it, then carry on with what you were doing.`;
}
