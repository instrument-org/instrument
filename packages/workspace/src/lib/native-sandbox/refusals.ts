/**
 * What the agent reads when Node stopped a script because the sandbox
 * refused it a package.json in a folder above the script. The `node`
 * command's own preload reads past that, so this is a Node another program
 * started; no card asks for the folder, which holds no work.
 */
export function packageScopeNote(output: string): string | undefined {
  const named =
    /Cannot read package config (.+?package\.json): (?:operation not permitted|permission denied)/i.exec(
      output,
    )?.[1];
  return named === undefined
    ? undefined
    : `The sandbox refused Node's look for a package.json above the script (${named.replace(/^\\\\\?\\/, "")}). \`node <script>\` from this shell reads past that; for a script another program starts, a package.json beside the script (\`{}\` is enough) ends the look there.`;
}
