import React, { useState, useCallback, useRef, useEffect } from 'react';

interface Props {
  sessionCount: number;
  onBroadcast: (message: string) => void;
  disabled: boolean;
}

export const BroadcastInput: React.FC<Props> = ({ sessionCount, onBroadcast, disabled }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!input.trim() || disabled) return;
    onBroadcast(input.trim());
    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, onBroadcast, disabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }, [input]);

  return (
    <div className="broadcast-input">
      <div className="broadcast-input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Broadcast to ${sessionCount} sessions...`}
          disabled={disabled}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="broadcast-send-btn"
        >
          Send to {sessionCount}
        </button>
      </div>
    </div>
  );
};
