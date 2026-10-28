import { APP_NAME } from "@instrument-org/shared";

import { type MacAppDefinition } from "../mac-apps/tool";
import { APP_COMMAND } from "../shell-commands/app-command";

/**
 * A Mac app's guide, from its tools' own descriptions: what it is for, how a
 * tool is called, each tool with the arguments it takes (`?` for one that
 * may be left out), and what exit code 2 means.
 */
export function macAppGuide(app: MacAppDefinition, slug: string): string {
  const tools = app.tools.map((tool) => {
    const args = tool.args.map(({ name, optional }) =>
      optional ? `${name}?` : name,
    );
    return `- ${tool.name}(${args.join(", ")}): ${tool.description}`;
  });
  return [
    app.about,
    `\`${APP_COMMAND.name} call ${slug} <tool> '<json>'\` runs a tool, and \`${APP_COMMAND.name} tool ${slug} <tool>\` shows the JSON it takes.`,
    tools.join("\n"),
    `The first time a chat uses ${app.name}, macOS may ask the person. Exit code 2 means macOS keeps ${APP_NAME} out of ${app.name}: the person now sees a card that lets them change it, and their answer wakes you, so stop there and say what you're waiting for.`,
  ].join("\n\n");
}
