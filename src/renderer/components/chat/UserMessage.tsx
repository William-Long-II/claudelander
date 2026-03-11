import React from 'react';
import type { ChatMessageData } from './ChatMessage';

interface Props {
  message: ChatMessageData;
}

export const UserMessage: React.FC<Props> = ({ message }) => {
  return (
    <div className="chat-message user-message">
      <div className="message-avatar">You</div>
      <div className="message-body">
        <div className="message-content">{message.content}</div>
        <div className="message-time">
          {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};
