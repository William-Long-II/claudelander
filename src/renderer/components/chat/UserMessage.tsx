import React from 'react';
import type { ChatMessageData } from './ChatMessage';

interface Props {
  message: ChatMessageData;
}

function parseSkillMessage(content: string): { skillId: string; args: string } | null {
  const match = content.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { skillId: match[1], args: (match[2] || '').trim() };
}

export const UserMessage: React.FC<Props> = ({ message }) => {
  const skill = parseSkillMessage(message.content);

  return (
    <div className="chat-message user-message">
      <div className="message-avatar">You</div>
      <div className="message-body">
        <div className="message-content">
          {skill ? (
            <>
              <span className="skill-invocation-tag">/{skill.skillId}</span>
              {skill.args && <span className="skill-invocation-args"> {skill.args}</span>}
              {!skill.args && <span className="skill-invocation-noargs">Running skill...</span>}
            </>
          ) : (
            message.content
          )}
        </div>
        <div className="message-time">
          {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};
