import { APP_NAME_SLUG } from "@instrument-org/shared";
import { dedent } from "radashi";

export function systemNote(
  strings: TemplateStringsArray,
  ...values: unknown[]
) {
  const content = dedent(strings, ...values);
  return dedent`

    <${APP_NAME_SLUG}-system-note>
    ${content}
    </${APP_NAME_SLUG}-system-note>
  `;
}
