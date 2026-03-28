import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { SkillAutocomplete } from './SkillAutocomplete';
import { SkillEntry } from '../../../shared/types';

interface Props {
  onSend: (message: string) => void;
  onStop: () => void;
  onSkillInvoke?: (skillId: string, args: string) => void;
  isRunning: boolean;
  disabled: boolean;
  sendShortcut?: 'ctrl+enter' | 'enter';
}

export const ChatInput: React.FC<Props> = ({ onSend, onStop, onSkillInvoke, isRunning, disabled, sendShortcut = 'ctrl+enter' }) => {
  const [input, setInput] = useState('');
  const [skillAutocompleteOpen, setSkillAutocompleteOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Detect if input starts with / and extract the query portion
  const skillQuery = useMemo(() => {
    if (!input.startsWith('/')) return null;
    // Find the end of the skill name — first space or end of string
    const spaceIdx = input.indexOf(' ');
    return spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
  }, [input]);

  // Show autocomplete when typing /
  useEffect(() => {
    setSkillAutocompleteOpen(skillQuery !== null && !input.includes(' '));
  }, [skillQuery, input]);

  const handleSkillSelect = useCallback((skill: SkillEntry) => {
    setSkillAutocompleteOpen(false);
    // Replace the /query with /skill.id and a trailing space for args
    setInput(`/${skill.id} `);
    textareaRef.current?.focus();
  }, []);

  const clearInput = useCallback(() => {
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, []);

  const handleSend = useCallback(() => {
    if (!input.trim() || disabled) return;

    // Check if this is a skill invocation: /plugin:name args
    if (input.startsWith('/') && onSkillInvoke) {
      const spaceIdx = input.indexOf(' ');
      const skillId = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
      const args = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1).trim();
      if (skillId) {
        onSkillInvoke(skillId, args);
        clearInput();
        return;
      }
      // Bare "/" with no skill name — ignore, don't send to Claude
      return;
    }

    onSend(input.trim());
    clearInput();
  }, [input, onSend, onSkillInvoke, disabled, clearInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't handle send shortcuts while autocomplete is open — it handles Enter/Tab
    if (skillAutocompleteOpen) return;

    if (sendShortcut === 'enter' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (sendShortcut === 'ctrl+enter' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, sendShortcut, skillAutocompleteOpen]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [input]);

  return (
    <div className="chat-input-area">
      <SkillAutocomplete
        query={skillQuery || ''}
        onSelect={handleSkillSelect}
        onClose={() => setSkillAutocompleteOpen(false)}
        visible={skillAutocompleteOpen}
      />
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setSkillAutocompleteOpen(false), 150)}
        placeholder={isRunning ? 'Claude is working...' : `Message Claude... (type / for skills, ${sendShortcut === 'enter' ? 'Enter' : 'Ctrl+Enter'} to send)`}
        disabled={disabled || isRunning}
        rows={1}
        className="chat-textarea"
      />
      <div className="chat-input-actions">
        {isRunning ? (
          <button className="btn stop-btn" onClick={onStop} title="Stop Claude">
            Stop
          </button>
        ) : (
          <button
            className="btn send-btn"
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            title={`Send message (${sendShortcut === 'enter' ? 'Enter' : 'Ctrl+Enter'})`}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
