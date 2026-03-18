import React from 'react';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { SystemMessage } from './SystemMessage';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  messageType: string;
  toolCalls?: any[] | null;
  toolResults?: any[] | null;
  thinking?: string | null;
  createdAt: Date;
  isStreaming?: boolean;
}

interface ChatMessageProps {
  message: ChatMessageData;
  onSaveAsKnowledge?: (content: string) => void;
  onFork?: (messageId: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onSaveAsKnowledge, onFork }) => {
  switch (message.role) {
    case 'user':
      return <UserMessage message={message} />;
    case 'assistant':
      return <AssistantMessage message={message} onSaveAsKnowledge={onSaveAsKnowledge} onFork={onFork} />;
    case 'system':
    case 'error':
      return <SystemMessage message={message} />;
    default:
      return null;
  }
};
