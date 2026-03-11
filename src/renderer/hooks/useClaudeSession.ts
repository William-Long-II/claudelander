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
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<any[]>([]);
  const contentRef = useRef('');
  const thinkingRef = useRef('');

  // Load saved messages from database on session change
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    // Load from DB via IPC
    // window.electronAPI.getMessagesBySession(sessionId).then(setMessages);
  }, [sessionId]);

  // Subscribe to Claude events
  useEffect(() => {
    if (!sessionId) return;

    const unsubEvent = window.electronAPI.onClaudeEvent((sid: string, event: any) => {
      if (sid !== sessionId) return;

      switch (event.type) {
        case 'message_start':
          contentRef.current = '';
          thinkingRef.current = '';
          setStreamingContent('');
          setStreamingThinking('');
          setStreamingToolCalls([]);
          setIsRunning(true);
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            contentRef.current += event.delta.text;
            setStreamingContent(contentRef.current);
          } else if (event.delta?.type === 'thinking_delta') {
            thinkingRef.current += event.delta.thinking;
            setStreamingThinking(thinkingRef.current);
          }
          break;

        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            setStreamingToolCalls(prev => [...prev, {
              name: event.content_block.name,
              id: event.content_block.id,
              input: {},
            }]);
          }
          break;

        case 'message_stop':
          // Finalize the message
          const finalMessage: ChatMessageData = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: contentRef.current,
            messageType: 'text',
            thinking: thinkingRef.current || null,
            toolCalls: streamingToolCalls.length > 0 ? streamingToolCalls : null,
            createdAt: new Date(),
            isStreaming: false,
          };
          setMessages(prev => [...prev, finalMessage]);
          setStreamingContent('');
          setStreamingThinking('');
          setStreamingToolCalls([]);
          setIsRunning(false);

          // Save to DB
          // window.electronAPI.createChatMessage(finalMessage);
          break;
      }
    });

    const unsubState = window.electronAPI.onClaudeStateChange((sid: string, s: any) => {
      if (sid !== sessionId) return;
      setStatus(s);
    });

    const unsubEnded = window.electronAPI.onClaudeEnded((sid: string) => {
      if (sid !== sessionId) return;
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
    // window.electronAPI.createChatMessage(userMsg);

    // Send to Claude
    if (messages.length === 0) {
      // First message — start new session
      const session = await window.electronAPI.getAllSessions();
      const sess = session.find((s: any) => s.id === sessionId);
      await window.electronAPI.claudeStart(sessionId, sess?.workingDir || '.', content);
    } else {
      // Follow-up — resume
      await window.electronAPI.claudeSend(sessionId, content);
    }
  }, [sessionId, messages]);

  const stopSession = useCallback(() => {
    if (sessionId) {
      window.electronAPI.claudeKill(sessionId);
    }
  }, [sessionId]);

  // Build the streaming message for display
  const currentStreamingMessage: ChatMessageData | null = isRunning && streamingContent
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
  };
}
