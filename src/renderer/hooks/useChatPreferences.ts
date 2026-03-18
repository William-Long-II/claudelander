import { useState, useEffect } from 'react';

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

export function useChatPreferences(): ChatPreferences {
  const [prefs, setPrefs] = useState<ChatPreferences>(DEFAULTS);

  useEffect(() => {
    const load = async () => {
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
    };
    load();
  }, []);

  return prefs;
}
