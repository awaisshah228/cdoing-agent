/**
 * Agent Callbacks — formatted console output for interactive and one-shot modes.
 */

import chalk from "chalk";
import type { Ora } from "ora";
import type { AgentCallbacks } from "@cdoing/ai";

/** Interactive mode: spinner + colors */
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
      // Stop spinner so permission prompt can read stdin
      spinner.stop();
      const preview = JSON.stringify(input).substring(0, 80);
      console.log(chalk.yellow(`\n  ⚡ ${name}`) + chalk.dim(` ${preview}`));
    },

    onToolResult: (name, result, isError) => {
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

/** One-shot mode: minimal output */
export function createOneShotCallbacks(): AgentCallbacks {
  return {
    onToken: (token) => process.stdout.write(token),
    onToolCall: (name) => console.log(chalk.yellow(`\n⚡ ${name}`)),
    onToolResult: (name, _r, isErr) => console.log(isErr ? chalk.red(`✗ ${name}`) : chalk.green(`✓ ${name}`)),
    onComplete: () => console.log(),
    onError: (err) => console.error(chalk.red(`Error: ${err.message}`)),
  };
}
