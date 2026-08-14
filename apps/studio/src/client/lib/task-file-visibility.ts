export function isFileInTaskFolder(filePath: string, folderName: string) {
  return filePath.startsWith(`${folderName}/`);
}

export function isRootTaskFile(filePath: string) {
  // Root-level, non-dotfile: surfaces a deliverable saved to the task root while
  // hiding setup dotfiles like `.gitignore`.
  return !filePath.includes("/") && !filePath.startsWith(".");
}
