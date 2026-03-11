import React, { useState } from 'react';

interface Props {
  content: string;
}

export const ThinkingBlock: React.FC<Props> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="thinking-block">
      <button
        className="thinking-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="thinking-icon">Thinking</span>
        <span className={`thinking-chevron ${expanded ? 'expanded' : ''}`}>
          {expanded ? 'v' : '>'}
        </span>
      </button>
      {expanded && (
        <div className="thinking-content">
          {content}
        </div>
      )}
    </div>
  );
};
