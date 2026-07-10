import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel, getToolStreamingLabel } from "../../lib/tool-display";
import { useToolCallSession } from "./tool-call-session";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type ConnectorMcpPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connector_mcp" }
>;

type ConnectorRequestPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connector_request" }
>;

type ConnectorTestPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connector_test" }
>;

export function ToolConnectorMcp({ part }: { part: ConnectorMcpPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input) {
    return null;
  }

  const label = isStreaming
    ? getToolStreamingLabel("connector_mcp")
    : getToolLabel("connector_mcp");
  const output = part.state === "output-available" ? part.output : undefined;
  const slug = part.input.slug ?? "";
  const subtitle =
    part.input.action === "call_tool"
      ? `${slug} · ${part.input.tool ?? ""}`
      : `${slug} · list tools`;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {label} · {subtitle}
        </p>
      </ToolCardHeader>

      {output?.state === "failure" && (
        <ToolCardSection maxHeight="max-h-32">
          <p className="text-sm text-destructive">{output.message}</p>
        </ToolCardSection>
      )}

      {output?.state === "guide" && (
        <ToolCardSection maxHeight="max-h-32">
          <p className="text-sm text-muted-foreground">
            Read the connector guide before using its tools.
          </p>
        </ToolCardSection>
      )}

      {output?.state === "tools" && (
        <ToolCardSection maxHeight="max-h-64">
          <div className="space-y-0.5">
            {output.tools.map((tool) => (
              <p className="font-mono text-sm" key={tool.name}>
                {tool.name}
              </p>
            ))}
          </div>
        </ToolCardSection>
      )}

      {output?.state === "result" && (
        <ToolCardSection maxHeight="max-h-64">
          <pre className="font-mono text-sm wrap-break-word whitespace-pre-wrap">
            {output.text}
          </pre>
        </ToolCardSection>
      )}
    </ToolCard>
  );
}

export function ToolConnectorRequest({ part }: { part: ConnectorRequestPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input) {
    return null;
  }

  const label = isStreaming
    ? getToolStreamingLabel("connector_request")
    : getToolLabel("connector_request");
  const command =
    `${part.input.method ?? "GET"} ${part.input.path ?? ""}`.trim();
  const output = part.state === "output-available" ? part.output : undefined;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {label} · {part.input.slug}
        </p>
      </ToolCardHeader>

      <ToolCardSection borderBottom={output !== undefined} maxHeight="max-h-16">
        <div className="flex font-mono text-sm leading-relaxed">
          <span className="mr-2 shrink-0 text-muted-foreground select-none">
            $
          </span>
          <span className="break-all whitespace-pre-wrap">{command}</span>
        </div>
      </ToolCardSection>

      {output?.state === "guide" && (
        <ToolCardSection maxHeight="max-h-32">
          <p className="text-sm text-muted-foreground">
            Read the connector guide before making requests.
          </p>
        </ToolCardSection>
      )}

      {output?.state === "failure" && (
        <ToolCardSection maxHeight="max-h-32">
          <p className="text-sm text-destructive">{output.message}</p>
        </ToolCardSection>
      )}

      {output?.state === "success" && (
        <ToolCardSection maxHeight="max-h-64">
          <p className="pb-1 font-mono text-xs text-muted-foreground">
            {output.status} {output.contentType}
          </p>
          <pre className="font-mono text-sm wrap-break-word whitespace-pre-wrap">
            {output.bodyText}
          </pre>
        </ToolCardSection>
      )}
    </ToolCard>
  );
}

export function ToolConnectorTest({ part }: { part: ConnectorTestPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input) {
    return null;
  }

  const label = isStreaming
    ? getToolStreamingLabel("connector_test")
    : getToolLabel("connector_test");
  const output = part.state === "output-available" ? part.output : undefined;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {label} · {part.input.slug}
        </p>
      </ToolCardHeader>

      {output && (
        <ToolCardSection maxHeight="max-h-64">
          <div className="space-y-0.5">
            {output.checks.map((check) => (
              <p className="font-mono text-sm" key={check.name}>
                <span
                  className={
                    check.status === "fail"
                      ? "text-destructive"
                      : check.status === "pass"
                        ? "text-success-700 dark:text-success-300"
                        : "text-muted-foreground"
                  }
                >
                  {check.status.toUpperCase()}
                </span>{" "}
                {check.name}
                {check.status === "fail" && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {check.detail}
                  </span>
                )}
              </p>
            ))}
            <p className="pt-1 text-sm text-muted-foreground">
              {output.passed
                ? "All checks passed; connector enabled."
                : "Checks failed."}
            </p>
          </div>
        </ToolCardSection>
      )}
    </ToolCard>
  );
}
