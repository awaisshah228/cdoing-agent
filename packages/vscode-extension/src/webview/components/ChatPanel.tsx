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

import React, { useEffect, useMemo } from "react";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { ConversationHistory } from "./ConversationHistory";
import { SettingsPanel } from "./SettingsPanel";
import { useChatStore } from "../store/chatStore";

/** Quick-switch model options per provider (subset for the header picker) */
const HEADER_MODEL_OPTIONS: Record<string, Array<{ value: string; label: string; hint?: string }>> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", hint: "balanced" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", hint: "powerful" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "fastest" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o", hint: "recommended" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", hint: "fast" },
    { value: "o3-mini", label: "o3 Mini", hint: "reasoning" },
  ],
  google: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "fast" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "capable" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "stable" },
  ],
  "openai-codex": [
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", hint: "latest" },
    { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", hint: "fast" },
    { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", hint: "capable" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", hint: "most capable" },
    { value: "o4-mini", label: "o4 Mini", hint: "reasoning" },
  ],
};

export const ChatPanel: React.FC = () => {
  const init = useChatStore((s) => s.init);

  // Initialize store + message listener once
  useEffect(() => {
    init();
  }, [init]);

  const tabs = useChatStore((s) => s.tabs);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const entries = useChatStore((s) => s.entries);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const queueCount = useChatStore((s) => s.queueCount);
  const modelLabel = useChatStore((s) => s.modelLabel);
  const conversations = useChatStore((s) => s.conversations);
  const showHistory = useChatStore((s) => s.showHistory);
  const showSettings = useChatStore((s) => s.showSettings);
  const extensionConfig = useChatStore((s) => s.extensionConfig);
  const permissionRequest = useChatStore((s) => s.permissionRequest);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);

  const createNewTab = useChatStore((s) => s.createNewTab);
  const switchToTab = useChatStore((s) => s.switchToTab);
  const closeTab = useChatStore((s) => s.closeTab);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const openHistory = useChatStore((s) => s.openHistory);
  const closeHistory = useChatStore((s) => s.closeHistory);
  const resumeConversation = useChatStore((s) => s.resumeConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const openSettings = useChatStore((s) => s.openSettings);
  const closeSettings = useChatStore((s) => s.closeSettings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const openVscodeSettings = useChatStore((s) => s.openVscodeSettings);
  const cancelGeneration = useChatStore((s) => s.cancelGeneration);
  const interruptAndSend = useChatStore((s) => s.interruptAndSend);
  const respondToPermission = useChatStore((s) => s.respondToPermission);
  const switchModel = useChatStore((s) => s.switchModel);
  const providerLabel = useChatStore((s) => s.providerLabel);
  const agentMode = useChatStore((s) => s.agentMode);
  const toggleMode = useChatStore((s) => s.toggleMode);
  const planApproval = useChatStore((s) => s.planApproval);
  const respondToPlanApproval = useChatStore((s) => s.respondToPlanApproval);

  const headerModelOptions = useMemo(
    () => HEADER_MODEL_OPTIONS[providerLabel] || [],
    [providerLabel]
  );

  return (
    <div className="chat-container">
      <Header
        modelLabel={modelLabel}
        modelOptions={headerModelOptions}
        onSelectModel={openSettings}
        onSwitchModel={switchModel}
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
        streamingId={streamingMessageId}
        onQuickAction={(text) => sendMessage(text)}
      />

      <InputArea
        isProcessing={isProcessing}
        queueCount={queueCount}
        onSend={sendMessage}
        onCancel={cancelGeneration}
        onInterruptAndSend={interruptAndSend}
        permissionRequest={permissionRequest}
        onPermissionResponse={respondToPermission}
        agentMode={agentMode}
        onToggleMode={toggleMode}
        planApproval={planApproval}
        onPlanApprovalResponse={respondToPlanApproval}
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
