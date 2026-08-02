import { StoreId } from "@instrument-org/workspace/client";

import { type PresetSessionData, SessionBuilder } from "../helpers";

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();

const userMessageId = StoreId.newMessageId();

// A diagram is laid out from measured text, follows the app theme, and has to
// survive a chat column narrower than it is — none of which reading the code
// tells you. This preset is the surface for looking at all three at once,
// including the half-written fence a streaming message spends most of its time
// showing and the broken one that has to stay a code block.
export const session: PresetSessionData = {
  messages: [
    {
      id: userMessageId,
      metadata: {
        createdAt: builder.nextTime(),
        sessionId,
      },
      parts: [builder.textPart("Draw me some diagrams.", userMessageId)],
      role: "user",
    },
    builder.assistantMessage(
      [
        "A flowchart:",
        "",
        "```mermaid",
        "graph TD",
        "  A[Prompt] --> B{Needs a tool?}",
        "  B -->|Yes| C[Run tool]",
        "  B -->|No| D[Answer]",
        "  C --> A",
        "```",
        "",
        "A sequence diagram:",
        "",
        "```mermaid",
        "sequenceDiagram",
        "  participant U as User",
        "  participant S as Studio",
        "  participant M as Model",
        "  U->>S: Send prompt",
        "  S->>M: Stream request",
        "  M-->>S: Tokens",
        "  S-->>U: Rendered markdown",
        "```",
        "",
        "One wider than the column, which must not push the column open:",
        "",
        "```mermaid",
        "graph LR",
        "  A[Collect the source] --> B[Check that it parses]",
        "  B --> C[Render to SVG]",
        "  C --> D[Constrain to the column]",
        "  D --> E[Offer the source back]",
        "```",
        "",
        "A fence that never parses, which stays a code block:",
        "",
        "```mermaid",
        "graph TD",
        "  A --> ((((",
        "```",
        "",
        "A fence caught mid-stream, which also stays a code block until it",
        "finishes:",
        "",
        "```mermaid",
        "graph TD",
        "  A[Start] --> B[Half written",
        "```",
      ].join("\n"),
    ),
  ],
  name: "Markdown: Mermaid",
};
