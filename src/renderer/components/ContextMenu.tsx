import React, { useEffect, useRef, useCallback } from 'react';
import '../styles/context-menu.css';

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Auto-focus first menu item on mount
  useEffect(() => {
    if (menuRef.current) {
      const firstItem = menuRef.current.querySelector<HTMLElement>('button[role="menuitem"]:not([disabled])');
      firstItem?.focus();
    }
  }, []);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
  }, [x, y]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const menuItems = menuRef.current?.querySelectorAll<HTMLElement>('button[role="menuitem"]:not([disabled])');
    if (!menuItems || menuItems.length === 0) return;

    const currentIndex = Array.from(menuItems).findIndex(item => item === document.activeElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex].focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[prevIndex].focus();
        break;
      }
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Home': {
        e.preventDefault();
        menuItems[0].focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        menuItems[menuItems.length - 1].focus();
        break;
      }
    }
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => (
        item.separator ? (
          <div key={index} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={index}
            className={`context-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            role="menuitem"
          >
            {item.label}
          </button>
        )
      ))}
    </div>
  );
};

export default ContextMenu;
