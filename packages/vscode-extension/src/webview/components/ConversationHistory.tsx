/**
 * ConversationHistory.tsx — Past Conversations Panel
 *
 * Shows a list of saved conversations as an overlay panel.
 * Users can resume or delete past conversations.
 *
 *   ┌──────────────────────────────┐
 *   │  History                  ✕  │
 *   ├──────────────────────────────┤
 *   │  Fix auth bug                │
 *   │  Mar 14 · 5 msgs            │
 *   ├──────────────────────────────┤
 *   │  Refactor API routes         │
 *   │  Mar 13 · 12 msgs           │
 *   └──────────────────────────────┘
 */

import React from "react";
import type { ConversationSummary } from "../types";

interface ConversationHistoryProps {
  conversations: ConversationSummary[];
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  conversations,
  onResume,
  onDelete,
  onClose,
}) => {
  const formatDate = (ts: number): string => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="history-overlay">
      <div className="history-panel">
        <div className="history-header">
          <span className="history-title">History</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        <div className="history-list">
          {conversations.length === 0 ? (
            <div className="history-empty">No past conversations</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className="history-item"
                onClick={() => {
                  onResume(conv.id);
                  onClose();
                }}
              >
                <div className="history-item-title">{conv.title}</div>
                <div className="history-item-meta">
                  {formatDate(conv.updatedAt)}
                  {conv.msgCount > 0 && ` \u00B7 ${conv.msgCount} msg${conv.msgCount !== 1 ? "s" : ""}`}
                </div>
                <button
                  className="history-item-delete"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conv.id);
                  }}
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
