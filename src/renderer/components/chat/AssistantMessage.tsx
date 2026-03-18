import React, { useState, useMemo } from 'react';
import { CodeBlock } from './CodeBlock';
import { ToolPanel } from './ToolPanel';
import { ThinkingBlock } from './ThinkingBlock';
import type { ChatMessageData } from './ChatMessage';

interface Props {
  message: ChatMessageData;
  onSaveAsKnowledge?: (content: string) => void;
  onFork?: (messageId: string) => void;
  showThinking?: boolean;
}

// Simple markdown rendering — parse code blocks, bold, italic, headers, lists
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(<CodeBlock key={key++} code={codeLines.join('\n')} language={lang} />);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      nodes.push(<h3 key={key++} className="md-h3">{line.slice(4)}</h3>);
    } else if (line.startsWith('## ')) {
      nodes.push(<h2 key={key++} className="md-h2">{line.slice(3)}</h2>);
    } else if (line.startsWith('# ')) {
      nodes.push(<h1 key={key++} className="md-h1">{line.slice(2)}</h1>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      nodes.push(<li key={key++} className="md-li">{renderInline(line.slice(2))}</li>);
    } else if (line.trim() === '') {
      nodes.push(<br key={key++} />);
    } else {
      nodes.push(<p key={key++} className="md-p">{renderInline(line)}</p>);
    }
    i++;
  }

  return nodes;
}

function renderInline(text: string): React.ReactNode {
  // Replace **bold**, *italic*, `code`
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export const AssistantMessage: React.FC<Props> = ({ message, onSaveAsKnowledge, onFork, showThinking = true }) => {
  const renderedContent = useMemo(() => renderMarkdown(message.content), [message.content]);

  return (
    <div className={`chat-message assistant-message ${message.isStreaming ? 'streaming' : ''}`}>
      <div className="message-avatar">Claude</div>
      <div className="message-body">
        {showThinking && message.thinking && <ThinkingBlock content={message.thinking} />}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolPanel tools={message.toolCalls} results={message.toolResults} />
        )}

        <div className="message-content markdown-body">
          {renderedContent}
          {message.isStreaming && <span className="typing-cursor" />}
        </div>

        <div className="message-footer">
          <span className="message-time">
            {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {onSaveAsKnowledge && (
            <button
              className="save-knowledge-btn"
              onClick={() => onSaveAsKnowledge(message.content)}
              title="Save as knowledge"
            >
              Save as knowledge
            </button>
          )}
          {onFork && !message.isStreaming && (
            <button
              className="fork-btn"
              onClick={() => onFork(message.id)}
              title="Branch from here"
            >
              Branch
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
