/**
 * CLI Subcommand Handlers
 *
 * Handlers for: cdoing config, cdoing init, cdoing doctor
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";
import figlet from "figlet";
import { loadConfig, saveConfig, getStoredConfigDisplay, updateStoredConfig } from "./config";
import { getApiKeyEnvVar } from "@cdoing/ai";
import { CodebaseIndexer } from "@cdoing/core";

const CONFIG_DIR = path.join(os.homedir(), ".cdoing");
const PROJECT_CONFIG_DIR = ".cdoing";
const PROJECT_CONFIG_FILE = "config.md";

/**
 * Handle `cdoing config <action> [key] [value]`
 */
export function handleConfigCommand(action: string, key?: string, value?: string): void {
  switch (action) {
    case "list":
      console.log();
      console.log(chalk.hex("#4FC3F7").bold("  ⚙️  Stored Config"));
      console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
      for (const line of getStoredConfigDisplay()) {
        console.log(chalk.hex("#B0BEC5")(`  ${line}`));
      }
      console.log();
      break;

    case "get":
      if (!key) {
        console.log(chalk.hex("#EF5350")("\n  ❌ Usage: cdoing config get <key>"));
        console.log(chalk.hex("#78909C")("     Keys: provider, model, mode, api-key, base-url\n"));
        return;
      }
      const config = loadConfig();
      let val: string | undefined;
      switch (key) {
        case "provider": val = config.provider; break;
        case "model": val = config.model; break;
        case "mode": val = config.mode; break;
        case "base-url": val = config.baseUrl; break;
        case "api-key":
          const provider = config.provider || "anthropic";
          val = config.apiKeys?.[provider];
          if (val) val = val.slice(0, 8) + "..." + val.slice(-4);
          break;
        default:
          console.log(chalk.hex("#EF5350")(`\n  ❌ Unknown key: ${key}\n`));
          return;
      }
      console.log(val ? chalk.hex("#81C784")(val) : chalk.hex("#78909C")("(not set)"));
      break;

    case "set":
      if (!key || value === undefined) {
        console.log(chalk.hex("#EF5350")("\n  ❌ Usage: cdoing config set <key> <value>"));
        console.log(chalk.hex("#78909C")("     Keys: provider, model, mode, api-key, base-url\n"));
        return;
      }
      const result = updateStoredConfig(key, value);
      if (result.success) {
        const display = key === "api-key" ? value.slice(0, 8) + "..." : value;
        console.log();
        console.log(chalk.hex("#81C784")("  ✓ Saved: ") + chalk.hex("#4FC3F7")(key) + chalk.hex("#78909C")(" = ") + chalk.hex("#FFFFFF")(display));
        console.log();
      } else {
        console.log(chalk.hex("#EF5350")(`\n  ❌ ${result.error}\n`));
      }
      break;

    default:
      console.log(chalk.hex("#EF5350")(`\n  ❌ Unknown action: ${action}`));
      console.log(chalk.hex("#78909C")("     Usage: cdoing config <list|get|set> [key] [value]\n"));
  }
}

/**
 * Handle `cdoing init` - create .cdoing/ directory and config.md template
 */
export function handleInit(): void {
  const cwd = process.cwd();
  const configDir = path.join(cwd, PROJECT_CONFIG_DIR);
  const configFile = path.join(configDir, PROJECT_CONFIG_FILE);

  if (fs.existsSync(configFile)) {
    console.log();
    console.log(chalk.hex("#FFB74D")("  ⚠️  Project already initialized"));
    console.log(chalk.hex("#90A4AE")("     .cdoing/config.md exists"));
    console.log();
    return;
  }

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const template = `# Project Configuration

This file configures cdoing for this project.

## Instructions

Add project-specific instructions here. The agent will follow these guidelines.

\`\`\`
- Use TypeScript for all new code
- Follow existing code patterns
- Write tests for new features
\`\`\`

## Context

Describe your project here:
- What does this project do?
- What technologies does it use?
- Any special conventions?

## Files to Ignore

Files the agent should not modify:
- node_modules/
- dist/
- .env

## Preferred Tools

- Use npm for package management
- Use vitest for testing
`;

  fs.writeFileSync(configFile, template, "utf-8");
  console.log();
  console.log(chalk.hex("#6BCB77")(figlet.textSync("Init!", { font: "Small" })));
  console.log(chalk.hex("#81C784")("  ✨ Project initialized!"));
  console.log(chalk.hex("#90A4AE")("     Created: ") + chalk.hex("#4FC3F7")(".cdoing/config.md"));
  console.log();
  console.log(chalk.hex("#78909C")("  Edit this file to customize agent behavior for your project."));
  console.log();
}

// ── Shell completion scripts ──────────────────────────────────────────────────

const ZSH_COMPLETION = `#compdef cdoing
# Zsh completion for cdoing — install with: cdoing completions zsh > ~/.zsh/completions/_cdoing
# Then add to ~/.zshrc:  fpath=(~/.zsh/completions $fpath) && autoload -Uz compinit && compinit

_cdoing() {
  local context state line
  typeset -A opt_args

  _arguments -C \\
    '(-m --model)'{-m,--model}'[Model to use]:model:->models' \\
    '(-p --provider)'{-p,--provider}'[AI provider]:provider:(anthropic openai google ollama custom)' \\
    '--base-url[Base URL for custom providers]:url:' \\
    '--api-key[API key]:key:' \\
    '--mode[Permission mode]:mode:(ask auto-edit auto)' \\
    '(-d --dir)'{-d,--dir}'[Working directory]:directory:_directories' \\
    '--login[Login with Claude via OAuth]' \\
    '--logout[Clear stored OAuth tokens]' \\
    '--print[Print output only]' \\
    '(-r --resume)'{-r,--resume}'[Resume conversation by ID]:id:' \\
    '(-c --continue)'{-c,--continue}'[Continue most recent conversation]' \\
    '--max-turns[Maximum agent turns]:turns:' \\
    '--output-format[Output format]:format:(text json stream-json)' \\
    '--verbose[Enable verbose logging]' \\
    '--system-prompt[Custom system prompt]:prompt:' \\
    '--allowed-tools[Comma-separated allowed tools]:tools:' \\
    '--disallowed-tools[Comma-separated disallowed tools]:tools:' \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-V --version)'{-V,--version}'[Show version]' \\
    '1: :->subcmd' \\
    '*:: :->args'

  case $state in
    subcmd)
      local -a cmds
      cmds=(
        'config:Manage configuration'
        'init:Initialize project with .cdoing/config.md'
        'doctor:Diagnose setup and configuration'
        'completions:Generate shell completion script'
        'index:Index codebase for fast search'
      )
      _describe 'subcommand' cmds
      ;;
    models)
      local -a models
      models=(
        'claude-sonnet-4-6:Anthropic Sonnet 4.6'
        'claude-opus-4-6:Anthropic Opus 4.6'
        'claude-haiku-4-5:Anthropic Haiku 4.5'
        'gpt-4o:OpenAI GPT-4o'
        'gpt-4o-mini:OpenAI GPT-4o Mini'
        'o3-mini:OpenAI o3 Mini'
        'gemini-2.0-flash:Google Gemini 2.0 Flash'
        'gemini-1.5-pro:Google Gemini 1.5 Pro'
        'llama3.1:Ollama LLaMA 3.1'
        'mistral:Ollama Mistral'
        'codellama:Ollama CodeLlama'
      )
      _describe 'model' models
      ;;
    args)
      case $words[1] in
        config)
          _arguments \\
            '1:action:(get set list)' \\
            '2:key:(provider model mode api-key base-url)' \\
            '3:value:'
          ;;
        completions)
          _arguments '1:shell:(zsh bash)'
          ;;
      esac
      ;;
  esac
}

_cdoing "$@"
`;

const BASH_COMPLETION = `# Bash completion for cdoing — install with: cdoing completions bash > ~/.bash_completion.d/cdoing
# Then add to ~/.bashrc:  source ~/.bash_completion.d/cdoing

_cdoing_completion() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  }

  local subcommands="config init doctor completions index"
  local flags="--model --provider --base-url --api-key --mode --dir --login --logout --print --resume --continue --max-turns --output-format --verbose --system-prompt --allowed-tools --disallowed-tools --help --version"
  local models="claude-sonnet-4-6 claude-opus-4-6 claude-haiku-4-5 gpt-4o gpt-4o-mini o3-mini gemini-2.0-flash gemini-1.5-pro llama3.1 mistral codellama"

  case "\${prev}" in
    --model|-m)
      COMPREPLY=( \$(compgen -W "\${models}" -- "\${cur}") )
      return ;;
    --provider|-p)
      COMPREPLY=( \$(compgen -W "anthropic openai google ollama custom" -- "\${cur}") )
      return ;;
    --mode)
      COMPREPLY=( \$(compgen -W "ask auto-edit auto" -- "\${cur}") )
      return ;;
    --output-format)
      COMPREPLY=( \$(compgen -W "text json stream-json" -- "\${cur}") )
      return ;;
    --dir|-d)
      COMPREPLY=( \$(compgen -d -- "\${cur}") )
      return ;;
    config)
      COMPREPLY=( \$(compgen -W "get set list" -- "\${cur}") )
      return ;;
    get|set)
      COMPREPLY=( \$(compgen -W "provider model mode api-key base-url" -- "\${cur}") )
      return ;;
    completions)
      COMPREPLY=( \$(compgen -W "zsh bash" -- "\${cur}") )
      return ;;
  esac

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( \$(compgen -W "\${flags}" -- "\${cur}") )
    return
  fi

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "\${subcommands}" -- "\${cur}") )
    return
  fi
}

complete -F _cdoing_completion cdoing
`;

/**
 * Handle `cdoing completions <shell>` - print shell completion script
 */
export function handleCompletions(shell: string): void {
  const s = (shell || "").toLowerCase();

  if (s === "zsh") {
    process.stdout.write(ZSH_COMPLETION);
    return;
  }

  if (s === "bash") {
    process.stdout.write(BASH_COMPLETION);
    return;
  }

  // No shell arg — print install instructions
  console.log();
  console.log(chalk.hex("#4FC3F7").bold("  🐚  Shell Completions"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  console.log();
  console.log(chalk.hex("#B0BEC5")("  Usage:  cdoing completions <shell>"));
  console.log(chalk.hex("#78909C")("  Shells: zsh  bash"));
  console.log();
  console.log(chalk.hex("#FFB74D").bold("  Zsh:"));
  console.log(chalk.hex("#90A4AE")("    mkdir -p ~/.zsh/completions"));
  console.log(chalk.hex("#81C784")("    cdoing completions zsh > ~/.zsh/completions/_cdoing"));
  console.log(chalk.hex("#90A4AE")("    # Add to ~/.zshrc if not already present:"));
  console.log(chalk.hex("#90A4AE")('    echo \'fpath=(~/.zsh/completions $fpath)\' >> ~/.zshrc'));
  console.log(chalk.hex("#90A4AE")('    echo "autoload -Uz compinit && compinit" >> ~/.zshrc'));
  console.log(chalk.hex("#90A4AE")("    source ~/.zshrc"));
  console.log();
  console.log(chalk.hex("#FFB74D").bold("  Bash:"));
  console.log(chalk.hex("#90A4AE")("    mkdir -p ~/.bash_completion.d"));
  console.log(chalk.hex("#81C784")("    cdoing completions bash > ~/.bash_completion.d/cdoing"));
  console.log(chalk.hex("#90A4AE")('    echo "source ~/.bash_completion.d/cdoing" >> ~/.bashrc'));
  console.log(chalk.hex("#90A4AE")("    source ~/.bashrc"));
  console.log();
}

/**
 * Handle `cdoing doctor` - diagnose setup and configuration issues
 */
export function handleDoctor(): void {
  console.log();
  console.log(chalk.hex("#4FC3F7").bold("  🏥 System Diagnostics"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  console.log();

  let issues = 0;
  let passed = 0;

  const ok = (msg: string) => {
    passed++;
    console.log(chalk.hex("#81C784")("  ✓ ") + chalk.hex("#B0BEC5")(msg));
  };
  const skip = (msg: string) => {
    console.log(chalk.hex("#78909C")("  ○ ") + chalk.hex("#78909C")(msg));
  };
  const fail = (msg: string) => {
    issues++;
    console.log(chalk.hex("#EF5350")("  ✗ ") + chalk.hex("#FFCDD2")(msg));
  };

  // Check global config directory
  if (fs.existsSync(CONFIG_DIR)) {
    ok("Global config: ~/.cdoing/");
  } else {
    skip("Global config: not created yet");
  }

  // Check API keys
  const config = loadConfig();
  const providers = ["anthropic", "openai", "google"];
  const providerIcons: Record<string, string> = {
    anthropic: "🤖",
    openai: "🧠",
    google: "🌐",
  };

  for (const provider of providers) {
    const envVar = getApiKeyEnvVar(provider);
    const hasEnv = !!process.env[envVar];
    const hasStored = !!config.apiKeys?.[provider];
    const icon = providerIcons[provider] || "🔑";

    if (hasEnv) {
      ok(`${icon} ${provider}: API key in ${envVar}`);
    } else if (hasStored) {
      ok(`${icon} ${provider}: API key in config`);
    } else {
      skip(`${icon} ${provider}: no API key configured`);
    }
  }

  // Check project config
  const projectConfig = path.join(process.cwd(), PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
  if (fs.existsSync(projectConfig)) {
    ok("📁 Project config: .cdoing/config.md");
  } else {
    skip("📁 Project config: not initialized (run: cdoing init)");
  }

  // Check hooks
  const globalHooks = path.join(CONFIG_DIR, "hooks.json");
  const projectHooks = path.join(process.cwd(), PROJECT_CONFIG_DIR, "hooks.json");

  if (fs.existsSync(globalHooks)) {
    ok("🪝 Global hooks: ~/.cdoing/hooks.json");
  }
  if (fs.existsSync(projectHooks)) {
    ok("🪝 Project hooks: .cdoing/hooks.json");
  }

  // Check permissions
  const globalPerms = path.join(CONFIG_DIR, "permissions.json");
  const projectPerms = path.join(process.cwd(), PROJECT_CONFIG_DIR, "permissions.json");

  if (fs.existsSync(globalPerms)) {
    ok("🔐 Global permissions: ~/.cdoing/permissions.json");
  }
  if (fs.existsSync(projectPerms)) {
    ok("🔐 Project permissions: .cdoing/permissions.json");
  }

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major >= 18) {
    ok(`📦 Node.js: ${nodeVersion}`);
  } else {
    fail(`📦 Node.js: ${nodeVersion} (requires 18+)`);
  }

  // Summary
  console.log();
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  if (issues === 0) {
    console.log(chalk.hex("#81C784").bold(`  ✨ All ${passed} checks passed!`));
  } else {
    console.log(chalk.hex("#FFB74D")(`  ⚠️  ${passed} passed, ${issues} issue(s) found`));
  }
  console.log();
}

/**
 * Handle `cdoing index` — index the codebase for fast FTS search.
 */
export async function handleIndex(options: { full?: boolean; dir?: string; stats?: boolean }): Promise<void> {
  const workingDir = path.resolve(options.dir || process.cwd());

  console.log();
  console.log(chalk.hex("#4FC3F7").bold("  📇 Codebase Indexer"));
  console.log(chalk.hex("#78909C")("  ─────────────────────────────────────"));
  console.log(chalk.hex("#90A4AE")(`  Directory: ${workingDir}`));
  console.log();

  const indexer = new CodebaseIndexer(workingDir);

  // --stats: just show statistics
  if (options.stats) {
    const stats = indexer.getStats();
    console.log(chalk.hex("#B0BEC5")(`  Files indexed:    ${stats.totalFiles}`));
    console.log(chalk.hex("#B0BEC5")(`  Total chunks:     ${stats.totalChunks}`));
    console.log(chalk.hex("#B0BEC5")(`  FTS entries:      ${stats.ftsEntries}`));
    console.log(chalk.hex("#B0BEC5")(`  Embeddings:       ${stats.embeddingEntries}`));
    console.log(chalk.hex("#B0BEC5")(`  Index size:       ${(stats.indexSizeBytes / 1024).toFixed(1)} KB`));
    if (stats.lastIndexed > 0) {
      const ago = Math.round((Date.now() - stats.lastIndexed) / 60000);
      console.log(chalk.hex("#B0BEC5")(`  Last indexed:     ${ago} min ago`));
    } else {
      console.log(chalk.hex("#78909C")(`  Last indexed:     never`));
    }
    console.log();
    indexer.close();
    return;
  }

  // --full: clear existing index first
  if (options.full) {
    console.log(chalk.hex("#FFB74D")("  Clearing existing index..."));
    indexer.clearIndex();
  }

  // Run indexing with progress
  const result = await indexer.index((progress) => {
    const bar = progress.total > 0
      ? ` [${progress.current}/${progress.total}]`
      : "";
    process.stdout.write(`\r  ${chalk.hex("#78909C")(progress.phase)}${bar} ${chalk.hex("#90A4AE")(progress.message)}          `);
  });

  process.stdout.write("\r" + " ".repeat(80) + "\r"); // clear progress line

  console.log(chalk.hex("#81C784")(`  ✓ Added:    ${result.added} files`));
  console.log(chalk.hex("#4FC3F7")(`  ✓ Updated:  ${result.updated} files`));
  console.log(chalk.hex("#EF5350")(`  ✓ Deleted:  ${result.deleted} files`));
  console.log(chalk.hex("#B0BEC5")(`  ✓ Chunks:   ${result.totalChunks} total`));

  const stats = indexer.getStats();
  console.log(chalk.hex("#78909C")(`  Index size: ${(stats.indexSizeBytes / 1024).toFixed(1)} KB`));
  console.log();

  indexer.close();
}
