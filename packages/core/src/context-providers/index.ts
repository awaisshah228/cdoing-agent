/**
 * Context Providers — Pluggable system for injecting context into chat messages.
 *
 * Each provider implements a simple interface:
 *   - id: unique name (e.g., "terminal", "open", "url")
 *   - trigger: the @ keyword that activates it (e.g., "@terminal")
 *   - resolve(): fetches and returns the context content
 *
 * This module re-exports all built-in context providers and the
 * registry that manages them.
 *
 * Learning note: This follows the Strategy Pattern — each provider
 * encapsulates a different way to gather context, and the registry
 * lets you swap/add providers without modifying consuming code.
 */

export { ContextProviderRegistry } from "./registry";
export type { ContextProvider, ContextResult } from "./types";
export { TerminalContextProvider } from "./terminal";
export { OpenFilesContextProvider } from "./open-files";
export { UrlContextProvider } from "./url";
export { TreeContextProvider } from "./tree";
export { ProblemsContextProvider } from "./problems";
export { CodebaseContextProvider } from "./codebase";
