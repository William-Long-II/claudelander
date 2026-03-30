import React, { useState, useEffect, useCallback } from 'react';
import type { PermissionRequest } from '../../../shared/types';

interface Props {
  request: PermissionRequest;
  onRespond: (requestId: string, decision: 'allow' | 'deny', scope: string, toolPattern?: string) => void;
}

const SCOPE_OPTIONS = [
  { value: 'once', label: 'Just this once' },
  { value: 'session', label: 'For this session' },
  { value: 'group', label: 'For this project' },
  { value: 'global', label: 'Always' },
];

const TIMEOUT_SECONDS = 300; // 5 minutes

export const PermissionPrompt: React.FC<Props> = ({ request, onRespond }) => {
  const [scope, setScope] = useState('session');
  const [remaining, setRemaining] = useState(TIMEOUT_SECONDS);
  const [responded, setResponded] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (responded) return;
    const interval = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [responded]);

  // Auto-deny on timeout
  useEffect(() => {
    if (remaining <= 0 && !responded) {
      handleRespond('deny');
    }
  }, [remaining, responded]);

  const handleRespond = useCallback((decision: 'allow' | 'deny') => {
    if (responded) return;
    setResponded(true);

    // Generate tool pattern for persistence (only if not "once")
    let toolPattern: string | undefined;
    if (scope !== 'once') {
      toolPattern = inferPattern(request.toolName, request.toolInput);
    }

    onRespond(request.requestId, decision, scope, toolPattern);
  }, [responded, scope, request, onRespond]);

  // Keyboard shortcuts
  useEffect(() => {
    if (responded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRespond('allow');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleRespond('deny');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [responded, handleRespond]);

  const inputPreview = formatToolInput(request.toolName, request.toolInput);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  if (responded) {
    return null;
  }

  return (
    <div className="permission-prompt" role="dialog" aria-modal="false" aria-label="Permission required">
      <div className="permission-prompt-header">
        <span className="permission-prompt-icon">&#128274;</span>
        <span className="permission-prompt-title">Permission Required</span>
        <span className="permission-prompt-timer">
          {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
      </div>

      <div className="permission-prompt-body">
        <div className="permission-prompt-tool">
          Claude wants to use: <strong>{request.toolName}</strong>
        </div>

        {inputPreview && (
          <pre className="permission-prompt-input">{inputPreview}</pre>
        )}

        {request.decisionReason && (
          <div className="permission-prompt-reason">{request.decisionReason}</div>
        )}
      </div>

      <div className="permission-prompt-scope">
        <span className="permission-prompt-scope-label">Remember:</span>
        {SCOPE_OPTIONS.map(opt => (
          <label key={opt.value} className="permission-prompt-scope-option">
            <input
              type="radio"
              name={`scope-${request.requestId}`}
              value={opt.value}
              checked={scope === opt.value}
              onChange={() => setScope(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <div className="permission-prompt-actions">
        <button
          className="permission-prompt-deny"
          onClick={() => handleRespond('deny')}
          title="Deny (Esc)"
        >
          Deny
        </button>
        <button
          className="permission-prompt-allow"
          onClick={() => handleRespond('allow')}
          title="Allow (Enter)"
        >
          Allow
        </button>
      </div>
    </div>
  );
};

/**
 * Format tool input for display in the prompt preview.
 */
function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return typeof input.command === 'string' ? input.command : JSON.stringify(input, null, 2);
    case 'Read':
      return typeof input.file_path === 'string' ? `file: ${input.file_path}` : JSON.stringify(input, null, 2);
    case 'Edit':
    case 'Write':
      if (typeof input.file_path === 'string') {
        const preview = typeof input.content === 'string'
          ? input.content.substring(0, 200) + (input.content.length > 200 ? '...' : '')
          : '';
        return preview ? `file: ${input.file_path}\n${preview}` : `file: ${input.file_path}`;
      }
      return JSON.stringify(input, null, 2);
    case 'Grep':
    case 'Glob':
      return typeof input.pattern === 'string' ? `pattern: ${input.pattern}` : JSON.stringify(input, null, 2);
    default: {
      const str = JSON.stringify(input, null, 2);
      return str.length > 500 ? str.substring(0, 500) + '...' : str;
    }
  }
}

/**
 * Infer a permission pattern from the tool name and input.
 * Mirrors the logic in permission-evaluator.ts inferToolPattern.
 */
function inferPattern(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : '';
      const parts = cmd.trim().split(/\s+/);
      if (parts.length >= 2) {
        const twoWord = `${parts[0]} ${parts[1]}`;
        if (/^(git|npm|npx|yarn|pnpm|docker|cargo|make|pip|python|node)\s/.test(twoWord)) {
          return `Bash(${twoWord} *)`;
        }
      }
      return parts[0] ? `Bash(${parts[0]} *)` : 'Bash';
    }
    case 'Read':
    case 'Edit':
    case 'Write': {
      const filePath = typeof input.file_path === 'string' ? input.file_path : '';
      const normalized = filePath.replace(/\\/g, '/');
      const parts = normalized.split('/');
      if (parts.length >= 2) {
        const dir = parts.slice(0, -1).join('/');
        return `${toolName}(${dir}/**)`;
      }
      return toolName;
    }
    default:
      return toolName;
  }
}
