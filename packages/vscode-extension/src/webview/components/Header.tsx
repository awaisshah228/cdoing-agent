/**
 * Header.tsx — Top Bar Component
 *
 * Shows the extension name, current model badge, and action buttons.
 *
 *   ┌─────────────────────────────────────────┐
 *   │  Cdoing  [claude-sonnet-4]  [H] [+] [⚙] │
 *   └─────────────────────────────────────────┘
 */

import React from "react";

interface HeaderProps {
  modelLabel: string;
  onSelectModel: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  modelLabel,
  onSelectModel,
  onNewChat,
  onOpenSettings,
  onOpenHistory,
}) => {
  return (
    <div className="header">
      <div className="header-left">
        <span className="header-title">Cdoing</span>
        <span
          className="model-badge"
          title="Click to change model"
          onClick={onSelectModel}
        >
          {modelLabel}
        </span>
      </div>
      <div className="header-actions">
        <button className="icon-btn" title="History" onClick={onOpenHistory}>
          &#x1F4CB;
        </button>
        <button className="icon-btn" title="New Chat" onClick={onNewChat}>
          +
        </button>
        <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
          &#x2699;
        </button>
      </div>
    </div>
  );
};
