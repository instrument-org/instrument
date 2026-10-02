export function isFailedBashExitCode(exitCode: number | undefined) {
  return exitCode !== undefined && exitCode !== 0;
}
