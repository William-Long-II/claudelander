import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ApiServerStatus, PairedDevice, PairingCode, RelayConnectionStatus } from '../../shared/types';
import { SessionSettingsBar } from './chat/SessionSettingsBar';
import { ClaudeConfig } from '../../shared/types';
import { notifyChatPreferencesChanged } from '../hooks/useChatPreferences';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  type SettingsTab = 'general' | 'appearance' | 'sound' | 'integrations' | 'mobile' | 'claude' | 'permissions';
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [permissionRules, setPermissionRules] = useState<any[]>([]);

  // Mobile API state
  const [apiStatus, setApiStatus] = useState<ApiServerStatus>({ running: false });
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [port, setPort] = useState(8443);
  const [enableMdns, setEnableMdns] = useState(true);
  const [loading, setLoading] = useState(false);

  // Remote access state
  const [remoteStatus, setRemoteStatus] = useState<RelayConnectionStatus>({
    enabled: false,
    connected: false,
    desktopId: null,
    relayUrl: '',
  });
  const [remoteLoading, setRemoteLoading] = useState(false);

  // Sound settings state
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(70);
  const [debouncePreset, setDebouncePreset] = useState<'fast' | 'normal' | 'relaxed'>('normal');
  const [soundWaitingEnabled, setSoundWaitingEnabled] = useState(true);
  const [soundErrorEnabled, setSoundErrorEnabled] = useState(true);
  const [soundStartEnabled, setSoundStartEnabled] = useState(true);
  const [soundCompleteEnabled, setSoundCompleteEnabled] = useState(true);
  const volumeSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // General settings state
  const [autoLaunchClaude, setAutoLaunchClaude] = useState(true);
  const [customShellPath, setCustomShellPath] = useState('');
  const [closeToTray, setCloseToTray] = useState(true);
  const [preferredEditor, setPreferredEditor] = useState('');
  const [editorOptions, setEditorOptions] = useState<{ value: string; label: string }[]>([]);

  // Appearance settings state
  const [showSplash, setShowSplash] = useState(true);
  const [splashDuration, setSplashDuration] = useState(2.5);

  // Chat settings state
  const [chatFontSize, setChatFontSize] = useState(14);
  const [showThinking, setShowThinking] = useState(true);
  const [sendShortcut, setSendShortcut] = useState('ctrl+enter');

  // Terminal settings state
  const [fontSize, setFontSize] = useState(14);
  const [webglRenderer, setWebglRenderer] = useState(true);

  // Desktop notifications state
  const [enableNotifications, setEnableNotifications] = useState(true);

  // Integrations state
  const [githubUser, setGithubUser] = useState<{ username: string } | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);

  // Claude defaults state
  const [claudeDefaults, setClaudeDefaults] = useState<ClaudeConfig>({});

  // Error state for surfacing errors to users
  const [error, setError] = useState<string | null>(null);

  // Load initial state
  useEffect(() => {
    if (!isOpen) return;

    const loadState = async () => {
      try {
        const [status, devices, hasPairingResult, remoteAccessStatus] = await Promise.all([
          window.electronAPI.apiGetStatus(),
          window.electronAPI.apiGetPairedDevices(),
          window.electronAPI.apiHasPairingCode(),
          window.electronAPI.apiGetRemoteAccessStatus(),
        ]);
        setApiStatus(status);
        setPairedDevices(devices);
        if (!hasPairingResult.active) {
          setPairingCode(null);
        }
        setRemoteStatus(remoteAccessStatus);

        // Load sound settings
        const [
          soundEnabledPref,
          volumePref,
          debouncePref,
          waitingPref,
          errorPref,
          startPref,
          completePref,
          autoLaunchPref,
          shellPathPref,
          closeToTrayPref,
          showSplashPref,
          splashDurationPref,
          fontSizePref,
          webglRendererPref,
          enableNotificationsPref,
          chatFontSizePref,
          showThinkingPref,
          sendShortcutPref,
        ] = await Promise.all([
          window.electronAPI.getPreference('notificationSound'),
          window.electronAPI.getPreference('soundVolume'),
          window.electronAPI.getPreference('soundDebouncePreset'),
          window.electronAPI.getPreference('soundWaitingEnabled'),
          window.electronAPI.getPreference('soundErrorEnabled'),
          window.electronAPI.getPreference('soundStartEnabled'),
          window.electronAPI.getPreference('soundCompleteEnabled'),
          window.electronAPI.getPreference('autoLaunchClaude'),
          window.electronAPI.getPreference('customShellPath'),
          window.electronAPI.getPreference('closeToTray'),
          window.electronAPI.getPreference('showSplash'),
          window.electronAPI.getPreference('splashDuration'),
          window.electronAPI.getPreference('fontSize'),
          window.electronAPI.getPreference('webglRenderer'),
          window.electronAPI.getPreference('enableNotifications'),
          window.electronAPI.getPreference('chatFontSize'),
          window.electronAPI.getPreference('showThinking'),
          window.electronAPI.getPreference('sendShortcut'),
        ]);

        setSoundEnabled(soundEnabledPref !== 'false');
        setSoundVolume(volumePref ? parseInt(volumePref, 10) : 70);
        setDebouncePreset((debouncePref as 'fast' | 'normal' | 'relaxed') || 'normal');
        setSoundWaitingEnabled(waitingPref !== 'false');
        setSoundErrorEnabled(errorPref !== 'false');
        setSoundStartEnabled(startPref !== 'false');
        setSoundCompleteEnabled(completePref !== 'false');
        setAutoLaunchClaude(autoLaunchPref === 'true');
        setCustomShellPath(shellPathPref || '');
        setCloseToTray(closeToTrayPref !== 'false');
        setShowSplash(showSplashPref === 'true');
        setSplashDuration(splashDurationPref ? parseFloat(splashDurationPref) : 2.5);
        setFontSize(fontSizePref ? parseInt(fontSizePref, 10) : 14);
        setWebglRenderer(webglRendererPref === 'true');
        setEnableNotifications(enableNotificationsPref !== 'false');
        setChatFontSize(chatFontSizePref ? parseInt(chatFontSizePref, 10) : 14);
        setShowThinking(showThinkingPref !== 'false');
        setSendShortcut(sendShortcutPref || 'ctrl+enter');

        // Load GitHub user status
        try {
          const user = await window.electronAPI.getUser();
          setGithubUser(user);
        } catch {
          setGithubUser(null);
        }

        // Load editor options and preference
        try {
          const [options, editorPref] = await Promise.all([
            window.electronAPI.getEditorOptions(),
            window.electronAPI.getPreference('preferredEditor'),
          ]);
          setEditorOptions(options);
          setPreferredEditor(editorPref || '');
        } catch {
          // Editor options are optional
        }
      } catch (err) {
        console.error('Failed to load API state:', err);
        setError('Failed to load settings. Please try reopening the settings.');
      }
    };

    loadState();
  }, [isOpen]);

  // Load claude defaults
  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI.getPreference('claude.defaultConfig').then(raw => {
      if (raw) {
        try { setClaudeDefaults(JSON.parse(raw)); } catch {}
      }
    });
  }, [isOpen]);

  // Listen for GitHub auth changes
  useEffect(() => {
    const unsubscribe = window.electronAPI.onAuthChanged(async () => {
      try {
        const user = await window.electronAPI.getUser();
        setGithubUser(user);
      } catch {
        setGithubUser(null);
      }
    });
    return unsubscribe;
  }, []);

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleStartServer = useCallback(async () => {
    setLoading(true);
    try {
      await window.electronAPI.apiStart({ port, enableMdns });
      const status = await window.electronAPI.apiGetStatus();
      setApiStatus(status);
    } catch (err) {
      console.error('Failed to start API server:', err);
      setError('Failed to start API server.');
    }
    setLoading(false);
  }, [port, enableMdns]);

  const handleStopServer = useCallback(async () => {
    setLoading(true);
    try {
      await window.electronAPI.apiStop();
      setApiStatus({ running: false });
      setPairingCode(null);
    } catch (err) {
      console.error('Failed to stop API server:', err);
      setError('Failed to stop API server.');
    }
    setLoading(false);
  }, []);

  const handleGeneratePairingCode = useCallback(async () => {
    try {
      const result = await window.electronAPI.apiGeneratePairingCode({
        canControl: true,
        canModify: false,
      });
      if (result.success && result.code && result.qrCode && result.expiresAt) {
        setPairingCode({
          code: result.code,
          qrCode: result.qrCode,
          expiresAt: result.expiresAt,
          addresses: result.addresses,
          port: result.port,
        });
      } else {
        console.error('Failed to generate pairing code:', result.error);
        setError('Failed to generate pairing code.');
      }
    } catch (err) {
      console.error('Failed to generate pairing code:', err);
      setError('Failed to generate pairing code.');
    }
  }, []);

  const handleCancelPairing = useCallback(async () => {
    try {
      await window.electronAPI.apiCancelPairing();
      setPairingCode(null);
    } catch (err) {
      console.error('Failed to cancel pairing:', err);
      setError('Failed to cancel pairing.');
    }
  }, []);

  const handleUnpairDevice = useCallback(async (deviceId: string) => {
    try {
      await window.electronAPI.apiUnpairDevice(deviceId);
      setPairedDevices(prev => prev.filter(d => d.id !== deviceId));
    } catch (err) {
      console.error('Failed to unpair device:', err);
      setError('Failed to unpair device.');
    }
  }, []);

  const handleUpdatePermissions = useCallback(async (
    deviceId: string,
    permissions: { canControl?: boolean; canModify?: boolean }
  ) => {
    try {
      await window.electronAPI.apiUpdateDevicePermissions(deviceId, permissions);
      setPairedDevices(prev =>
        prev.map(d =>
          d.id === deviceId
            ? { ...d, ...permissions }
            : d
        )
      );
    } catch (err) {
      console.error('Failed to update permissions:', err);
      setError('Failed to update device permissions.');
    }
  }, []);

  const handleEnableRemoteAccess = useCallback(async () => {
    setRemoteLoading(true);
    try {
      const result = await window.electronAPI.apiEnableRemoteAccess();
      if (result.success && result.status) {
        setRemoteStatus(result.status);
      } else {
        console.error('Failed to enable remote access:', result.error);
        setError('Failed to enable remote access.');
      }
    } catch (err) {
      console.error('Failed to enable remote access:', err);
      setError('Failed to enable remote access.');
    }
    setRemoteLoading(false);
  }, []);

  const handleDisableRemoteAccess = useCallback(async () => {
    setRemoteLoading(true);
    try {
      const result = await window.electronAPI.apiDisableRemoteAccess();
      if (result.success) {
        setRemoteStatus(prev => ({ ...prev, enabled: false, connected: false }));
      } else {
        console.error('Failed to disable remote access:', result.error);
        setError('Failed to disable remote access.');
      }
    } catch (err) {
      console.error('Failed to disable remote access:', err);
      setError('Failed to disable remote access.');
    }
    setRemoteLoading(false);
  }, []);

  // Sound setting handlers
  const handleSoundEnabledChange = useCallback(async (enabled: boolean) => {
    setSoundEnabled(enabled);
    await window.electronAPI.setPreference('notificationSound', enabled.toString());
  }, []);

  const handleVolumeChange = useCallback((volume: number) => {
    setSoundVolume(volume);
    // Debounce preference save to avoid excessive writes during slider drag
    if (volumeSaveTimerRef.current) {
      clearTimeout(volumeSaveTimerRef.current);
    }
    volumeSaveTimerRef.current = setTimeout(() => {
      window.electronAPI.setPreference('soundVolume', volume.toString());
    }, 300);
  }, []);

  const handleDebouncePresetChange = useCallback(async (preset: 'fast' | 'normal' | 'relaxed') => {
    setDebouncePreset(preset);
    await window.electronAPI.setPreference('soundDebouncePreset', preset);
  }, []);

  const handleSoundToggle = useCallback(async (
    event: 'waiting' | 'error' | 'start' | 'complete',
    enabled: boolean
  ) => {
    const prefKey = `sound${event.charAt(0).toUpperCase() + event.slice(1)}Enabled`;
    await window.electronAPI.setPreference(prefKey, enabled.toString());

    switch (event) {
      case 'waiting': setSoundWaitingEnabled(enabled); break;
      case 'error': setSoundErrorEnabled(enabled); break;
      case 'start': setSoundStartEnabled(enabled); break;
      case 'complete': setSoundCompleteEnabled(enabled); break;
    }
  }, []);

  const handleTestSound = useCallback(async (event: 'waiting' | 'error' | 'start' | 'complete') => {
    await window.electronAPI.testSound(event);
  }, []);

  // General setting handlers
  const handleAutoLaunchClaudeChange = useCallback(async (enabled: boolean) => {
    setAutoLaunchClaude(enabled);
    await window.electronAPI.setPreference('autoLaunchClaude', enabled.toString());
  }, []);

  const handleCustomShellPathChange = useCallback(async (path: string) => {
    setCustomShellPath(path);
    await window.electronAPI.setPreference('customShellPath', path);
  }, []);

  const handleCloseToTrayChange = useCallback(async (enabled: boolean) => {
    setCloseToTray(enabled);
    await window.electronAPI.setPreference('closeToTray', enabled.toString());
  }, []);

  const handlePreferredEditorChange = useCallback(async (editor: string) => {
    setPreferredEditor(editor);
    await window.electronAPI.setPreference('preferredEditor', editor);
  }, []);

  // Appearance setting handlers
  const handleShowSplashChange = useCallback(async (enabled: boolean) => {
    setShowSplash(enabled);
    await window.electronAPI.setPreference('showSplash', enabled.toString());
  }, []);

  const handleSplashDurationChange = useCallback(async (duration: number) => {
    setSplashDuration(duration);
    await window.electronAPI.setPreference('splashDuration', duration.toString());
  }, []);

  // Chat setting handlers
  const handleChatFontSizeChange = useCallback(async (size: number) => {
    setChatFontSize(size);
    await window.electronAPI.setPreference('chatFontSize', size.toString());
    notifyChatPreferencesChanged();
  }, []);

  const handleShowThinkingChange = useCallback(async (enabled: boolean) => {
    setShowThinking(enabled);
    await window.electronAPI.setPreference('showThinking', enabled.toString());
    notifyChatPreferencesChanged();
  }, []);

  const handleSendShortcutChange = useCallback(async (value: string) => {
    setSendShortcut(value);
    await window.electronAPI.setPreference('sendShortcut', value);
    notifyChatPreferencesChanged();
  }, []);

  // Terminal setting handlers
  const handleFontSizeChange = useCallback(async (size: number) => {
    setFontSize(size);
    await window.electronAPI.setPreference('fontSize', size.toString());
  }, []);

  const handleWebglRendererChange = useCallback(async (enabled: boolean) => {
    setWebglRenderer(enabled);
    await window.electronAPI.setPreference('webglRenderer', enabled.toString());
  }, []);

  const handleEnableNotificationsChange = useCallback(async (enabled: boolean) => {
    setEnableNotifications(enabled);
    await window.electronAPI.setPreference('enableNotifications', enabled.toString());
  }, []);

  // Claude defaults handler
  const handleClaudeDefaultsChange = (config: ClaudeConfig) => {
    setClaudeDefaults(config);
    window.electronAPI.setPreference('claude.defaultConfig', JSON.stringify(config));
  };

  // Integrations handlers
  const handleGitHubLogin = useCallback(async () => {
    setGithubLoading(true);
    try {
      await window.electronAPI.login();
      const user = await window.electronAPI.getUser();
      setGithubUser(user);
    } catch (err) {
      console.error('GitHub login failed:', err);
      setError('GitHub login failed. Please try again.');
    }
    setGithubLoading(false);
  }, []);

  const handleGitHubLogout = useCallback(async () => {
    setGithubLoading(true);
    try {
      await window.electronAPI.logout();
      setGithubUser(null);
    } catch (err) {
      console.error('GitHub logout failed:', err);
      setError('GitHub logout failed. Please try again.');
    }
    setGithubLoading(false);
  }, []);

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
        className="modal settings-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onKeyDown={handleModalKeyDown}
      >
        <div className="modal-header">
          <h2 id="settings-modal-title">Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close settings">&times;</button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            <button
              className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
              onClick={() => setActiveTab('appearance')}
            >
              Appearance
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'mobile' ? 'active' : ''}`}
              onClick={() => setActiveTab('mobile')}
            >
              Mobile App
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'sound' ? 'active' : ''}`}
              onClick={() => setActiveTab('sound')}
            >
              Sound
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'integrations' ? 'active' : ''}`}
              onClick={() => setActiveTab('integrations')}
            >
              Integrations
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'claude' ? 'active' : ''}`}
              onClick={() => setActiveTab('claude')}
            >
              Claude
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'permissions' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('permissions');
                window.electronAPI.getPermissionRules().then(setPermissionRules).catch(() => {});
              }}
            >
              Permissions
            </button>
          </nav>

          <div className="settings-content">
            {error && (
              <div className="settings-error-banner" role="alert">
                {error}
                <button onClick={() => setError(null)} aria-label="Dismiss error">&times;</button>
              </div>
            )}
            {activeTab === 'general' && (
              <div className="settings-section">
                <h3>General Settings</h3>

                <div className="settings-group">
                  <h4>Sessions</h4>
                  <div className="settings-row">
                    <label htmlFor="preferred-editor">Preferred Editor:</label>
                    <select
                      id="preferred-editor"
                      className="settings-select"
                      value={preferredEditor}
                      onChange={e => handlePreferredEditorChange(e.target.value)}
                    >
                      <option value="">Auto-detect</option>
                      {editorOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="settings-hint">Editor to use when opening files from code search results</span>
                  </div>
                </div>

                <div className="settings-group">
                  <h4>System</h4>
                  <div className="settings-row">
                    <label htmlFor="close-to-tray">Close to Tray:</label>
                    <input
                      id="close-to-tray"
                      type="checkbox"
                      checked={closeToTray}
                      onChange={e => handleCloseToTrayChange(e.target.checked)}
                    />
                    <span className="settings-hint">Minimize to system tray instead of quitting when closing window</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="settings-section">
                <h3>Appearance</h3>

                <div className="settings-group">
                  <h4>Splash Screen</h4>
                  <div className="settings-row">
                    <label htmlFor="show-splash">Show Splash Screen:</label>
                    <input
                      id="show-splash"
                      type="checkbox"
                      checked={showSplash}
                      onChange={e => handleShowSplashChange(e.target.checked)}
                    />
                    <span className="settings-hint">Display splash screen on startup</span>
                  </div>

                  <div className="settings-row">
                    <label htmlFor="splash-duration">Splash Duration:</label>
                    <input
                      type="range"
                      id="splash-duration"
                      min="1"
                      max="5"
                      step="0.5"
                      value={splashDuration}
                      onChange={e => handleSplashDurationChange(parseFloat(e.target.value))}
                    />
                    <span className="range-value">{splashDuration}s</span>
                  </div>
                </div>

                <div className="settings-group">
                  <h4>Chat</h4>
                  <div className="settings-row">
                    <label htmlFor="chat-font-size">Chat Font Size:</label>
                    <input
                      type="range"
                      id="chat-font-size"
                      min="10"
                      max="24"
                      step="1"
                      value={chatFontSize}
                      onChange={e => handleChatFontSizeChange(parseInt(e.target.value, 10))}
                    />
                    <span className="range-value">{chatFontSize}px</span>
                  </div>

                  <div className="settings-row">
                    <label htmlFor="show-thinking">Show Thinking Blocks:</label>
                    <input
                      id="show-thinking"
                      type="checkbox"
                      checked={showThinking}
                      onChange={e => handleShowThinkingChange(e.target.checked)}
                    />
                    <span className="settings-hint">Show Claude's thinking process in chat</span>
                  </div>

                  <div className="settings-row">
                    <label htmlFor="send-shortcut">Send Shortcut:</label>
                    <select
                      id="send-shortcut"
                      className="settings-select"
                      value={sendShortcut}
                      onChange={e => handleSendShortcutChange(e.target.value)}
                    >
                      <option value="ctrl+enter">Ctrl+Enter</option>
                      <option value="enter">Enter (Shift+Enter for newline)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'integrations' && (
              <div className="settings-section">
                <h3>Integrations</h3>
                <p className="settings-description">
                  Connect external services to receive notifications and share sessions.
                </p>

                <div className="settings-group integration-card">
                  <div className="integration-header">
                    <span className={`integration-status-dot ${githubUser ? 'connected' : ''}`} />
                    <h4>GitHub</h4>
                  </div>
                  <p className="integration-status">
                    {githubUser ? `Connected as ${githubUser.username}` : 'Not connected'}
                  </p>
                  <p className="settings-hint">Used for: Session sharing</p>
                  <div className="settings-actions">
                    {githubUser ? (
                      <button
                        className="btn btn-danger"
                        onClick={handleGitHubLogout}
                        disabled={githubLoading}
                      >
                        {githubLoading ? 'Signing Out...' : 'Sign Out'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={handleGitHubLogin}
                        disabled={githubLoading}
                      >
                        {githubLoading ? 'Signing In...' : 'Sign In'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-group integration-card disabled">
                  <div className="integration-header">
                    <span className="integration-status-dot" />
                    <h4>Microsoft Teams</h4>
                  </div>
                  <p className="integration-status">Coming Soon</p>
                  <p className="settings-hint">Used for: Notifications</p>
                  <div className="settings-actions">
                    <button className="btn btn-secondary" disabled>
                      Coming Soon
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'mobile' && (
              <div className="settings-section">
                <h3>Mobile Companion App</h3>
                <p className="settings-description">
                  Enable the local API server to connect the ClaudeLander mobile app.
                  Your mobile device must be on the same network.
                </p>

                <div className="settings-group">
                  <h4>API Server</h4>
                  <div className="settings-row">
                    <label>Status:</label>
                    <span className={`api-status ${apiStatus.running ? 'running' : 'stopped'}`}>
                      {apiStatus.running ? `Running on ${apiStatus.addresses?.[0] ?? 'localhost'}:${apiStatus.port}` : 'Stopped'}
                    </span>
                  </div>

                  {!apiStatus.running && (
                    <>
                      <div className="settings-row">
                        <label htmlFor="api-port">Port:</label>
                        <input
                          id="api-port"
                          type="number"
                          value={port}
                          onChange={e => setPort(parseInt(e.target.value) || 8443)}
                          min={1024}
                          max={65535}
                        />
                      </div>
                      <div className="settings-row">
                        <label htmlFor="api-mdns">Network Discovery:</label>
                        <input
                          id="api-mdns"
                          type="checkbox"
                          checked={enableMdns}
                          onChange={e => setEnableMdns(e.target.checked)}
                        />
                        <span className="settings-hint">Allow mobile app to find this computer automatically</span>
                      </div>
                    </>
                  )}

                  <div className="settings-actions">
                    {apiStatus.running ? (
                      <button
                        className="btn btn-danger"
                        onClick={handleStopServer}
                        disabled={loading}
                      >
                        {loading ? 'Stopping...' : 'Stop Server'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={handleStartServer}
                        disabled={loading}
                      >
                        {loading ? 'Starting...' : 'Start Server'}
                      </button>
                    )}
                  </div>
                </div>

                {apiStatus.running && (
                  <div className="settings-group">
                    <h4>Pair New Device</h4>
                    {pairingCode ? (
                      <div className="pairing-active">
                        <div className="pairing-qr">
                          <img
                            src={pairingCode.qrCode}
                            alt="Scan with mobile app"
                            width={200}
                            height={200}
                          />
                        </div>
                        <div className="pairing-code">
                          <span>Code: </span>
                          <strong>{pairingCode.code}</strong>
                        </div>
                        <p className="pairing-hint">
                          Scan this QR code with the ClaudeLander mobile app, or enter the code manually.
                        </p>
                        <button className="btn btn-secondary" onClick={handleCancelPairing}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="pairing-start">
                        <p>Generate a pairing code to connect a new mobile device.</p>
                        <button className="btn btn-primary" onClick={handleGeneratePairingCode}>
                          Generate Pairing Code
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="settings-group">
                  <h4>Paired Devices ({pairedDevices.length})</h4>
                  {pairedDevices.length === 0 ? (
                    <p className="settings-empty">No devices paired yet.</p>
                  ) : (
                    <div className="paired-devices-list">
                      {pairedDevices.map(device => (
                        <div key={device.id} className="paired-device">
                          <div className="device-info">
                            <span className="device-name">{device.name}</span>
                            <span className="device-platform">{device.platform}</span>
                            <span className="device-last-used">
                              Last used: {new Date(device.lastUsedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="device-permissions">
                            <label>
                              <input
                                type="checkbox"
                                checked={device.canControl}
                                onChange={e =>
                                  handleUpdatePermissions(device.id, { canControl: e.target.checked })
                                }
                              />
                              Control
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={device.canModify}
                                onChange={e =>
                                  handleUpdatePermissions(device.id, { canModify: e.target.checked })
                                }
                              />
                              Modify
                            </label>
                          </div>
                          <button
                            className="btn btn-danger btn-small"
                            onClick={() => handleUnpairDevice(device.id)}
                          >
                            Unpair
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="settings-group">
                  <h4>Remote Access</h4>
                  <p className="settings-description">
                    Enable remote access to connect from outside your local network via the relay server.
                  </p>

                  <div className="settings-row">
                    <label>Status:</label>
                    <span className={`remote-status ${remoteStatus.connected ? 'connected' : remoteStatus.enabled ? 'connecting' : 'disabled'}`}>
                      {remoteStatus.connected
                        ? 'Connected to relay'
                        : remoteStatus.enabled
                        ? 'Connecting...'
                        : 'Disabled'}
                    </span>
                  </div>

                  {remoteStatus.enabled && remoteStatus.desktopId && (
                    <div className="settings-row">
                      <label>Desktop ID:</label>
                      <code className="desktop-id">{remoteStatus.desktopId}</code>
                    </div>
                  )}

                  {remoteStatus.enabled && remoteStatus.relayUrl && (
                    <div className="settings-row">
                      <label>Relay Server:</label>
                      <span className="relay-url">{remoteStatus.relayUrl}</span>
                    </div>
                  )}

                  <div className="settings-actions">
                    {remoteStatus.enabled ? (
                      <button
                        className="btn btn-danger"
                        onClick={handleDisableRemoteAccess}
                        disabled={remoteLoading}
                      >
                        {remoteLoading ? 'Disabling...' : 'Disable Remote Access'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={handleEnableRemoteAccess}
                        disabled={remoteLoading}
                      >
                        {remoteLoading ? 'Enabling...' : 'Enable Remote Access'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'sound' && (
              <div className="settings-section">
                <h3>Sound Settings</h3>

                <div className="settings-group">
                  <h4>Desktop Notifications</h4>
                  <div className="settings-row">
                    <label htmlFor="enable-notifications">Enable Notifications:</label>
                    <input
                      id="enable-notifications"
                      type="checkbox"
                      checked={enableNotifications}
                      onChange={e => handleEnableNotificationsChange(e.target.checked)}
                    />
                    <span className="settings-hint">Show system notifications when sessions need attention</span>
                  </div>
                </div>

                <div className="settings-group">
                  <div className="settings-row">
                    <label htmlFor="sound-enabled">Enable Sounds:</label>
                    <input
                      id="sound-enabled"
                      type="checkbox"
                      checked={soundEnabled}
                      onChange={e => handleSoundEnabledChange(e.target.checked)}
                    />
                  </div>
                </div>

                {soundEnabled && (
                  <>
                    <div className="settings-group">
                      <h4>Sound Frequency</h4>
                      <p className="settings-description">
                        Controls how rapidly sounds can play when states change quickly.
                      </p>
                      <div className="settings-row">
                        <label htmlFor="debounce-preset">Preset:</label>
                        <select
                          id="debounce-preset"
                          value={debouncePreset}
                          onChange={e => handleDebouncePresetChange(e.target.value as 'fast' | 'normal' | 'relaxed')}
                        >
                          <option value="fast">Fast (200ms)</option>
                          <option value="normal">Normal (500ms) - Recommended</option>
                          <option value="relaxed">Relaxed (1000ms)</option>
                        </select>
                      </div>
                    </div>

                    <div className="settings-group">
                      <h4>Master Volume</h4>
                      <div className="settings-row volume-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={soundVolume}
                          onChange={e => handleVolumeChange(parseInt(e.target.value, 10))}
                        />
                        <span className="volume-value">{soundVolume}%</span>
                      </div>
                    </div>

                    <div className="settings-group">
                      <h4>Individual Sounds</h4>
                      <div className="sound-events-list">
                        {[
                          { event: 'waiting' as const, label: 'Waiting for Input', enabled: soundWaitingEnabled },
                          { event: 'error' as const, label: 'Error', enabled: soundErrorEnabled },
                          { event: 'start' as const, label: 'Session Start', enabled: soundStartEnabled },
                          { event: 'complete' as const, label: 'Task Complete', enabled: soundCompleteEnabled },
                        ].map(({ event, label, enabled }) => (
                          <div key={event} className="sound-event-row">
                            <span className="sound-event-label">{label}</span>
                            <label className="sound-event-toggle">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={e => handleSoundToggle(event, e.target.checked)}
                              />
                              <span>{enabled ? 'On' : 'Off'}</span>
                            </label>
                            <button
                              className="btn btn-small btn-secondary"
                              onClick={() => handleTestSound(event)}
                              disabled={!enabled}
                            >
                              Test
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'claude' && (
              <div className="settings-section">
                <h3>Claude Defaults</h3>
                <p className="settings-hint" style={{ marginBottom: '12px' }}>
                  Default settings for new sessions. Groups and individual sessions can override these.
                </p>
                <SessionSettingsBar
                  config={claudeDefaults}
                  onChange={handleClaudeDefaultsChange}
                />
              </div>
            )}

            {activeTab === 'permissions' && (
              <div className="settings-section">
                <h3>Permission Rules</h3>
                <p className="settings-hint" style={{ marginBottom: '12px' }}>
                  Saved tool approval decisions. These auto-resolve permission prompts without asking.
                </p>

                {permissionRules.length === 0 ? (
                  <p className="settings-hint">No saved permission rules. Rules are created when you approve or deny tool calls in the chat.</p>
                ) : (
                  <>
                    <table className="permission-rules-table">
                      <thead>
                        <tr>
                          <th>Decision</th>
                          <th>Tool Pattern</th>
                          <th>Scope</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {permissionRules.map((rule: any) => (
                          <tr key={rule.id}>
                            <td>
                              <span className={`permission-decision ${rule.decision}`}>
                                {rule.decision}
                              </span>
                            </td>
                            <td><code>{rule.toolPattern}</code></td>
                            <td>{rule.scope}{rule.scopeId ? ` (${rule.scopeId.substring(0, 8)})` : ''}</td>
                            <td>
                              <button
                                className="permission-rule-delete"
                                onClick={async () => {
                                  await window.electronAPI.deletePermissionRule(rule.id);
                                  setPermissionRules(prev => prev.filter((r: any) => r.id !== rule.id));
                                }}
                                title="Delete rule"
                              >
                                &times;
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <button
                      className="permission-clear-all"
                      onClick={async () => {
                        await window.electronAPI.clearPermissionRules();
                        setPermissionRules([]);
                      }}
                      style={{ marginTop: '12px' }}
                    >
                      Clear All Rules
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
