import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onNewSession: () => void;
  onNextSession: () => void;
  onPrevSession: () => void;
  onNextWaiting: () => void;
  onCloseSession: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key === 'n') {
      e.preventDefault();
      handlers.onNewSession();
    }

    if (isMod && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        handlers.onPrevSession();
      } else {
        handlers.onNextSession();
      }
    }

    if (isMod && e.shiftKey && e.key === 'W') {
      e.preventDefault();
      handlers.onNextWaiting();
    }

    if (isMod && e.key === 'w') {
      e.preventDefault();
      handlers.onCloseSession();
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
