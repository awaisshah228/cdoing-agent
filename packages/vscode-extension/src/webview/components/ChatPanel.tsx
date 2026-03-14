/**
 * ChatPanel.tsx — Root Component
 *
 * The top-level component that assembles the entire chat UI.
 * Pulls all state from the useChatState() hook and passes it down to child components.
 *
 * Layout:
 *   ┌─────────────────────┐
 *   │  Header              │  ← Model badge, New Chat, Settings buttons
 *   ├─────────────────────┤
 *   │                     │
 *   │  MessageList         │  ← Messages, tool calls, or Welcome screen
 *   │                     │
 *   ├─────────────────────┤
 *   │  InputArea           │  ← Textarea + Send button
 *   └─────────────────────┘
 */

import React from "react";
import { Header } from "./Header";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { useChatState } from "../hooks/useChatState";

export const ChatPanel: React.FC = () => {
  const {
    entries,       // All chat entries (messages + tool calls)
    isProcessing,  // Is the agent currently working?
    modelLabel,    // Current model name for the header badge
    sendMessage,   // Send a user message to the agent
    sendCommand,   // Send a slash command (e.g. /model, /clear)
  } = useChatState();

  return (
    <div className="chat-container">
      {/* Header with model badge and action buttons */}
      <Header
        modelLabel={modelLabel}
        onSelectModel={() => sendCommand("/model")}
        onNewChat={() => sendCommand("/clear")}
        onOpenSettings={() => sendCommand("/settings")}
      />

      {/* Message list — shows Welcome screen when empty */}
      <MessageList
        entries={entries}
        isProcessing={isProcessing}
        onQuickAction={sendMessage}
      />

      {/* Input area at the bottom — textarea + send button */}
      <InputArea isProcessing={isProcessing} onSend={sendMessage} />
    </div>
  );
};
