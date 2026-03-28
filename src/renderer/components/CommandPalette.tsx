import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Session, SessionTemplate, SkillEntry } from '../../shared/types';
import './CommandPalette.css';

interface CommandResult {
  type: 'session' | 'template' | 'skill';
  id: string;
  label: string;
  detail?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onSelectTemplate: (template: SessionTemplate) => void;
  onSelectSkill: (skill: SkillEntry) => void;
  sessions: Session[];
  groups: Array<{ id: string; name: string }>;
}

function fuzzyMatch(query: string, text: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

const SKILL_TYPE_ICONS: Record<string, string> = {
  command: 'C',
  role: 'R',
  skill: 'S',
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectSession,
  onSelectTemplate,
  onSelectSkill,
  sessions,
  groups,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Build a group name lookup
  const groupNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      map.set(g.id, g.name);
    }
    return map;
  }, [groups]);

  // Load templates and skills when palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      window.electronAPI.templatesGetAll()
        .then(result => setTemplates(result))
        .catch(() => setTemplates([]));

      window.electronAPI.skillListAll()
        .then(result => setSkills(result))
        .catch(() => setSkills([]));
    }
  }, [isOpen]);

  // Detect if searching for skills with / prefix
  const isSkillQuery = query.startsWith('/');
  const effectiveQuery = isSkillQuery ? query.slice(1) : query;

  // Build filtered results
  const filteredResults = useMemo((): CommandResult[] => {
    const results: CommandResult[] = [];

    // If query starts with /, only show skills
    if (!isSkillQuery) {
      // Sessions
      const matchingSessions = sessions.filter(s =>
        !effectiveQuery.trim() || fuzzyMatch(effectiveQuery, s.name) || fuzzyMatch(effectiveQuery, groupNameMap.get(s.groupId) || '')
      );
      for (const s of matchingSessions) {
        results.push({
          type: 'session',
          id: s.id,
          label: s.name,
          detail: groupNameMap.get(s.groupId) || undefined,
        });
      }

      // Templates
      const matchingTemplates = templates.filter(t =>
        !effectiveQuery.trim() || fuzzyMatch(effectiveQuery, t.name) || fuzzyMatch(effectiveQuery, t.initialPrompt || '')
      );
      for (const t of matchingTemplates) {
        results.push({
          type: 'template',
          id: t.id,
          label: t.name,
          detail: t.workingDir || undefined,
        });
      }
    }

    // Skills — always show if query starts with /, or if query matches
    const matchingSkills = skills.filter(s =>
      !effectiveQuery.trim() ||
      fuzzyMatch(effectiveQuery, s.id) ||
      fuzzyMatch(effectiveQuery, s.name) ||
      fuzzyMatch(effectiveQuery, s.plugin) ||
      fuzzyMatch(effectiveQuery, s.description)
    );
    for (const s of matchingSkills) {
      results.push({
        type: 'skill',
        id: s.id,
        label: `/${s.id}`,
        detail: s.description.length > 80 ? s.description.slice(0, 80) + '...' : s.description,
      });
    }

    return results;
  }, [effectiveQuery, isSkillQuery, sessions, templates, skills, groupNameMap]);

  // Group results by category for rendering
  const groupedResults = useMemo(() => {
    const sessionResults = filteredResults.filter(r => r.type === 'session');
    const templateResults = filteredResults.filter(r => r.type === 'template');
    const skillResults = filteredResults.filter(r => r.type === 'skill');
    return { sessionResults, templateResults, skillResults };
  }, [filteredResults]);

  // Clamp selected index when results change
  useEffect(() => {
    if (selectedIndex >= filteredResults.length) {
      setSelectedIndex(Math.max(0, filteredResults.length - 1));
    }
  }, [filteredResults.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('.command-palette-item');
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((result: CommandResult) => {
    if (result.type === 'session') {
      onSelectSession(result.id);
    } else if (result.type === 'template') {
      const template = templates.find(t => t.id === result.id);
      if (template) {
        onSelectTemplate(template);
      }
    } else if (result.type === 'skill') {
      const skill = skills.find(s => s.id === result.id);
      if (skill) {
        onSelectSkill(skill);
      }
    }
    onClose();
  }, [onSelectSession, onSelectTemplate, onSelectSkill, onClose, templates, skills]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredResults.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredResults.length) {
        handleSelect(filteredResults[selectedIndex]);
      }
      return;
    }
  }, [onClose, filteredResults, selectedIndex, handleSelect]);

  if (!isOpen) return null;

  // Compute flat index offset for each category
  const sessionStartIndex = 0;
  const templateStartIndex = groupedResults.sessionResults.length;
  const skillStartIndex = templateStartIndex + groupedResults.templateResults.length;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="command-palette-input-wrapper">
          <span className="command-palette-icon">&#x2315;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search sessions, templates, /skills..."
            autoFocus
          />
        </div>

        {/* Results */}
        <div className="command-palette-results" ref={resultsRef}>
          {filteredResults.length === 0 && query.trim() && (
            <div className="command-palette-no-results">No results found</div>
          )}

          {filteredResults.length === 0 && !query.trim() && (
            <div className="command-palette-empty">Type to search or / for skills</div>
          )}

          {/* Sessions category */}
          {groupedResults.sessionResults.length > 0 && (
            <>
              <div className="command-palette-category">Sessions</div>
              {groupedResults.sessionResults.map((result, i) => {
                const flatIndex = sessionStartIndex + i;
                return (
                  <div
                    key={`session-${result.id}`}
                    className={`command-palette-item${flatIndex === selectedIndex ? ' selected' : ''}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(flatIndex)}
                  >
                    <span className="command-palette-item-icon session">S</span>
                    <span className="command-palette-item-label">
                      {highlightMatch(result.label, effectiveQuery)}
                    </span>
                    {result.detail && (
                      <span className="command-palette-item-detail">{result.detail}</span>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Templates category */}
          {groupedResults.templateResults.length > 0 && (
            <>
              <div className="command-palette-category">Templates</div>
              {groupedResults.templateResults.map((result, i) => {
                const flatIndex = templateStartIndex + i;
                return (
                  <div
                    key={`template-${result.id}`}
                    className={`command-palette-item${flatIndex === selectedIndex ? ' selected' : ''}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(flatIndex)}
                  >
                    <span className="command-palette-item-icon template">T</span>
                    <span className="command-palette-item-label">
                      {highlightMatch(result.label, effectiveQuery)}
                    </span>
                    {result.detail && (
                      <span className="command-palette-item-detail">{result.detail}</span>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Skills category */}
          {groupedResults.skillResults.length > 0 && (
            <>
              <div className="command-palette-category">Skills</div>
              {groupedResults.skillResults.map((result, i) => {
                const flatIndex = skillStartIndex + i;
                const skill = skills.find(s => s.id === result.id);
                return (
                  <div
                    key={`skill-${result.id}`}
                    className={`command-palette-item${flatIndex === selectedIndex ? ' selected' : ''}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(flatIndex)}
                  >
                    <span className={`command-palette-item-icon skill ${skill?.type || ''}`}>
                      {skill ? SKILL_TYPE_ICONS[skill.type] || '/' : '/'}
                    </span>
                    <span className="command-palette-item-label">
                      {highlightMatch(result.label, effectiveQuery)}
                    </span>
                    {result.detail && (
                      <span className="command-palette-item-detail">{result.detail}</span>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="command-palette-footer">
          <span>
            <kbd>&uarr;</kbd> <kbd>&darr;</kbd> navigate
            &nbsp;&middot;&nbsp;
            <kbd>Enter</kbd> select
            &nbsp;&middot;&nbsp;
            <kbd>Esc</kbd> close
          </span>
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd></span>
        </div>
      </div>
    </div>
  );
};
