import React, { useState, useCallback, useRef, useEffect } from 'react';

interface Props {
  onSend: (message: string) => void;
  onStop: () => void;
  isRunning: boolean;
  disabled: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSend, onStop, isRunning, disabled }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, onSend, disabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+Enter or Cmd+Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

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
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isRunning ? 'Claude is working...' : 'Message Claude... (Ctrl+Enter to send)'}
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
            title="Send message (Ctrl+Enter)"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
