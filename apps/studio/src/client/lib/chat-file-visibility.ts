export function isFileInChatFolder(filePath: string, folderName: string) {
  return filePath.startsWith(`${folderName}/`);
}

export function isRootChatFile(filePath: string) {
  // Root-level, non-dotfile: surfaces a deliverable saved to the chat's folder while
  // hiding setup dotfiles like `.gitignore`.
  return !filePath.includes("/") && !filePath.startsWith(".");
}
