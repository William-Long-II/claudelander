import React, { useState, useRef, useEffect, useCallback } from 'react';
import './Panel.css';

interface PanelTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface PanelProps {
  isOpen: boolean;
  onToggle: () => void;
  tabs?: PanelTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  title?: string;
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  position?: 'left' | 'right';
}

export const Panel: React.FC<PanelProps> = ({
  isOpen,
  onToggle,
  tabs,
  activeTab,
  onTabChange,
  title,
  children,
  defaultWidth = 320,
  minWidth = 250,
  maxWidth = 600,
  position = 'right',
}) => {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const delta = position === 'right'
        ? startXRef.current - e.clientX
        : e.clientX - startXRef.current;

      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, minWidth, maxWidth, position]);

  if (!isOpen) {
    return (
      <div className={`panel-collapsed panel-${position}`}>
        <button
          className="panel-toggle-button"
          onClick={onToggle}
          title={title || 'Open panel'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            {position === 'right' ? (
              <path d="M10.5 3L5.5 8L10.5 13" stroke="currentColor" strokeWidth="2" fill="none" />
            ) : (
              <path d="M5.5 3L10.5 8L5.5 13" stroke="currentColor" strokeWidth="2" fill="none" />
            )}
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`panel panel-${position} ${isResizing ? 'panel-resizing' : ''}`}
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className={`panel-resize-handle panel-resize-${position}`}
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="panel-header">
        <div className="panel-header-content">
          {tabs && tabs.length > 1 ? (
            <div className="panel-tabs">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  className={`panel-tab ${activeTab === tab.id ? 'panel-tab-active' : ''}`}
                  onClick={() => onTabChange?.(tab.id)}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <h3 className="panel-title">{title || tabs?.[0]?.label}</h3>
          )}
        </div>
        <button
          className="panel-close-button"
          onClick={onToggle}
          title="Close panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="panel-content">
        {children}
      </div>
    </div>
  );
};

export default Panel;
