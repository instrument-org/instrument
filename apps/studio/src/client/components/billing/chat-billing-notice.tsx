import { ReplyNote, ReplyNoteButton } from "@/client/components/reply-note";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { GaugeIcon } from "@phosphor-icons/react/Gauge";
import { WarningIcon } from "@phosphor-icons/react/Warning";

import {
  type ChatBillingNoticeState,
  useChatBillingNotice,
} from "./use-chat-billing-notice";

/**
 * What the chat says about the plan, drawn as the note over its reply box.
 * Which note shows and when is `useChatBillingNotice`'s; this is only how it
 * reads.
 */
export function ChatBillingNotice(
  props: Parameters<typeof useChatBillingNotice>[0],
) {
  const state = useChatBillingNotice(props);
  return state ? <ChatBillingNoticeView state={state} /> : null;
}

export function ChatBillingNoticeView({
  state,
}: {
  state: ChatBillingNoticeState;
}) {
  if (state.kind === "notice") {
    const { copy, notice } = state;
    const isGood = notice.kind === "resumed";
    return (
      <ReplyNote
        action={
          copy.action && (
            <ReplyNoteButton
              disabled={copy.action.kind === "update-card" && state.isPending}
              emphasis={isGood}
              onClick={() => {
                if (copy.action) {
                  state.act(copy.action.kind);
                }
              }}
            >
              {copy.action.label}
            </ReplyNoteButton>
          )
        }
        data-billing-notice={notice.kind}
        icon={isGood ? CheckCircleIcon : WarningIcon}
        iconClassName={
          isGood ? "text-brand-600 dark:text-brand-300" : undefined
        }
        onDismiss={state.dismiss}
        tone={isGood ? "neutral" : "warn"}
      >
        <span className="font-medium">{copy.title}.</span> {copy.line}
      </ReplyNote>
    );
  }
  return (
    <ReplyNote
      action={
        state.canGoUp && (
          <ReplyNoteButton onClick={state.seePlans}>See plans</ReplyNoteButton>
        )
      }
      data-billing-usage-warning={state.warning.kind}
      icon={GaugeIcon}
      onDismiss={state.dismiss}
      tone="neutral"
    >
      {state.text}
    </ReplyNote>
  );
}
