import React, { useState, useRef, useEffect } from 'react';

interface Props {
  onCodeSearch: () => void;
  onChatSearch: () => void;
  onTemplates: () => void;
  onSettings: () => void;
  onJoinSession: () => void;
  isAuthenticated: boolean;
}

export const SidebarOverflowMenu: React.FC<Props> = ({
  onCodeSearch,
  onChatSearch,
  onTemplates,
  onSettings,
  onJoinSession,
  isAuthenticated,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <div className="sidebar-overflow" ref={menuRef}>
      <button
        className="sidebar-icon-btn"
        onClick={() => setIsOpen(prev => !prev)}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
        </svg>
      </button>

      {isOpen && (
        <div className="sidebar-overflow-dropdown" role="menu">
          <button role="menuitem" onClick={() => handleAction(onCodeSearch)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04z"/>
            </svg>
            <span>Code Search</span>
            <span className="menu-shortcut">Ctrl+Shift+F</span>
          </button>
          <button role="menuitem" onClick={() => handleAction(onChatSearch)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v8A1.5 1.5 0 0 0 2.5 13h3.025l2.196 1.758A.75.75 0 0 0 9 14.25V13h4.5A1.5 1.5 0 0 0 15 11.5v-8A1.5 1.5 0 0 0 13.5 2h-11z"/>
            </svg>
            <span>Chat Search</span>
            <span className="menu-shortcut">Ctrl+Shift+H</span>
          </button>

          <div className="menu-divider" role="separator" />

          <button role="menuitem" onClick={() => handleAction(onTemplates)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zM3.5 3a.5.5 0 0 0-.5.5V5h10V3.5a.5.5 0 0 0-.5-.5h-9zM13 6H3v6.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V6z"/>
            </svg>
            <span>Templates</span>
          </button>
          <button
            role="menuitem"
            onClick={() => handleAction(onJoinSession)}
            disabled={!isAuthenticated}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5v1A1.5 1.5 0 0 1 8.5 6h-1A1.5 1.5 0 0 1 6 4.5v-1zm-4 8A1.5 1.5 0 0 1 3.5 10h1A1.5 1.5 0 0 1 6 11.5v1A1.5 1.5 0 0 1 4.5 14h-1A1.5 1.5 0 0 1 2 12.5v-1zm8 0a1.5 1.5 0 0 1 1.5-1.5h1a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-1z"/>
            </svg>
            <span>Join Session</span>
          </button>

          <div className="menu-divider" role="separator" />

          <button role="menuitem" onClick={() => handleAction(onSettings)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319z"/>
            </svg>
            <span>Settings</span>
          </button>
        </div>
      )}
    </div>
  );
};
