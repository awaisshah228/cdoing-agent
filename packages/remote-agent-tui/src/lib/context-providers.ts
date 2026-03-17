/**
 * Context Provider Expansion — resolves @mentions in user messages
 *
 * Detects @terminal, @url, @tree, @codebase, @clip, @file triggers
 * and expands them into actual content before sending to the agent.
 *
 * This makes the personal assistant's TUI input as powerful as the
 * main cdoing CLI — users can attach context to any message.
 */

import {
  ContextProviderRegistry,
  TerminalContextProvider,
  UrlContextProvider,
  TreeContextProvider,
  CodebaseContextProvider,
  ClipboardContextProvider,
  FileIncludeContextProvider,
} from "@cdoing/core";

let registry: ContextProviderRegistry | null = null;
let terminalProvider: TerminalContextProvider | null = null;

function getRegistry(): ContextProviderRegistry {
  if (!registry) {
    registry = new ContextProviderRegistry();
    terminalProvider = new TerminalContextProvider();
    registry.register(terminalProvider);
    registry.register(new UrlContextProvider());
    registry.register(new TreeContextProvider());
    registry.register(new CodebaseContextProvider());
    registry.register(new ClipboardContextProvider());
    registry.register(new FileIncludeContextProvider());
  }
  return registry;
}

/** Update terminal provider with recent shell output */
export function pushTerminalOutput(output: string): void {
  getRegistry();
  if (terminalProvider && typeof (terminalProvider as any).push === "function") {
    (terminalProvider as any).push(output);
  }
}

/** Known @mention triggers */
const TRIGGERS = ["@terminal", "@url", "@tree", "@codebase", "@clip", "@file"];

/**
 * Resolve all @mention providers in a message.
 * Returns the expanded message with provider content appended.
 */
export async function resolveContextProviders(
  message: string,
  workingDir: string
): Promise<string> {
  const reg = getRegistry();
  let expandedMessage = message;
  const appendSections: string[] = [];

  for (const trigger of TRIGGERS) {
    const idx = expandedMessage.indexOf(trigger);
    if (idx === -1) continue;

    // Extract the trigger + argument
    const afterTrigger = expandedMessage.substring(idx + trigger.length);
    const endIdx = afterTrigger.search(/\s@|\n|$/);
    const arg = afterTrigger.substring(0, endIdx === -1 ? afterTrigger.length : endIdx).trim();

    // Remove trigger from message
    const fullTrigger = trigger + (arg ? " " + arg : "");
    expandedMessage = expandedMessage.replace(fullTrigger, "").trim();

    // Resolve
    const providerName = trigger.substring(1); // strip @
    const provider = reg.get(providerName);
    if (!provider) continue;

    try {
      const result = await provider.resolve(arg, { workingDir });
      if (result) {
        appendSections.push(`--- ${trigger} ---\n${result}`);
      }
    } catch {
      // Silently skip failed providers
    }
  }

  if (appendSections.length > 0) {
    expandedMessage = expandedMessage + "\n\n" + appendSections.join("\n\n");
  }

  return expandedMessage;
}

/**
 * Check if a message contains any @mention triggers.
 */
export function hasContextMentions(message: string): boolean {
  return TRIGGERS.some((t) => message.includes(t));
}
