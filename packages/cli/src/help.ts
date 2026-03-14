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
  console.log(chalk.cyan("    /compact             ") + "Compress conversation context");
  console.log(chalk.cyan("    /cost                ") + "Show detailed cost breakdown");
  console.log(chalk.cyan("    /doctor              ") + "Check system health");
  console.log(chalk.cyan("    /init                ") + "Initialize project config");
  console.log(chalk.cyan("    /dir <path>          ") + "Change working directory");
  console.log(chalk.cyan("    /exit, /quit         ") + "Exit");
  console.log();
  console.log(chalk.bold("  Authentication:"));
  console.log(chalk.cyan("    /login               ") + "Show authentication options");
  console.log(chalk.cyan("    /logout              ") + "Clear stored tokens");
  console.log(chalk.cyan("    /auth-status         ") + "Show current authentication status");
  console.log();
  console.log(chalk.bold("  CLI Usage:"));
  console.log(chalk.dim("    cdoing                          ") + "Interactive mode");
  console.log(chalk.dim("    cdoing --login                  ") + "Show auth setup instructions");
  console.log(chalk.dim("    cdoing --logout                 ") + "Clear stored tokens");
  console.log(chalk.dim("    cdoing \"fix the bug\"             ") + "One-shot prompt");
  console.log(chalk.dim("    cdoing --api-key sk-...         ") + "Use API key directly");
  console.log(chalk.dim("    cdoing -p openai -m gpt-4o      ") + "Use OpenAI");
  console.log(chalk.dim("    cdoing --mode auto              ") + "Skip all permission prompts");
  console.log(chalk.dim("    cdoing -d ./my-project          ") + "Set working directory");
  console.log();
  console.log(chalk.bold("  Advanced Flags:"));
  console.log(chalk.dim("    cdoing --print \"prompt\"         ") + "Non-interactive output only");
  console.log(chalk.dim("    cdoing -r <id> \"prompt\"         ") + "Resume conversation by ID");
  console.log(chalk.dim("    cdoing -c \"prompt\"              ") + "Continue last conversation");
  console.log(chalk.dim("    cdoing --max-turns 5 \"prompt\"   ") + "Limit agent iterations");
  console.log(chalk.dim("    cdoing --output-format json     ") + "Output as JSON");
  console.log(chalk.dim("    cdoing --verbose                ") + "Enable debug logging");
  console.log(chalk.dim("    cdoing --system-prompt \"...\"    ") + "Custom system prompt");
  console.log(chalk.dim("    cdoing --allowed-tools a,b      ") + "Whitelist tools");
  console.log(chalk.dim("    cdoing --disallowed-tools a,b   ") + "Blacklist tools");
  console.log();
  console.log(chalk.bold("  Subcommands:"));
  console.log(chalk.dim("    cdoing config list              ") + "List config values");
  console.log(chalk.dim("    cdoing config get <key>         ") + "Get config value");
  console.log(chalk.dim("    cdoing config set <key> <val>   ") + "Set config value");
  console.log(chalk.dim("    cdoing init                     ") + "Initialize .cdoing/config.md");
  console.log(chalk.dim("    cdoing doctor                   ") + "Diagnose setup issues");
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
