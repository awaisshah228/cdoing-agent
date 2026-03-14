/**
 * ChatPanel.tsx — Root Component (Multi-Tab)
 *
 * Layout:
 *   ┌─────────────────────┐
 *   │  Header              │  ← Model badge, History, New Chat (+), Settings
 *   ├─────────────────────┤
 *   │  TabBar              │  ← Tabs (shown when 2+ tabs open)
 *   ├─────────────────────┤
 *   │  MessageList         │  ← Messages, tool calls, or Welcome
 *   ├─────────────────────┤
 *   │  InputArea           │  ← Textarea + Send/Queue button
 *   └─────────────────────┘
 *   │  ConversationHistory │  ← Overlay when history is open
 */

import React from "react";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { ConversationHistory } from "./ConversationHistory";
import { useChatState } from "../hooks/useChatState";

export const ChatPanel: React.FC = () => {
  const {
    tabs,
    activeTabId,
    createNewTab,
    switchToTab,
    closeTab,
    entries,
    isProcessing,
    queueCount,
    modelLabel,
    sendMessage,
    sendCommand,
    conversations,
    showHistory,
    openHistory,
    closeHistory,
    resumeConversation,
    deleteConversation,
  } = useChatState();

  return (
    <div className="chat-container">
      <Header
        modelLabel={modelLabel}
        onSelectModel={() => sendCommand("/model")}
        onNewChat={createNewTab}
        onOpenSettings={() => sendCommand("/settings")}
        onOpenHistory={openHistory}
      />

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={switchToTab}
        onNewTab={createNewTab}
        onCloseTab={closeTab}
      />

      <MessageList
        entries={entries}
        isProcessing={isProcessing}
        onQuickAction={(text) => sendMessage(text)}
      />

      <InputArea
        isProcessing={isProcessing}
        queueCount={queueCount}
        onSend={sendMessage}
      />

      {showHistory && (
        <ConversationHistory
          conversations={conversations}
          onResume={resumeConversation}
          onDelete={deleteConversation}
          onClose={closeHistory}
        />
      )}
    </div>
  );
};
