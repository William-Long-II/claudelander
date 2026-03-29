import React from 'react';

interface Props {
  oldText: string;
  newText: string;
  fileName?: string;
}

export const DiffView: React.FC<Props> = ({ oldText, newText, fileName }) => {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  return (
    <div className="diff-view">
      {fileName && <div className="diff-filename">{fileName}</div>}
      <div className="diff-content">
        {oldLines.map((line, i) => {
          const newLine = newLines[i];
          if (line === newLine) {
            return <div key={i} className="diff-line unchanged">{line}</div>;
          }
          return (
            <React.Fragment key={i}>
              {line && <div className="diff-line removed">- {line}</div>}
              {newLine && <div className="diff-line added">+ {newLine}</div>}
            </React.Fragment>
          );
        })}
        {newLines.slice(oldLines.length).map((line, i) => (
          <div key={`new-${i}`} className="diff-line added">+ {line}</div>
        ))}
      </div>
    </div>
  );
};
