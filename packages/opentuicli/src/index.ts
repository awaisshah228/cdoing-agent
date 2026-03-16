/**
 * cdoing-tui — OpenTUI-based terminal interface for cdoing agent
 *
 * This is the advanced TUI (like opencode) using @opentui/react for
 * a rich, interactive terminal experience with:
 *   - Split panes (chat + file preview)
 *   - Dialog system (model picker, session list, command palette)
 *   - Theme support
 *   - Keyboard-driven navigation
 *
 * The existing @cdoing/cli uses Ink (React) for a simpler TUI.
 * This package provides the opencode-style experience.
 */

import { Command } from "commander";
import { getDefaultModel, getRegisteredProviders } from "@cdoing/ai";

const program = new Command();

program
  .name("cdoing-tui")
  .description("OpenTUI-based terminal interface for cdoing agent")
  .version("0.1.0")
  .option("-m, --model <model>", "Model name")
  .option("-p, --provider <provider>", "AI provider", "anthropic")
  .option("--api-key <key>", "API key")
  .option("--base-url <url>", "Base URL for custom providers")
  .option("-d, --dir <directory>", "Working directory", process.cwd())
  .option("--mode <mode>", "Permission mode: ask, auto-edit, auto", "ask")
  .option("-r, --resume <id>", "Resume conversation by ID")
  .option("-c, --continue", "Continue most recent conversation")
  .option("--theme <theme>", "Theme: dark, light, auto", "dark")
  .argument("[prompt]", "Initial prompt")
  .action(async (prompt, opts) => {
    const { startTUI } = await import("./app");
    await startTUI({
      prompt,
      provider: opts.provider,
      model: opts.model || getDefaultModel(opts.provider),
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      workingDir: opts.dir,
      mode: opts.mode,
      resume: opts.resume,
      continue: opts.continue,
      theme: opts.theme,
    });
  });

program.parse();
