/**
 * Terminal Title — set/reset the terminal window title via escape sequences
 */

export function setTerminalTitle(title: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b]0;${title}\x07`);
  }
}

export function resetTerminalTitle(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b]0;\x07`);
  }
}
