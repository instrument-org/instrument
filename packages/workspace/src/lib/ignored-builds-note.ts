import { PNPM_COMMAND } from "./shell-commands/pnpm";
import { systemNote } from "./system-note";

/**
 * Guidance for packages whose install scripts pnpm skipped, or undefined when
 * the output does not report any.
 *
 * Matches both spellings pnpm uses: a warning box when strictDepBuilds is off,
 * and ERR_PNPM_IGNORED_BUILDS when it is on. Only the shared
 * "Ignored build scripts:" prefix is common to the two.
 *
 * Shared rather than inlined where the command finishes, because an install slow
 * enough to be handed back as a background process reports this on a later read
 * instead, and that is exactly the install most likely to have skipped a build.
 */
export function ignoredBuildsNote(output: string): string | undefined {
  if (!output.includes("Ignored build scripts:")) {
    return undefined;
  }

  return systemNote`
    Some packages were not built during installation.
    If you encounter "Cannot find module" errors or the package doesn't work:

    1. Read pnpm-workspace.yaml from the workspace root.
    2. Add the package names from the warning to the \`allowBuilds\` mapping.
    \`\`\`yaml
    allowBuilds:
      esbuild: true
      sharp: true
    \`\`\`
    3. Run \`${PNPM_COMMAND.name} rebuild <package-name>\` for each package you added.

    All three steps are required. Running rebuild without first modifying pnpm-workspace.yaml will not fix the issue.
  `;
}
