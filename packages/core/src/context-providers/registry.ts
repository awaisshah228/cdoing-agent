/**
 * Context Provider Registry — Manages all available @ context providers.
 *
 * Responsibilities:
 *   1. Register/unregister providers
 *   2. Match user input (e.g., "@terminal") to the right provider
 *   3. Resolve context by delegating to the matched provider
 *
 * Learning note: This is a Service Locator pattern — it decouples
 * the chat input from specific provider implementations. You can
 * add new @ providers without touching the input handling code.
 */

import type { ContextProvider, ContextResult, ContextResolveOptions } from "./types";

export class ContextProviderRegistry {
  /** Map of provider ID → provider instance */
  private providers = new Map<string, ContextProvider>();

  /**
   * Register a new context provider.
   * Replaces any existing provider with the same ID.
   */
  register(provider: ContextProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Remove a provider by ID.
   */
  unregister(id: string): void {
    this.providers.delete(id);
  }

  /**
   * Get a provider by its ID.
   */
  get(id: string): ContextProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all registered providers (for autocomplete suggestions).
   */
  getAll(): ContextProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Match a trigger string (e.g., "@terminal", "@url https://...") to a provider.
   *
   * Returns the matched provider and any argument after the trigger,
   * or null if no provider matches.
   *
   * Learning note: This parsing is intentionally simple — we split on
   * the first space to separate trigger from argument.
   */
  match(input: string): { provider: ContextProvider; arg?: string } | null {
    // Input should start with @
    const trimmed = input.trim();
    if (!trimmed.startsWith("@")) return null;

    // Split into trigger and argument: "@url https://example.com" → ["@url", "https://example.com"]
    const spaceIndex = trimmed.indexOf(" ");
    const trigger = spaceIndex >= 0 ? trimmed.substring(0, spaceIndex) : trimmed;
    const arg = spaceIndex >= 0 ? trimmed.substring(spaceIndex + 1).trim() : undefined;

    // Find a provider whose trigger matches
    for (const provider of this.providers.values()) {
      if (provider.trigger === trigger) {
        return { provider, arg };
      }
    }

    return null;
  }

  /**
   * Resolve context from a trigger string.
   * Convenience method that combines match() + resolve().
   */
  async resolve(input: string, options?: ContextResolveOptions): Promise<ContextResult | null> {
    const match = this.match(input);
    if (!match) return null;

    return match.provider.resolve(match.arg, options);
  }

  /**
   * Get autocomplete suggestions for a partial @ input.
   * E.g., "@ter" → ["@terminal"]
   */
  getSuggestions(partial: string): Array<{ trigger: string; description: string }> {
    const query = partial.toLowerCase();
    return this.getAll()
      .filter((p) => p.trigger.toLowerCase().startsWith(query))
      .map((p) => ({ trigger: p.trigger, description: p.description }));
  }
}
