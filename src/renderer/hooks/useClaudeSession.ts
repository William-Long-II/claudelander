import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessageData } from '../components/chat/ChatMessage';

interface UseClaudeSessionOptions {
  sessionId: string | null;
  onKnowledgeSuggestion?: (content: string) => void;
}

export function useClaudeSession({ sessionId, onKnowledgeSuggestion }: UseClaudeSessionOptions) {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<any[]>([]);
  const contentRef = useRef('');
  const thinkingRef = useRef('');
  const toolCallsRef = useRef<any[]>([]);
  // Buffer for accumulating tool input JSON from partial deltas
  const toolInputBufferRef = useRef('');
  // Track whether we're in a multi-turn tool-use flow (don't finalize mid-turn)
  const pendingToolUseRef = useRef(false);
  const lastUserContentRef = useRef('');

  // Load saved messages from database on session change or branch switch
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      try {
        let dbMessages;
        if (currentBranchId) {
          dbMessages = await window.electronAPI.chatGetMessagesByBranch(currentBranchId);
        } else {
          dbMessages = await window.electronAPI.chatGetMessages(sessionId);
        }
        if (dbMessages && dbMessages.length > 0) {
          setMessages(dbMessages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            messageType: m.messageType,
            thinking: m.thinking || null,
            toolCalls: m.toolCalls || null,
            createdAt: new Date(m.createdAt),
            isStreaming: false,
          })));
        } else {
          setMessages([]);
        }
      } catch {
        setMessages([]);
      }
    };
    loadMessages();
  }, [sessionId, currentBranchId]);

  // Subscribe to Claude events
  useEffect(() => {
    if (!sessionId) return;

    const unsubEvent = window.electronAPI.onClaudeEvent((sid: string, event: any) => {
      if (sid !== sessionId) return;

      switch (event.type) {
        case 'message_start':
          // Only reset refs on the FIRST message_start of a turn.
          // When tool_use triggers a new message, keep accumulating.
          if (!pendingToolUseRef.current) {
            contentRef.current = '';
            thinkingRef.current = '';
            toolCallsRef.current = [];
            setStreamingContent('');
            setStreamingThinking('');
            setStreamingToolCalls([]);
          } else {
            // Tool-use continuation: add separator so follow-up text
            // doesn't smash into the previous text without spacing.
            if (contentRef.current) {
              contentRef.current += '\n';
            }
          }
          pendingToolUseRef.current = false;
          setIsRunning(true);
          break;

        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            const newTool = {
              name: event.content_block.name,
              id: event.content_block.id,
              input: {},
            };
            toolCallsRef.current = [...toolCallsRef.current, newTool];
            toolInputBufferRef.current = '';
            setStreamingToolCalls([...toolCallsRef.current]);
          }
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            contentRef.current += event.delta.text;
            setStreamingContent(contentRef.current);
          } else if (event.delta?.type === 'thinking_delta') {
            thinkingRef.current += event.delta.thinking;
            setStreamingThinking(thinkingRef.current);
          } else if (event.delta?.type === 'input_json_delta') {
            // Accumulate tool input JSON
            toolInputBufferRef.current += event.delta.partial_json || '';
          }
          break;

        case 'content_block_stop': {
          // If we were building a tool input, parse and attach it
          if (toolInputBufferRef.current && toolCallsRef.current.length > 0) {
            const lastTool = toolCallsRef.current[toolCallsRef.current.length - 1];
            try {
              lastTool.input = JSON.parse(toolInputBufferRef.current);
            } catch {
              // Partial JSON that didn't complete — store raw
              lastTool.input = { _raw: toolInputBufferRef.current };
            }
            toolCallsRef.current = [...toolCallsRef.current];
            setStreamingToolCalls([...toolCallsRef.current]);
          }
          toolInputBufferRef.current = '';
          break;
        }

        case 'message_delta':
          if (event.delta?.stop_reason === 'tool_use') {
            // Claude wants to use tools — the CLI will execute them and
            // send a follow-up message. Mark as pending so we don't reset.
            pendingToolUseRef.current = true;
          }
          break;

        case 'message_stop': {
          // If tool use is pending, don't finalize — more content coming
          if (pendingToolUseRef.current) {
            break;
          }

          // Finalize the message using refs (not stale state)
          const finalContent = contentRef.current.trim();
          const finalThinking = thinkingRef.current.trim() || null;

          // Guard against empty message_stop events
          if (!finalContent && !finalThinking && toolCallsRef.current.length === 0) {
            setIsRunning(false);
            break;
          }

          const finalMessage: ChatMessageData = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: finalContent,
            messageType: 'text',
            thinking: finalThinking,
            toolCalls: toolCallsRef.current.length > 0 ? toolCallsRef.current : null,
            createdAt: new Date(),
            isStreaming: false,
          };
          setMessages(prev => [...prev, finalMessage]);

          // Clear refs so onClaudeEnded doesn't duplicate
          contentRef.current = '';
          thinkingRef.current = '';
          toolCallsRef.current = [];
          setStreamingContent('');
          setStreamingThinking('');
          setStreamingToolCalls([]);
          setIsRunning(false);

          // Save to DB
          window.electronAPI.chatCreateMessage({
            id: finalMessage.id,
            sessionId: sid,
            role: 'assistant',
            content: finalMessage.content,
            messageType: 'text',
            toolCalls: finalMessage.toolCalls,
            thinking: finalMessage.thinking,
          });

          // Auto-extract knowledge from the exchange
          if (lastUserContentRef.current && finalContent) {
            window.electronAPI.knowledgeExtractFromChat(
              lastUserContentRef.current,
              finalContent,
              sid,
            ).catch(err => console.warn('Knowledge extraction failed:', err));
          }
          break;
        }
      }
    });

    const unsubState = window.electronAPI.onClaudeStateChange((sid: string, s: any) => {
      if (sid !== sessionId) return;
      setStatus(s);
    });

    const unsubEnded = window.electronAPI.onClaudeEnded((sid: string) => {
      if (sid !== sessionId) return;

      // Process ended — finalize any remaining content that wasn't
      // captured by message_stop (e.g. if tool use was still pending)
      const finalContent = contentRef.current.trim();
      const finalThinking = thinkingRef.current.trim() || null;
      if (finalContent || finalThinking || toolCallsRef.current.length > 0) {
        const finalMessage: ChatMessageData = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: finalContent,
          messageType: 'text',
          thinking: finalThinking,
          toolCalls: toolCallsRef.current.length > 0 ? toolCallsRef.current : null,
          createdAt: new Date(),
          isStreaming: false,
        };
        setMessages(prev => [...prev, finalMessage]);

        window.electronAPI.chatCreateMessage({
          id: finalMessage.id,
          sessionId: sid,
          role: 'assistant',
          content: finalMessage.content,
          messageType: 'text',
          toolCalls: finalMessage.toolCalls,
          thinking: finalMessage.thinking,
        });
      }

      contentRef.current = '';
      thinkingRef.current = '';
      toolCallsRef.current = [];
      pendingToolUseRef.current = false;
      lastUserContentRef.current = '';
      setStreamingContent('');
      setStreamingThinking('');
      setStreamingToolCalls([]);
      setIsRunning(false);
    });

    return () => {
      unsubEvent();
      unsubState();
      unsubEnded();
    };
  }, [sessionId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId || !content.trim()) return;
    lastUserContentRef.current = content;

    // Add user message
    const userMsg: ChatMessageData = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      messageType: 'text',
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Save to DB
    window.electronAPI.chatCreateMessage({
      id: userMsg.id,
      sessionId,
      role: 'user',
      content,
      messageType: 'text',
    });

    // Send to Claude — check if session exists in memory (survives DB reload but not app restart)
    const hasSession = await window.electronAPI.claudeHasSession(sessionId);
    if (hasSession) {
      // Session exists in manager — resume
      await window.electronAPI.claudeSend(sessionId, content);
    } else {
      // No in-memory session — start new one
      const allSessions = await window.electronAPI.getAllSessions();
      const sess = allSessions.find((s: any) => s.id === sessionId);
      await window.electronAPI.claudeStart(sessionId, sess?.workingDir || '.', content);
    }
  }, [sessionId]);

  const stopSession = useCallback(() => {
    if (sessionId) {
      window.electronAPI.claudeKill(sessionId);
    }
  }, [sessionId]);

  const switchBranch = useCallback((branchId: string | null) => {
    setCurrentBranchId(branchId);
  }, []);

  // Build the streaming message for display
  const currentStreamingMessage: ChatMessageData | null = isRunning && (streamingContent || streamingToolCalls.length > 0)
    ? {
        id: 'streaming',
        role: 'assistant',
        content: streamingContent,
        messageType: 'text',
        thinking: streamingThinking || null,
        toolCalls: streamingToolCalls.length > 0 ? streamingToolCalls : null,
        createdAt: new Date(),
        isStreaming: true,
      }
    : null;

  return {
    messages,
    isRunning,
    status,
    currentStreamingMessage,
    sendMessage,
    stopSession,
    currentBranchId,
    switchBranch,
  };
}
