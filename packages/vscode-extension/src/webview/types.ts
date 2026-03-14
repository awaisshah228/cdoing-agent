/**
 * types.ts — Message Protocol & Data Types
 *
 * Defines the contract between the React webview and the extension host.
 * All communication happens via JSON messages through postMessage().
 *
 * Two directions:
 *   IncomingMessage  = extension host → webview  (tokens, tool results, errors)
 *   OutgoingMessage  = webview → extension host   (user messages, commands)
 */

// ─── Messages FROM extension host TO webview ───

/**
 * All possible messages the extension host can send to the React webview.
 * The webview listens for these via window.addEventListener("message", ...).
 */
export type IncomingMessage =
  | { type: "startResponse" }                                          // Agent started processing
  | { type: "token"; text: string }                                    // One streamed token from the LLM
  | { type: "toolCall"; name: string; input: string }                  // Agent is invoking a tool
  | { type: "toolResult"; name: string; result: string; isError: boolean } // Tool finished
  | { type: "endResponse" }                                            // Agent done, no more tokens
  | { type: "error"; text: string }                                    // Something went wrong
  | { type: "systemMessage"; text: string }                            // System info (e.g. /help output)
  | { type: "usageInfo"; text: string }                                // Token usage info after each turn
  | { type: "clear" }                                                  // Clear all messages
  | { type: "configUpdated"; provider: string; model: string }         // Model/provider changed
  | { type: "insertMessage"; message: string };                        // Insert text into the input box

// ─── Messages FROM webview TO extension host ───

/**
 * All possible messages the React webview can send to the extension host.
 * Sent via vscode.postMessage().
 */
export type OutgoingMessage =
  | { type: "sendMessage"; text: string }                    // User sent a chat message
  | { type: "command"; command: string; args?: string[] }    // Slash command (e.g. /clear)
  | { type: "ready" };                                       // Webview loaded, ready for data

// ─── UI Data Types ───

/** A chat message displayed in the message list */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
}

/** A tool invocation or result displayed in the message list */
export interface ToolCallEntry {
  id: string;
  kind: "call" | "result";   // "call" = tool was invoked, "result" = tool returned
  name: string;               // Tool name (e.g. "file_read", "shell_exec")
  detail: string;             // Input args (for "call") or output (for "result")
  isError?: boolean;           // True if the tool failed
}

/** Union type — everything that can appear in the message list */
export type ChatEntry = ChatMessage | ToolCallEntry;

/** Type guard: checks if a ChatEntry is a ChatMessage (has a "role" field) */
export function isChatMessage(entry: ChatEntry): entry is ChatMessage {
  return "role" in entry;
}

/** Type guard: checks if a ChatEntry is a ToolCallEntry (has a "kind" field) */
export function isToolCallEntry(entry: ChatEntry): entry is ToolCallEntry {
  return "kind" in entry;
}

// ─── VS Code Webview API ───

/**
 * The VS Code API available inside the webview.
 * Acquired via acquireVsCodeApi() — can only be called once.
 */
export interface VsCodeApi {
  postMessage(message: OutgoingMessage): void;   // Send message to extension host
  getState(): any;                                // Get persisted webview state
  setState(state: any): void;                     // Persist state across webview reloads
}

/** Make acquireVsCodeApi() available globally (it's injected by VS Code into the webview) */
declare global {
  function acquireVsCodeApi(): VsCodeApi;
}
