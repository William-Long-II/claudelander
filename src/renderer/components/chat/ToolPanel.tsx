import React, { useState } from 'react';

interface Props {
  tools: any[];
  results?: any[] | null;
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Read file',
  Edit: 'Edited file',
  Write: 'Created file',
  Bash: 'Ran command',
  Grep: 'Searched code',
  Glob: 'Found files',
  Agent: 'Dispatched agent',
};

export const ToolPanel: React.FC<Props> = ({ tools, results }) => {
  const [expanded, setExpanded] = useState(false);

  const summary = tools.map(t => {
    const name = t.name || t.tool || 'Tool';
    return TOOL_LABELS[name] || name;
  });

  return (
    <div className="tool-panel">
      <button
        className="tool-panel-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="tool-icon">{'>'}</span>
        <span className="tool-summary">
          {summary.length === 1 ? summary[0] : `${summary.length} tool calls`}
        </span>
        <span className={`tool-chevron ${expanded ? 'expanded' : ''}`}>
          {expanded ? 'v' : '>'}
        </span>
      </button>

      {expanded && (
        <div className="tool-panel-details">
          {tools.map((tool, i) => (
            <div key={i} className="tool-call">
              <div className="tool-name">{tool.name || tool.tool}</div>
              {tool.input && (
                <pre className="tool-input">{JSON.stringify(tool.input, null, 2)}</pre>
              )}
              {results && results[i] && (
                <div className="tool-result">
                  <pre>{typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i], null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
