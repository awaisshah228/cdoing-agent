import chalk from "chalk";

const VERSION = "0.1.0";

// Gradient colors for the banner
const gradientColors = ["#FF6B6B", "#FEC89A", "#FFD93D", "#6BCB77", "#4D96FF", "#9B5DE5"];

function gradient(text: string): string {
  const chars = text.split("");
  return chars.map((char, i) => {
    const colorIndex = Math.floor((i / chars.length) * gradientColors.length);
    return chalk.hex(gradientColors[colorIndex])(char);
  }).join("");
}

export function printWelcome(): void {
  console.log();
  console.log(chalk.hex("#4D96FF")("  ╭─────────────────────────────────────────╮"));
  console.log(chalk.hex("#4D96FF")("  │") + "  " + gradient("✨ Cdoing Agent") + chalk.hex("#9B5DE5")(` v${VERSION}`) + "               " + chalk.hex("#4D96FF")("│"));
  console.log(chalk.hex("#4D96FF")("  │") + chalk.hex("#B0BEC5")("     AI-Powered Coding Assistant       ") + chalk.hex("#4D96FF")("│"));
  console.log(chalk.hex("#4D96FF")("  ╰─────────────────────────────────────────╯"));
  console.log();
  console.log(chalk.hex("#90A4AE")("  💬 Type your message and press ") + chalk.hex("#FFD93D")("Enter") + chalk.hex("#90A4AE")(" to chat"));
  console.log(chalk.hex("#90A4AE")("  ❓ Type ") + chalk.hex("#FF6B6B")("?") + chalk.hex("#90A4AE")(" for help, ") + chalk.hex("#6BCB77")("!cmd") + chalk.hex("#90A4AE")(" to run commands"));
  console.log();
}

export function printHelp(): void {
  console.log();

  // Shortcuts section
  console.log(chalk.hex("#FF6B6B").bold("  ⌨️  Shortcuts"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  console.log(chalk.hex("#FFD93D")("    ?                    ") + chalk.hex("#B0BEC5")("Show this help"));
  console.log(chalk.hex("#FFD93D")("    ESC                  ") + chalk.hex("#B0BEC5")("Cancel current operation"));
  console.log(chalk.hex("#FFD93D")("    Ctrl+C               ") + chalk.hex("#B0BEC5")("Cancel / Exit"));
  console.log();

  // Commands section
  console.log(chalk.hex("#6BCB77").bold("  📝 Commands"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  const commands = [
    ["/help", "Show this help"],
    ["/new", "Start a new conversation"],
    ["/history", "List saved conversations"],
    ["/resume <id>", "Resume a saved conversation"],
    ["/delete <id>", "Delete a saved conversation"],
    ["/clear", "Clear current conversation"],
    ["/config", "Show current configuration"],
    ["/model <name>", "Switch model"],
    ["/provider <name>", "Switch provider"],
    ["/mode <mode>", "Change permission mode"],
    ["/permissions", "View/clear stored permissions"],
    ["/memory", "View/manage persistent memory"],
    ["/hooks", "View configured hooks"],
    ["/usage", "Show token usage and cost"],
    ["/compact", "Compress conversation context"],
    ["/cost", "Show detailed cost breakdown"],
    ["/tasks", "Show agent task list"],
    ["/queue", "Show message queue"],
    ["/doctor", "Check system health"],
    ["/init", "Initialize project config"],
    ["/dir <path>", "Change working directory"],
    ["/exit", "Exit"],
  ];
  for (const [cmd, desc] of commands) {
    console.log(chalk.hex("#4FC3F7")(`    ${cmd.padEnd(20)}`) + chalk.hex("#B0BEC5")(desc));
  }
  console.log();

  // Auth section
  console.log(chalk.hex("#9B5DE5").bold("  🔐 Authentication"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  console.log(chalk.hex("#BA68C8")("    /login               ") + chalk.hex("#B0BEC5")("Show authentication options"));
  console.log(chalk.hex("#BA68C8")("    /logout              ") + chalk.hex("#B0BEC5")("Clear stored tokens"));
  console.log(chalk.hex("#BA68C8")("    /auth-status         ") + chalk.hex("#B0BEC5")("Show current auth status"));
  console.log();

  // CLI Usage section
  console.log(chalk.hex("#4D96FF").bold("  💻 CLI Usage"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  const cliExamples = [
    ["cdoing", "Interactive mode"],
    ["cdoing \"fix the bug\"", "One-shot prompt"],
    ["cdoing --api-key sk-...", "Use API key directly"],
    ["cdoing -p openai -m gpt-4o", "Use OpenAI"],
    ["cdoing --mode auto", "Skip all permission prompts"],
    ["cdoing -d ./my-project", "Set working directory"],
  ];
  for (const [cmd, desc] of cliExamples) {
    console.log(chalk.hex("#64B5F6")(`    ${cmd.padEnd(30)}`) + chalk.hex("#90A4AE")(desc));
  }
  console.log();

  // Advanced Flags section
  console.log(chalk.hex("#FFA726").bold("  ⚙️  Advanced Flags"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  const advancedFlags = [
    ["--print \"prompt\"", "Non-interactive output"],
    ["-r <id> \"prompt\"", "Resume conversation by ID"],
    ["-c \"prompt\"", "Continue last conversation"],
    ["--max-turns 5", "Limit agent iterations"],
    ["--output-format json", "Output as JSON"],
    ["--verbose", "Enable debug logging"],
    ["--system-prompt \"...\"", "Custom system prompt"],
    ["--allowed-tools a,b", "Whitelist tools"],
    ["--disallowed-tools a,b", "Blacklist tools"],
  ];
  for (const [flag, desc] of advancedFlags) {
    console.log(chalk.hex("#FFB74D")(`    ${flag.padEnd(26)}`) + chalk.hex("#90A4AE")(desc));
  }
  console.log();

  // Subcommands section
  console.log(chalk.hex("#26A69A").bold("  🔧 Subcommands"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  const subcommands = [
    ["cdoing config list", "List config values"],
    ["cdoing config get <key>", "Get config value"],
    ["cdoing config set <k> <v>", "Set config value"],
    ["cdoing init", "Initialize .cdoing/config.md"],
    ["cdoing doctor", "Diagnose setup issues"],
  ];
  for (const [cmd, desc] of subcommands) {
    console.log(chalk.hex("#4DB6AC")(`    ${cmd.padEnd(26)}`) + chalk.hex("#90A4AE")(desc));
  }
  console.log();
}

export function printConfig(config: {
  provider: string;
  model: string;
  mode: string;
  dir: string;
}): void {
  console.log();
  console.log(chalk.hex("#4FC3F7").bold("  ⚙️  Current Configuration"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  console.log(chalk.hex("#81C784")("    Provider    ") + chalk.hex("#78909C")("│ ") + chalk.hex("#FFFFFF")(config.provider));
  console.log(chalk.hex("#FFB74D")("    Model       ") + chalk.hex("#78909C")("│ ") + chalk.hex("#FFFFFF")(config.model || "(default)"));
  console.log(chalk.hex("#BA68C8")("    Mode        ") + chalk.hex("#78909C")("│ ") + chalk.hex("#FFFFFF")(config.mode));
  console.log(chalk.hex("#4FC3F7")("    Directory   ") + chalk.hex("#78909C")("│ ") + chalk.hex("#FFFFFF")(config.dir));
  console.log();
}
