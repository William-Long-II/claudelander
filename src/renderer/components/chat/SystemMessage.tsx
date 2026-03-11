import React from 'react';
import type { ChatMessageData } from './ChatMessage';

interface Props {
  message: ChatMessageData;
}

export const SystemMessage: React.FC<Props> = ({ message }) => {
  const isError = message.role === 'error';

  return (
    <div className={`chat-message system-message ${isError ? 'error' : ''}`}>
      <div className="system-content">
        {isError && <span className="error-icon">!</span>}
        {message.content}
      </div>
    </div>
  );
};
