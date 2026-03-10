import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ShareCode, CreateCodeOptions } from '../../shared/types';
import { TIER_LIMITS, UserTier } from '../../shared/constants';
import './ShareModal.css';

interface ShareModalProps {
  sessionId: string;
  sessionName: string;
  userTier: UserTier;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  sessionId,
  sessionName,
  userTier,
  isOpen,
  onClose,
}) => {
  const [isSharing, setIsSharing] = useState(false);
  const [codes, setCodes] = useState<ShareCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Code creation form
  const [permission, setPermission] = useState<'read' | 'control'>('read');
  const [expiresIn, setExpiresIn] = useState<number>(30);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Get tier limits
  const tierLimits = TIER_LIMITS[userTier];

  // Build expiry options based on tier
  const expiryOptions = useMemo(() => {
    const allOptions = [
      { value: 30, label: '30 minutes' },
      { value: 60, label: '1 hour' },
      { value: 240, label: '4 hours' },
      { value: 0, label: 'No expiry' },
    ];

    if (tierLimits.maxDuration === null) {
      // Pro/Admin can use all options
      return allOptions;
    }

    // Filter options to those within tier limit
    return allOptions.filter(opt => opt.value > 0 && opt.value <= tierLimits.maxDuration);
  }, [tierLimits.maxDuration]);

  // Build max uses options based on tier
  const maxUsesOptions = useMemo(() => {
    const allOptions = [
      { value: '1', label: '1 use' },
      { value: '5', label: '5 uses' },
      { value: 'unlimited', label: 'Unlimited' },
    ];

    if (tierLimits.maxCodes === null) {
      return allOptions;
    }

    // Free tier: limit to specific use counts
    return allOptions.filter(opt => opt.value !== 'unlimited');
  }, [tierLimits.maxCodes]);

  useEffect(() => {
    if (isOpen) {
      checkSharingStatus();
    }
  }, [isOpen, sessionId]);

  const checkSharingStatus = async () => {
    setError(null);
    const sharing = await window.electronAPI.isSharing(sessionId);
    setIsSharing(sharing);
    if (sharing) {
      const existingCodes = await window.electronAPI.getShareCodes(sessionId);
      setCodes(existingCodes);
    }
  };

  const handleStartSharing = async () => {
    setLoading(true);
    setError(null);
    try {
      await window.electronAPI.startSharing(sessionId);
      setIsSharing(true);
    } catch (e) {
      const errMsg = (e as Error).message;
      // Parse server error messages for cleaner display
      const jsonMatch = errMsg.match(/\{.*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          setError(parsed.message || errMsg);
        } catch {
          setError(errMsg);
        }
      } else {
        setError(errMsg);
      }
    }
    setLoading(false);
  };

  const handleStopSharing = async () => {
    setLoading(true);
    try {
      await window.electronAPI.stopSharing(sessionId);
      setIsSharing(false);
      setCodes([]);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  const handleCreateCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const options: CreateCodeOptions = {
        permission,
        expiresInMinutes: expiresIn,
        maxUses: maxUses || undefined,
      };
      const code = await window.electronAPI.createShareCode(sessionId, options);
      setCodes([...codes, code]);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  const handleRevokeCode = async (code: string) => {
    setLoading(true);
    try {
      await window.electronAPI.revokeShareCode(code);
      setCodes(codes.filter((c) => c.code !== code));
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (e) {
      setError('Failed to copy to clipboard');
    }
  };

  const handleModalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const modal = e.currentTarget as HTMLElement;
      const focusable = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content share-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        onKeyDown={handleModalKeyDown}
      >
        <div className="modal-header">
          <h2 id="share-modal-title">Share Session</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close share dialog">×</button>
        </div>

        <div className="modal-body">
          <p className="session-name">Session: {sessionName}</p>

          {error && <div className="error-message">{error}</div>}

          {!isSharing ? (
            <div className="start-sharing">
              <p>Share this session to let others view or collaborate in real-time.</p>
              <button
                className="btn primary"
                onClick={handleStartSharing}
                disabled={loading}
              >
                {loading ? 'Starting...' : 'Start Sharing'}
              </button>
            </div>
          ) : (
            <>
              <div className="create-code-form">
                <h3>Create Share Code</h3>

                <div className="form-group">
                  <label htmlFor="share-permission">Permission</label>
                  <select
                    id="share-permission"
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as 'read' | 'control')}
                  >
                    <option value="read">Read Only (can view)</option>
                    <option value="control">Full Control (can type)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="share-expires">Expires In</label>
                  <select
                    id="share-expires"
                    value={expiresIn}
                    onChange={(e) => setExpiresIn(Number(e.target.value))}
                  >
                    {expiryOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {userTier === 'free' && (
                    <span className="tier-hint">Free tier: 30 min max</span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="share-max-uses">Max Uses</label>
                  <select
                    id="share-max-uses"
                    value={maxUses === null ? 'unlimited' : String(maxUses)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMaxUses(val === 'unlimited' ? null : Number(val));
                    }}
                  >
                    {maxUsesOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <button
                  className="btn primary"
                  onClick={handleCreateCode}
                  disabled={loading}
                >
                  Generate Code
                </button>
              </div>

              {codes.length > 0 && (
                <div className="codes-list">
                  <h3>Active Codes</h3>
                  {codes.map((code) => (
                    <div key={code.code} className="code-item">
                      <div className="code-value">
                        <span className="code">{code.code}</span>
                        <button className="copy-btn" onClick={() => copyCode(code.code)}>
                          {copiedCode === code.code ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <div className="code-meta">
                        <span className={`permission ${code.permission}`}>
                          {code.permission}
                        </span>
                        {code.expiresAt && (
                          <span className="expires">
                            Expires: {new Date(code.expiresAt).toLocaleTimeString()}
                          </span>
                        )}
                        {code.maxUses && (
                          <span className="uses">
                            {code.currentUses}/{code.maxUses} uses
                          </span>
                        )}
                      </div>
                      <button
                        className="revoke-btn"
                        onClick={() => handleRevokeCode(code.code)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="stop-sharing">
                <button
                  className="btn danger"
                  onClick={handleStopSharing}
                  disabled={loading}
                >
                  Stop Sharing
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
