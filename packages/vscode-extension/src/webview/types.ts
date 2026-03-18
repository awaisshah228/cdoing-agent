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
  | { type: "toolCall"; name: string; input: string; description?: string } // Agent is invoking a tool
  | { type: "toolProgress"; name: string; chunk: string }                // Streaming tool output (e.g. shell_exec)
  | { type: "toolResult"; name: string; result: string; isError: boolean } // Tool finished
  | { type: "endResponse" }                                            // Agent done, no more tokens
  | { type: "finalizeStreaming" }                                        // Finalize current streaming message so next tokens start a new message
  | { type: "error"; text: string }                                    // Something went wrong
  | { type: "systemMessage"; text: string }                            // System info (e.g. /help output)
  | { type: "usageInfo"; text: string }                                // Token usage info after each turn
  | { type: "clear" }                                                  // Clear all messages
  | { type: "configUpdated"; provider: string; model: string }         // Model/provider changed
  | { type: "insertMessage"; message: string }                         // Insert text into the input box
  | { type: "contextAttached"; attachment: ContextAttachment }          // File/folder picked and attached
  | { type: "fileSearchResults"; results: Array<{ path: string; isDir: boolean; language?: string }> } // File search results for @ autocomplete
  | { type: "configData"; config: ExtensionConfig }                      // Full config for settings panel
  | { type: "conversationList"; conversations: ConversationSummary[] }   // Past conversations list
  | { type: "conversationMessages"; id: string; messages: Array<{ role: string; content: string }> } // Messages for a resumed conversation
  | { type: "tabCreated"; tabId: string; title: string }               // New tab created
  | { type: "tabSwitched"; tabId: string; isProcessing?: boolean }      // Switched to a tab
  | { type: "tabClosed"; tabId: string }                               // Tab closed
  | { type: "tabTitleUpdated"; tabId: string; title: string }          // Tab title changed
  | { type: "permissionRequest"; id: string; toolName: string; message: string; hasProject: boolean } // Permission prompt
  | { type: "oauthStatus"; status: "none" | "active" | "expired"; expiresAt?: number }  // OAuth status update
  | { type: "oauthStarted"; url: string }                                                // OAuth flow started, browser opened
  | { type: "oauthResult"; success: boolean; error?: string }                            // OAuth exchange result
  | { type: "modeChanged"; mode: string }                                                // Permission mode changed (plan, ask, auto, etc.)
  | { type: "planReady"; summary: string; filePath?: string };                             // Plan complete, waiting for user approval

// ─── Messages FROM webview TO extension host ───

/**
 * All possible messages the React webview can send to the extension host.
 * Sent via vscode.postMessage().
 */
export type OutgoingMessage =
  | { type: "sendMessage"; text: string; tabId?: string; context?: ContextAttachment[] } // User sent a chat message with optional context
  | { type: "command"; command: string; args?: string[] }    // Slash command (e.g. /clear)
  | { type: "switchTab"; tabId: string }                     // Switch to a tab
  | { type: "newTab" }                                       // Create a new tab
  | { type: "closeTab"; tabId: string }                      // Close a tab
  | { type: "pickFile" }                                     // Request file picker
  | { type: "pickFolder" }                                   // Request folder picker
  | { type: "searchFiles"; query: string }                   // Search workspace files for @ autocomplete
  | { type: "getActiveFile" }                                // Request active file as context
  | { type: "getConfig" }                                    // Request current config for settings panel
  | { type: "updateConfig"; config: Partial<ExtensionConfig> } // Update config from settings panel
  | { type: "openVscodeSettings" }                           // Open VS Code extension settings
  | { type: "listHistory" }                                  // Request conversation history list
  | { type: "resumeConversation"; id: string }               // Resume a past conversation
  | { type: "deleteConversation"; id: string }               // Delete a past conversation
  | { type: "cancelGeneration" }                             // Cancel the current streaming response
  | { type: "interruptGeneration"; tabId?: string; partialResponse?: string; newMessage?: string } // Interrupt streaming + send new message
  | { type: "permissionResponse"; id: string; decision: string } // Permission decision from user
  | { type: "startOAuth" }                                     // Start OAuth login flow
  | { type: "exchangeOAuth"; code: string }                    // Exchange OAuth authorization code
  | { type: "oauthLogout" }                                    // Clear OAuth tokens
  | { type: "getOAuthStatus" }                                 // Request OAuth status
  | { type: "ready" };                                       // Webview loaded, ready for data

/** Extension configuration (for in-panel settings) */
export interface ExtensionConfig {
  provider: string;
  model: string;
  customProviderName: string;
  customBaseURL: string;
  apiKey: string;
  /** Auth method for Anthropic: "apiKey" or "oauth" */
  authMethod?: string;
  temperature: number;
  maxTokens: number;
  permissionMode: string;
  sandboxEnabled?: boolean;
  sandboxMode?: string;
  /** Indexer settings */
  indexerEmbeddingModel?: string;
  indexerEmbeddingProvider?: string;
  indexerEmbeddingBaseUrl?: string;
  indexerAutoIndex?: boolean;
}

/** A saved conversation summary (for history view) */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  msgCount: number;
}

/** A file/folder/selection/image attached as context */
export interface ContextAttachment {
  type: "file" | "folder" | "selection" | "image";
  path: string;
  language?: string;
  content?: string;        // File content (filled by extension host)
  startLine?: number;
  endLine?: number;
  /** Base64-encoded image data (for type: "image") */
  base64?: string;
  /** MIME type for images (e.g. "image/png") */
  mimeType?: string;
}

// ─── UI Data Types ───

/** A chat message displayed in the message list */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  /** Attached context (files, folders, selections, images) — rendered as chips in user messages */
  context?: ContextAttachment[];
}

/** A tool step — merged call + result in a single entry */
export interface ToolCallEntry {
  id: string;
  kind: "call" | "result";   // "call" = running, "result" = completed
  name: string;               // Tool name (e.g. "file_read", "shell_exec")
  input: string;              // JSON input args
  output: string;             // Result output (empty while running)
  isError?: boolean;           // True if the tool failed
  description?: string;       // Brief description of what the tool is doing
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
