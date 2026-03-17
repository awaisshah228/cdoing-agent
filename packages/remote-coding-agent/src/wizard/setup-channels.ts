/**
 * Channel Setup Module — Configure messaging channels.
 *
 * Handles:
 *   - Telegram bot token
 *   - Environment variable detection
 *   - QuickStart defaults (skip prompts)
 */

import type { WizardPrompter } from "./prompts";
import type { WizardFlow } from "./setup-types";

export interface ChannelSetupResult {
  telegramEnabled: boolean;
  telegramToken?: string;
}

export async function setupChannels(
  prompter: WizardPrompter,
  opts: { flow: WizardFlow; skipChannels?: boolean },
): Promise<ChannelSetupResult> {
  if (opts.skipChannels) {
    await prompter.note("Skipping channel setup.", "Channels");
    return {
      telegramEnabled: false,
    };
  }

  await prompter.note(
    "Configure how you'll communicate with your agent.\nYou can add more channels later via the dashboard.",
    "Channels",
  );

  // ── Telegram ──

  const telegramEnabled = await prompter.confirm({
    message: "Enable Telegram channel?",
    initialValue: true,
  });

  let telegramToken: string | undefined;
  if (telegramEnabled) {
    const envToken = process.env.TELEGRAM_BOT_TOKEN;
    if (envToken) {
      await prompter.note("Found TELEGRAM_BOT_TOKEN in environment.");
    } else {
      telegramToken = await prompter.text({
        message: "Telegram bot token (from @BotFather)",
        placeholder: "Enter token or press Enter to skip",
      });
      if (!telegramToken) {
        await prompter.note(
          "No token provided. Set TELEGRAM_BOT_TOKEN env var before starting.",
          "Warning",
        );
      }
    }
  }

  return {
    telegramEnabled,
    telegramToken,
  };
}
