import React, { useRef, useEffect, useCallback } from 'react';
import { ChatMessage, ChatMessageData } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SessionSettingsBar } from './SessionSettingsBar';
import { useClaudeSession } from '../../hooks/useClaudeSession';
import { ClaudeConfig } from '../../../shared/types';

interface Props {
  sessionId: string | null;
  sessionName: string;
  workingDir: string;
  claudeConfig?: ClaudeConfig;
  onConfigChange?: (config: ClaudeConfig) => void;
}

export const ChatContainer: React.FC<Props> = ({ sessionId, sessionName, workingDir, claudeConfig, onConfigChange }) => {
  const {
    messages,
    isRunning,
    status,
    currentStreamingMessage,
    sendMessage,
    stopSession,
  } = useClaudeSession({ sessionId });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamingMessage?.content]);

  const handleSaveAsKnowledge = useCallback((content: string) => {
    window.electronAPI.knowledgeCreate(content, {
      scopeSessionId: sessionId || undefined,
    });
  }, [sessionId]);

  const allMessages = [...messages];
  if (currentStreamingMessage) {
    allMessages.push(currentStreamingMessage);
  }

  if (!sessionId) {
    return (
      <div className="chat-container empty">
        <div className="chat-empty-state">
          <h2>Welcome to ClaudeLander</h2>
          <p>Select a session or create a new one to start chatting with Claude.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>{sessionName}</h3>
        <span className="chat-working-dir">{workingDir}</span>
        {status && (
          <span className={`chat-status ${status.state}`}>
            {status.description}
          </span>
        )}
      </div>

      <SessionSettingsBar
        config={claudeConfig || {}}
        onChange={(config) => onConfigChange?.(config)}
        disabled={isRunning}
      />

      <div className="chat-messages">
        {allMessages.length === 0 && (
          <div className="chat-welcome">
            <p>Start a conversation with Claude. Your messages are saved and searchable.</p>
          </div>
        )}

        {allMessages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} onSaveAsKnowledge={handleSaveAsKnowledge} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={sendMessage}
        onStop={stopSession}
        isRunning={isRunning}
        disabled={!sessionId}
      />
    </div>
  );
};
