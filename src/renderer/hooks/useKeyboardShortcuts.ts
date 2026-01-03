import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onNewSession: () => void;
  onNextSession: () => void;
  onPrevSession: () => void;
  onNextWaiting: () => void;
  onCloseSession: () => void;
  onFocusSidebar: () => void;
  onNewGroup: () => void;
  onNewSubGroup?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onCollapse?: () => void;
  onExpand?: () => void;
  onSelect?: () => void;
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

    // Ctrl+Q = Focus sidebar
    if (isMod && e.key === 'q') {
      e.preventDefault();
      handlers.onFocusSidebar();
    }

    // Ctrl+G = New group
    if (isMod && !e.shiftKey && e.key === 'g') {
      e.preventDefault();
      handlers.onNewGroup();
    }

    // Ctrl+Shift+G = New sub-group
    if (isMod && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      handlers.onNewSubGroup?.();
    }

    // Arrow keys (for sidebar navigation)
    if (e.key === 'ArrowUp') {
      handlers.onNavigateUp?.();
    }
    if (e.key === 'ArrowDown') {
      handlers.onNavigateDown?.();
    }
    if (e.key === 'ArrowLeft') {
      handlers.onCollapse?.();
    }
    if (e.key === 'ArrowRight') {
      handlers.onExpand?.();
    }
    if (e.key === 'Enter' && handlers.onSelect) {
      handlers.onSelect();
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
