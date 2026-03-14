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
 *   Overlays: ConversationHistory, SettingsPanel
 */

import React from "react";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { ConversationHistory } from "./ConversationHistory";
import { SettingsPanel } from "./SettingsPanel";
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
    conversations,
    showHistory,
    openHistory,
    closeHistory,
    resumeConversation,
    deleteConversation,
    showSettings,
    extensionConfig,
    openSettings,
    closeSettings,
    saveSettings,
    openVscodeSettings,
  } = useChatState();

  return (
    <div className="chat-container">
      <Header
        modelLabel={modelLabel}
        onSelectModel={openSettings}
        onNewChat={createNewTab}
        onOpenSettings={openSettings}
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

      {showSettings && (
        <SettingsPanel
          config={extensionConfig}
          onSave={saveSettings}
          onOpenVscodeSettings={openVscodeSettings}
          onClose={closeSettings}
        />
      )}
    </div>
  );
};
