/**
 * Help & Welcome Display
 *
 * Provides formatted help output, the welcome banner,
 * and usage examples for the CLI.
 */

import chalk from "chalk";

const VERSION = "0.1.0";

/**
 * Print the welcome banner shown when entering interactive mode.
 */
export function printWelcome(): void {
  console.log();
  console.log(chalk.bold.cyan("  ╔══════════════════════════════════════╗"));
  console.log(
    chalk.bold.cyan("  ║") +
      chalk.bold.white(`       Cdoing Agent v${VERSION}            `) +
      chalk.bold.cyan("║")
  );
  console.log(
    chalk.bold.cyan("  ║") +
      chalk.dim("   AI-Powered Coding Assistant        ") +
      chalk.bold.cyan("║")
  );
  console.log(chalk.bold.cyan("  ╚══════════════════════════════════════╝"));
  console.log();
  console.log(chalk.dim("  Type your message and press Enter to chat."));
  console.log(chalk.dim("  Type /help for available commands."));
  console.log();
}

/** All slash commands with their descriptions and usage details */
const COMMANDS: { cmd: string; alias?: string; desc: string; detail?: string }[] = [
  {
    cmd: "/help",
    desc: "Show this help message",
  },
  {
    cmd: "/clear",
    desc: "Clear conversation history",
    detail: "Resets the context so the agent forgets prior messages.",
  },
  {
    cmd: "/model",
    desc: "Show current model info",
    detail: "Displays the active provider and model name.",
  },
  {
    cmd: "/mode",
    desc: "Show current permission mode",
    detail: "Modes: ask (confirm each action), auto-edit (auto file edits), auto (no confirmations).",
  },
  {
    cmd: "/exit",
    alias: "/quit",
    desc: "Exit the agent",
  },
];

/**
 * Print the full help screen with commands and usage examples.
 */
export function printHelp(): void {
  console.log();
  console.log(chalk.bold("  Commands:"));
  console.log();

  for (const { cmd, alias, desc, detail } of COMMANDS) {
    const label = alias ? `${cmd}, ${alias}` : cmd;
    console.log(chalk.cyan(`    ${label.padEnd(16)}`) + chalk.white(desc));
    if (detail) {
      console.log(chalk.dim(`                    ${detail}`));
    }
  }

  console.log();
  console.log(chalk.bold("  Usage examples:"));
  console.log();
  console.log(chalk.dim("    cdoing                          ") + chalk.white("Start interactive mode"));
  console.log(chalk.dim("    cdoing \"fix the login bug\"       ") + chalk.white("One-shot prompt"));
  console.log(chalk.dim("    cdoing -p openai -m gpt-4o      ") + chalk.white("Use OpenAI provider"));
  console.log(chalk.dim("    cdoing --mode auto-edit          ") + chalk.white("Auto-approve file edits"));
  console.log(chalk.dim("    cdoing -d ./my-project           ") + chalk.white("Set working directory"));
  console.log();
}
