/**
 * Welcome.tsx — Premium Welcome Screen
 *
 * Shown when the chat is empty. Features a branded logo, gradient accents,
 * and polished quick-action cards with icons and descriptions.
 */

import React from "react";

interface WelcomeProps {
  onQuickAction: (message: string) => void;
}

const QUICK_ACTIONS = [
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    label: "Explain this project",
    desc: "Understand the architecture",
    msg: "Explain the structure of this project",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    label: "Refactor code",
    desc: "Improve code quality",
    msg: "Help me refactor this code to be cleaner",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    label: "Find & fix bugs",
    desc: "Debug the current file",
    msg: "Find and fix any bugs in the current file",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    label: "Write tests",
    desc: "Generate test coverage",
    msg: "Write tests for the current file",
  },
];

export const Welcome: React.FC<WelcomeProps> = ({ onQuickAction }) => {
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <svg viewBox="0 0 24 24">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
      <div className="welcome-text">
        <h2>Cdoing Agent</h2>
        <p>Your AI coding assistant. Describe what you want to build, or pick a quick action below.</p>
      </div>
      <div className="quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            className="quick-action"
            onClick={() => onQuickAction(action.msg)}
          >
            <span className="quick-action-icon">{action.icon}</span>
            <span className="quick-action-content">
              <span className="quick-action-label">{action.label}</span>
              <span className="quick-action-desc">{action.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
