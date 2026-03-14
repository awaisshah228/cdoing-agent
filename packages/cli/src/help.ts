import chalk from "chalk";

const VERSION = "0.1.0";

export function printWelcome(): void {
  console.log();
  console.log(chalk.bold.cyan("  ╔══════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("  ║") + chalk.bold.white(`       Cdoing Agent v${VERSION}            `) + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("  ║") + chalk.dim("   AI-Powered Coding Assistant        ") + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("  ╚══════════════════════════════════════╝"));
  console.log();
  console.log(chalk.dim("  Type your message and press Enter."));
  console.log(chalk.dim("  Type /help for commands.\n"));
}

export function printHelp(): void {
  console.log();
  console.log(chalk.bold("  Commands:"));
  console.log(chalk.cyan("    /help            ") + "Show this help");
  console.log(chalk.cyan("    /clear           ") + "Clear conversation history");
  console.log(chalk.cyan("    /model           ") + "Show current model");
  console.log(chalk.cyan("    /mode            ") + "Show permission mode");
  console.log(chalk.cyan("    /exit, /quit     ") + "Exit");
  console.log();
  console.log(chalk.bold("  Usage:"));
  console.log(chalk.dim("    cdoing                        ") + "Interactive mode");
  console.log(chalk.dim("    cdoing \"fix the bug\"           ") + "One-shot prompt");
  console.log(chalk.dim("    cdoing -p openai -m gpt-4o    ") + "Use OpenAI");
  console.log(chalk.dim("    cdoing --mode auto             ") + "Skip permission prompts");
  console.log();
}
