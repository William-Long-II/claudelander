import { useState, useEffect, useCallback } from 'react';

interface ChatPreferences {
  chatFontSize: number;
  showThinking: boolean;
  sendShortcut: 'ctrl+enter' | 'enter';
}

const DEFAULTS: ChatPreferences = {
  chatFontSize: 14,
  showThinking: true,
  sendShortcut: 'ctrl+enter',
};

// Simple event bus for preference changes
const listeners = new Set<() => void>();
export function notifyChatPreferencesChanged(): void {
  listeners.forEach(fn => fn());
}

export function useChatPreferences(): ChatPreferences {
  const [prefs, setPrefs] = useState<ChatPreferences>(DEFAULTS);

  const load = useCallback(async () => {
    try {
      const [fontSize, showThinking, sendShortcut] = await Promise.all([
        window.electronAPI.getPreference('chatFontSize'),
        window.electronAPI.getPreference('showThinking'),
        window.electronAPI.getPreference('sendShortcut'),
      ]);
      setPrefs({
        chatFontSize: fontSize ? parseInt(fontSize, 10) : DEFAULTS.chatFontSize,
        showThinking: showThinking !== 'false',
        sendShortcut: (sendShortcut === 'enter' ? 'enter' : 'ctrl+enter') as ChatPreferences['sendShortcut'],
      });
    } catch {
      // Use defaults
    }
  }, []);

  useEffect(() => {
    load();
    listeners.add(load);
    return () => { listeners.delete(load); };
  }, [load]);

  return prefs;
}
