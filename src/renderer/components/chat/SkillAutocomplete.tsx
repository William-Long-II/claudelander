import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SkillEntry } from '../../../shared/types';

interface Props {
  query: string; // text after the '/'
  onSelect: (skill: SkillEntry) => void;
  onClose: () => void;
  visible: boolean;
}

const TYPE_ICONS: Record<string, string> = {
  command: 'C',
  role: 'R',
  skill: 'S',
};

export const SkillAutocomplete: React.FC<Props> = ({ query, onSelect, onClose, visible }) => {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [filtered, setFiltered] = useState<SkillEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Load skills once when visible
  useEffect(() => {
    if (visible && skills.length === 0) {
      window.electronAPI.skillListAll()
        .then(result => setSkills(result))
        .catch(() => setSkills([]));
    }
  }, [visible]);

  // Filter on query change
  useEffect(() => {
    if (!query.trim()) {
      setFiltered(skills);
    } else {
      const lower = query.toLowerCase();
      setFiltered(skills.filter(s =>
        s.id.toLowerCase().includes(lower) ||
        s.name.toLowerCase().includes(lower) ||
        s.plugin.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower)
      ));
    }
    setSelectedIndex(0);
  }, [query, skills]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll('.skill-autocomplete-item');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered.length > 0 && selectedIndex >= 0 && selectedIndex < filtered.length) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(filtered[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [visible, filtered, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    if (visible) {
      document.addEventListener('keydown', handleKeyDown, true);
      return () => document.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [visible, handleKeyDown]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div className="skill-autocomplete">
      <div className="skill-autocomplete-header">Skills</div>
      <div className="skill-autocomplete-list" ref={listRef}>
        {filtered.slice(0, 20).map((skill, i) => (
          <div
            key={skill.id}
            className={`skill-autocomplete-item${i === selectedIndex ? ' selected' : ''}`}
            onClick={() => onSelect(skill)}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            <span className={`skill-type-icon ${skill.type}`}>
              {TYPE_ICONS[skill.type] || '?'}
            </span>
            <div className="skill-autocomplete-info">
              <span className="skill-autocomplete-name">/{skill.id}</span>
              <span className="skill-autocomplete-desc">{skill.description}</span>
            </div>
            <span className="skill-autocomplete-plugin">{skill.plugin}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
