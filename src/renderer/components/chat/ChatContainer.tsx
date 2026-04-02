import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ChatMessage, ChatMessageData } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SessionSettingsBar } from './SessionSettingsBar';
import { BranchSelector } from './BranchSelector';
import { PermissionPrompt } from './PermissionPrompt';
import { DiffReviewPanel } from './DiffReviewPanel';
import { useClaudeSession } from '../../hooks/useClaudeSession';
import { useChatPreferences } from '../../hooks/useChatPreferences';
import { ClaudeConfig } from '../../../shared/types';

interface Props {
  sessionId: string | null;
  sessionName: string;
  workingDir: string;
  claudeConfig?: ClaudeConfig;
  activeSkillId?: string | null;
  onConfigChange?: (config: ClaudeConfig) => void;
  onClearSkill?: () => void;
  onSkillInvokeReady?: (handler: (skillId: string, args: string) => void) => void;
  scrollToMessageId?: string | null;
  onScrollComplete?: () => void;
}

export const ChatContainer: React.FC<Props> = ({ sessionId, sessionName, workingDir, claudeConfig, activeSkillId, onConfigChange, onClearSkill, onSkillInvokeReady, scrollToMessageId, onScrollComplete }) => {
  const {
    messages,
    isRunning,
    status,
    currentStreamingMessage,
    sendMessage,
    addUserMessage,
    stopSession,
    currentBranchId,
    switchBranch,
    pendingPermissions,
    respondToPermission,
    diffReview,
    isFullAuto,
    applyDiffChanges,
    rejectDiffChanges,
    usage,
  } = useClaudeSession({ sessionId });

  const chatPrefs = useChatPreferences();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [localSkillId, setLocalSkillId] = useState<string | null>(null);
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);

  // Effective skill ID: local override (set immediately on invoke) or prop from DB
  const effectiveSkillId = localSkillId ?? activeSkillId ?? null;

  // Sync local state when prop changes (e.g. on app load or clear)
  useEffect(() => {
    setLocalSkillId(null);
  }, [activeSkillId]);

  // Resolve skill name from effective ID
  useEffect(() => {
    if (!effectiveSkillId) {
      setActiveSkillName(null);
      return;
    }
    window.electronAPI.skillListAll().then(skills => {
      const skill = skills.find(s => s.id === effectiveSkillId);
      setActiveSkillName(skill ? skill.name : effectiveSkillId);
    }).catch(() => setActiveSkillName(effectiveSkillId));
  }, [effectiveSkillId]);

  // Auto-clear skill badge when Claude finishes responding
  const prevIsRunning = useRef(false);
  useEffect(() => {
    if (prevIsRunning.current && !isRunning && effectiveSkillId) {
      // Claude just finished — clear the skill badge
      setLocalSkillId(null);
      onClearSkill?.();
    }
    prevIsRunning.current = isRunning;
  }, [isRunning, effectiveSkillId, onClearSkill]);

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

  const handleSkillInvoke = useCallback(async (skillId: string, args: string) => {
    if (!sessionId) return;
    // Show the user's command in the chat
    const displayText = args ? `/${skillId} ${args}` : `/${skillId}`;
    addUserMessage(displayText);

    try {
      await window.electronAPI.skillInvoke(sessionId, skillId, args);
      // Update local state immediately so badge appears without waiting for prop refresh
      setLocalSkillId(skillId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addUserMessage(`Error: ${msg}`);
    }
  }, [sessionId, addUserMessage]);

  // Expose skill invoke handler to parent (for command palette)
  useEffect(() => {
    onSkillInvokeReady?.(handleSkillInvoke);
  }, [handleSkillInvoke, onSkillInvokeReady]);

  const handleFork = useCallback(async (messageId: string) => {
    if (!sessionId) return;
    try {
      const branchId = crypto.randomUUID();
      await window.electronAPI.branchesCreate({
        id: branchId,
        sessionId,
        forkMessageId: messageId,
        name: `Branch from ${new Date().toLocaleTimeString()}`,
      });
      // Switch to the new branch
      switchBranch(branchId);
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

  // Extract plugin name from skill ID (e.g. "cook-en" from "cook-en:brainstorm")
  const activeSkillPlugin = effectiveSkillId?.split(':')[0] || null;

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>{sessionName}</h3>
        <span className="chat-working-dir">{workingDir}</span>
        {effectiveSkillId && (
          <span className="active-skill-badge">
            <span className="active-skill-label">
              {activeSkillPlugin && <span className="active-skill-plugin">{activeSkillPlugin}</span>}
              {activeSkillName || effectiveSkillId}
            </span>
            <button
              className="active-skill-clear"
              onClick={() => {
                setLocalSkillId(null);
                onClearSkill?.();
              }}
              title="Exit skill mode"
            >
              x
            </button>
          </span>
        )}
        {isFullAuto && (
          <span className="sandboxed-badge" title="Running in sandboxed mode — changes reviewed before applying">
            Sandboxed
          </span>
        )}
        {status && (
          <span className={`chat-status ${status.state}`}>
            {status.description}
          </span>
        )}
        {usage && usage.totalCostUsd > 0 && (
          <span className="chat-cost" title={`${usage.totalInputTokens.toLocaleString()} input + ${usage.totalOutputTokens.toLocaleString()} output tokens across ${usage.messageCount} messages`}>
            ${usage.totalCostUsd < 0.01 ? usage.totalCostUsd.toFixed(4) : usage.totalCostUsd.toFixed(2)}
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

      <div className="chat-messages" style={{ '--chat-font-size': `${chatPrefs.chatFontSize}px` } as React.CSSProperties}>
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

        {pendingPermissions.map((req) => (
          <PermissionPrompt
            key={req.requestId}
            request={req}
            onRespond={respondToPermission}
          />
        ))}

        {diffReview && (
          <DiffReviewPanel
            diffData={diffReview}
            onApply={applyDiffChanges}
            onReject={rejectDiffChanges}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={sendMessage}
        onStop={stopSession}
        onSkillInvoke={handleSkillInvoke}
        isRunning={isRunning}
        disabled={!sessionId}
        sendShortcut={chatPrefs.sendShortcut}
      />
    </div>
  );
};
