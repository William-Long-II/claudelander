import React, { useRef, useEffect, useCallback } from 'react';
import { ChatMessage, ChatMessageData } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SessionSettingsBar } from './SessionSettingsBar';
import { BranchSelector } from './BranchSelector';
import { useClaudeSession } from '../../hooks/useClaudeSession';
import { useChatPreferences } from '../../hooks/useChatPreferences';
import { ClaudeConfig } from '../../../shared/types';

interface Props {
  sessionId: string | null;
  sessionName: string;
  workingDir: string;
  claudeConfig?: ClaudeConfig;
  onConfigChange?: (config: ClaudeConfig) => void;
  scrollToMessageId?: string | null;
  onScrollComplete?: () => void;
}

export const ChatContainer: React.FC<Props> = ({ sessionId, sessionName, workingDir, claudeConfig, onConfigChange, scrollToMessageId, onScrollComplete }) => {
  const {
    messages,
    isRunning,
    status,
    currentStreamingMessage,
    sendMessage,
    stopSession,
    currentBranchId,
    switchBranch,
  } = useClaudeSession({ sessionId });

  const chatPrefs = useChatPreferences();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamingMessage?.content]);

  // Scroll to specific message (from search navigation)
  useEffect(() => {
    if (!scrollToMessageId) return;
    // Small delay to allow DOM to update after session switch
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${scrollToMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-flash');
        setTimeout(() => el.classList.remove('highlight-flash'), 2000);
      }
      onScrollComplete?.();
    }, 300);
    return () => clearTimeout(timer);
  }, [scrollToMessageId, onScrollComplete]);

  const handleSaveAsKnowledge = useCallback((content: string) => {
    // T1 fact scoped to session — promotion to T2/T3 widens visibility
    window.electronAPI.knowledgeCreate(content, {
      scopeSessionId: sessionId || undefined,
    });
  }, [sessionId]);

  const handleFork = useCallback(async (messageId: string) => {
    if (!sessionId) return;
    try {
      await window.electronAPI.branchesCreate({
        id: crypto.randomUUID(),
        sessionId,
        forkMessageId: messageId,
        name: `Branch from ${new Date().toLocaleTimeString()}`,
      });
      // Brief visual feedback
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.classList.add('highlight-flash');
        setTimeout(() => el.classList.remove('highlight-flash'), 1500);
      }
    } catch (err) {
      console.error('Failed to create branch:', err);
    }
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
        {sessionId && (
          <BranchSelector
            sessionId={sessionId}
            currentBranchId={currentBranchId}
            onBranchSwitch={switchBranch}
            onFork={handleFork}
          />
        )}
      </div>

      <SessionSettingsBar
        config={claudeConfig || {}}
        onChange={(config) => onConfigChange?.(config)}
        disabled={isRunning}
      />

      <div className="chat-messages" style={{ fontSize: `${chatPrefs.chatFontSize}px` }}>
        {allMessages.length === 0 && (
          <div className="chat-welcome">
            <p>Start a conversation with Claude. Your messages are saved and searchable.</p>
          </div>
        )}

        {allMessages.map((msg) => (
          <div key={msg.id} id={`msg-${msg.id}`}>
            <ChatMessage message={msg} onSaveAsKnowledge={handleSaveAsKnowledge} onFork={handleFork} showThinking={chatPrefs.showThinking} />
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={sendMessage}
        onStop={stopSession}
        isRunning={isRunning}
        disabled={!sessionId}
        sendShortcut={chatPrefs.sendShortcut}
      />
    </div>
  );
};
