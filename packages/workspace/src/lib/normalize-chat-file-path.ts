// Tool outputs (e.g. generate_image) keep the agent-facing "./"-prefixed
// convention from fixRelativePath; chat file index paths are bare. Strip
// the prefix when building URLs or resolving a path from either source.
export function normalizeChatFilePath(filePath: string): string {
  return filePath.startsWith("./") ? filePath.slice(2) : filePath;
}
