/**
 * Agent Callbacks
 *
 * Provides formatted console output callbacks for both
 * interactive and one-shot modes of the CLI.
 */

import chalk from "chalk";
import ora, { type Ora } from "ora";
import type { AgentCallbacks } from "@cdoing/ai";

/**
 * Create callbacks for interactive mode with spinner and colored output.
 * Used by ChatInterface during the REPL loop.
 */
export function createInteractiveCallbacks(spinner: Ora): AgentCallbacks {
  let isFirstToken = true;

  return {
    onToken: (token) => {
      if (isFirstToken) {
        spinner.stop();
        process.stdout.write(chalk.cyan("  "));
        isFirstToken = false;
      }
      process.stdout.write(token);
    },

    onToolCall: (name, input) => {
      spinner.stop();
      const inputPreview = JSON.stringify(input).substring(0, 80);
      console.log(chalk.yellow(`\n  ⚡ ${name}`) + chalk.dim(` ${inputPreview}`));
      spinner.start(chalk.dim("  Executing..."));
    },

    onToolResult: (name, result, isError) => {
      spinner.stop();
      if (isError) {
        console.log(chalk.red(`  ✗ ${name} failed`));
      } else {
        const preview = result.substring(0, 120).replace(/\n/g, " ");
        console.log(chalk.green(`  ✓ ${name}`) + chalk.dim(` ${preview}`));
      }
      spinner.start(chalk.dim("  Thinking..."));
    },

    onComplete: () => {
      spinner.stop();
      console.log("\n");
    },

    onError: (error) => {
      spinner.stop();
      console.log(chalk.red(`\n  Error: ${error.message}\n`));
    },
  };
}

/**
 * Create callbacks for one-shot mode with minimal output.
 * Used when a prompt is passed directly via CLI argument.
 */
export function createOneShotCallbacks(): AgentCallbacks {
  return {
    onToken: (token) => process.stdout.write(token),

    onToolCall: (name) => {
      console.log(chalk.yellow(`\n⚡ ${name}`));
    },

    onToolResult: (name, _result, isError) => {
      console.log(isError ? chalk.red(`✗ ${name}`) : chalk.green(`✓ ${name}`));
    },

    onComplete: () => console.log(),

    onError: (error) => {
      console.error(chalk.red(`Error: ${error.message}`));
    },
  };
}
