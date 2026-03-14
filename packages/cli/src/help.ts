import chalk from "chalk";

const VERSION = "0.1.0";

export function printWelcome(): void {
  console.log();
  console.log(chalk.bold.cyan("  ╔══════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("  ║") + chalk.bold.white(`       Cdoing Agent v${VERSION}            `) + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("  ║") + chalk.dim("   AI-Powered Coding Assistant        ") + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("  ╚══════════════════════════════════════╝"));
  console.log();
  console.log(chalk.dim("  Type your message and press Enter to chat."));
  console.log(chalk.dim("  Type " + chalk.white("?") + " for help, " + chalk.white("!cmd") + " to run commands, " + chalk.white("/config") + " to view settings."));
  console.log();
}

export function printHelp(): void {
  console.log();
  console.log(chalk.bold("  Shortcuts:"));
  console.log(chalk.cyan("    ?                    ") + "Show this help");
  console.log(chalk.cyan("    Ctrl+C               ") + "Cancel / Exit");
  console.log();
  console.log(chalk.bold("  Commands:"));
  console.log(chalk.cyan("    /help                ") + "Show this help");
  console.log(chalk.cyan("    /new                 ") + "Start a new conversation");
  console.log(chalk.cyan("    /history             ") + "List saved conversations");
  console.log(chalk.cyan("    /resume <id>         ") + "Resume a saved conversation");
  console.log(chalk.cyan("    /delete <id>         ") + "Delete a saved conversation");
  console.log(chalk.cyan("    /clear               ") + "Clear current conversation");
  console.log(chalk.cyan("    /config              ") + "Show current configuration");
  console.log(chalk.cyan("    /model <name>        ") + "Switch model  (e.g. /model gpt-4o)");
  console.log(chalk.cyan("    /provider <name>     ") + "Switch provider  (e.g. /provider openai)");
  console.log(chalk.cyan("    /mode <mode>         ") + "Change permission mode  (ask, auto-edit, auto)");
  console.log(chalk.cyan("    /permissions         ") + "View/clear stored permissions");
  console.log(chalk.cyan("    /memory              ") + "View/manage persistent memory");
  console.log(chalk.cyan("    /hooks               ") + "View configured hooks");
  console.log(chalk.cyan("    /usage               ") + "Show token usage and cost");
  console.log(chalk.cyan("    /dir <path>          ") + "Change working directory");
  console.log(chalk.cyan("    /exit, /quit         ") + "Exit");
  console.log();
  console.log(chalk.bold("  CLI Usage:"));
  console.log(chalk.dim("    cdoing                          ") + "Interactive mode");
  console.log(chalk.dim("    cdoing \"fix the bug\"             ") + "One-shot prompt");
  console.log(chalk.dim("    cdoing -p openai -m gpt-4o      ") + "Use OpenAI");
  console.log(chalk.dim("    cdoing --mode auto               ") + "Skip all permission prompts");
  console.log(chalk.dim("    cdoing -d ./my-project           ") + "Set working directory");
  console.log();
}

export function printConfig(config: {
  provider: string;
  model: string;
  mode: string;
  dir: string;
}): void {
  console.log();
  console.log(chalk.bold("  Current Configuration:"));
  console.log(chalk.cyan("    Provider:    ") + chalk.white(config.provider));
  console.log(chalk.cyan("    Model:       ") + chalk.white(config.model || "(default)"));
  console.log(chalk.cyan("    Mode:        ") + chalk.white(config.mode));
  console.log(chalk.cyan("    Directory:   ") + chalk.white(config.dir));
  console.log();
}
