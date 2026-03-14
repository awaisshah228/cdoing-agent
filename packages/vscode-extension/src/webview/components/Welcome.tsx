/**
 * Welcome.tsx — Welcome Screen
 *
 * Shown when the chat is empty (no messages yet).
 * Displays a greeting and quick action buttons that send pre-written prompts.
 * Clicking a quick action immediately sends that message to the agent.
 */

import React from "react";

interface WelcomeProps {
  onQuickAction: (message: string) => void; // Called with the pre-written prompt text
}

/** Pre-defined quick actions shown on the welcome screen */
const QUICK_ACTIONS = [
  { icon: "?", label: "Explain project structure", msg: "Explain the structure of this project" },
  { icon: "!", label: "Find & fix bugs", msg: "Find and fix any bugs in the current file" },
  { icon: ">", label: "Refactor code", msg: "Help me refactor this code to be cleaner" },
  { icon: "#", label: "Write tests", msg: "Write tests for the current file" },
];

export const Welcome: React.FC<WelcomeProps> = ({ onQuickAction }) => {
  return (
    <div className="welcome">
      <h2>Cdoing Agent</h2>
      <p>AI-powered coding assistant. Ask me anything about your codebase.</p>
      <div className="quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            className="quick-action"
            onClick={() => onQuickAction(action.msg)}
          >
            <span>{action.icon}</span> {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};
