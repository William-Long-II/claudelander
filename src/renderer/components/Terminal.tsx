import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import '../styles/terminal.css';

interface TerminalProps {
  sessionId: string;
  cwd: string;
  launchClaude?: boolean;
  isStopped?: boolean;
  onStart?: () => void;
  onError?: (error: string) => void;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  hasSelection: boolean;
}

const Terminal: React.FC<TerminalProps> = ({ sessionId, cwd, launchClaude = true, isStopped = false, onStart, onError }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isRunning, setIsRunning] = useState(!isStopped);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, hasSelection: false });
  const [error, setError] = useState<string | null>(null);

  // Copy text from terminal selection
  const handleCopy = useCallback(() => {
    const term = xtermRef.current;
    if (term) {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  // Paste text into terminal
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        window.electronAPI.writeToSession(sessionId, text);
      }
    } catch (err) {
      console.error('Failed to paste:', err);
    }
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, [sessionId]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const term = xtermRef.current;
    const hasSelection = term ? term.getSelection().length > 0 : false;
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      hasSelection,
    });
  }, []);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, visible: false }));
    if (contextMenu.visible) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu.visible]);

  useEffect(() => {
    if (!terminalRef.current || !isRunning) return;

    const term = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Create PTY session with error handling
    window.electronAPI.createSession(sessionId, cwd, launchClaude)
      .catch((err) => {
        const errorMsg = err?.message || 'Failed to start session';
        console.error('Failed to create PTY session:', err);
        setError(errorMsg);
        onError?.(errorMsg);
      });

    // Handle PTY data
    const cleanupPtyData = window.electronAPI.onPtyData((id, data) => {
      if (id === sessionId) {
        term.write(data);
      }
    });

    // Handle keyboard shortcuts for copy/paste
    term.attachCustomKeyEventHandler((event) => {
      // Ctrl+Shift+C = Copy
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
        return false; // Prevent default
      }
      // Ctrl+Shift+V = Paste
      if (event.ctrlKey && event.shiftKey && event.key === 'V') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            window.electronAPI.writeToSession(sessionId, text);
          }
        });
        return false; // Prevent default
      }
      return true; // Allow other keys through
    });

    // Handle user input
    term.onData((data) => {
      window.electronAPI.writeToSession(sessionId, data);
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      const { cols, rows } = term;
      window.electronAPI.resizeSession(sessionId, cols, rows);
    };

    window.addEventListener('resize', handleResize);

    // Initial resize
    setTimeout(() => {
      fitAddon.fit();
      const { cols, rows } = term;
      window.electronAPI.resizeSession(sessionId, cols, rows);
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      cleanupPtyData();
      window.electronAPI.killSession(sessionId);
      term.dispose();
    };
  }, [sessionId, cwd, launchClaude, isRunning]);

  const handleStart = () => {
    setError(null);
    setIsRunning(true);
    onStart?.();
  };

  const handleRetry = () => {
    setError(null);
    setIsRunning(false);
    // Small delay then restart
    setTimeout(() => {
      setIsRunning(true);
      onStart?.();
    }, 100);
  };

  if (error) {
    return (
      <div className="terminal-error">
        <div className="error-icon">!</div>
        <p className="error-title">Session Error</p>
        <p className="error-message">{error}</p>
        <div className="error-actions">
          <button onClick={handleRetry}>Retry</button>
        </div>
      </div>
    );
  }

  if (!isRunning) {
    return (
      <div className="terminal-stopped">
        <p>Session stopped</p>
        <button onClick={handleStart}>Start Session</button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={terminalRef}
        className="terminal-container"
        onContextMenu={handleContextMenu}
      />
      {contextMenu.visible && (
        <div
          className="terminal-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button
            onClick={handleCopy}
            disabled={!contextMenu.hasSelection}
            className={!contextMenu.hasSelection ? 'disabled' : ''}
          >
            Copy
            <span className="shortcut">Ctrl+Shift+C</span>
          </button>
          <button onClick={handlePaste}>
            Paste
            <span className="shortcut">Ctrl+Shift+V</span>
          </button>
        </div>
      )}
    </>
  );
};

export default Terminal;
