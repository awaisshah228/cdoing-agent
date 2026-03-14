/**
 * Header.tsx — Top Bar Component
 *
 * Shows the extension name, current model badge, and action buttons.
 * Clicking the model badge opens the model selector.
 *
 *   ┌──────────────────────────────────────┐
 *   │  Cdoing  [claude-sonnet-4]    [+] [⚙] │
 *   └──────────────────────────────────────┘
 */

import React from "react";

interface HeaderProps {
  modelLabel: string;          // Current model name displayed in the badge
  onSelectModel: () => void;   // Called when user clicks the model badge
  onNewChat: () => void;       // Called when user clicks the "+" button
  onOpenSettings: () => void;  // Called when user clicks the gear button
}

export const Header: React.FC<HeaderProps> = ({
  modelLabel,
  onSelectModel,
  onNewChat,
  onOpenSettings,
}) => {
  return (
    <div className="header">
      <div className="header-left">
        <span className="header-title">Cdoing</span>
        {/* Clickable badge showing the current model — opens model selector */}
        <span
          className="model-badge"
          title="Click to change model"
          onClick={onSelectModel}
        >
          {modelLabel}
        </span>
      </div>
      <div className="header-actions">
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
