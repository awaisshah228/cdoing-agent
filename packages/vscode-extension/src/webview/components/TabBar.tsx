/**
 * TabBar.tsx — Chat Tab Bar
 *
 * Horizontal tab bar showing all open conversations.
 * Each tab shows its title with a close button.
 * "+" button at the end creates a new tab.
 */

import React from "react";
import type { Tab } from "../store/chatStore";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSwitchTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSwitchTab,
  onNewTab,
  onCloseTab,
}) => {
  if (tabs.length <= 1) {
    // Single tab — don't show tab bar, just show "+" in header
    return null;
  }

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}
            onClick={() => onSwitchTab(tab.id)}
            title={tab.title}
          >
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="tab-new" onClick={onNewTab} title="New conversation">
        +
      </button>
    </div>
  );
};
