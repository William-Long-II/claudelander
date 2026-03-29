import React, { useState } from 'react';
import { ClaudeConfig } from '../../../shared/types';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

const TagInput: React.FC<TagInputProps> = ({ tags, onChange, disabled, placeholder }) => {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      const value = input.trim();
      if (!tags.includes(value)) {
        onChange([...tags, value]);
      }
      setInput('');
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="tag-input-wrapper">
      {tags.map((tag, i) => (
        <span key={tag} className="tag">
          {tag}
          {!disabled && (
            <button className="tag-remove" onClick={() => removeTag(i)} type="button">
              &times;
            </button>
          )}
        </span>
      ))}
      <input
        className="tag-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={tags.length === 0 ? placeholder : ''}
      />
    </div>
  );
};

interface Props {
  config: ClaudeConfig;
  onChange: (config: ClaudeConfig) => void;
  disabled?: boolean;
}

const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
  { value: '__custom__', label: 'Custom...' },
];

const EFFORT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const PERMISSION_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'auto', label: 'Auto' },
];

export const SessionSettingsBar: React.FC<Props> = ({ config, onChange, disabled }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customModel, setCustomModel] = useState(false);

  // Determine if current model is a preset or custom
  const presetModels = MODEL_OPTIONS.map((o) => o.value).filter((v) => v !== '__custom__');
  const isCustomModel = config.model ? !presetModels.includes(config.model) : false;
  const showCustomInput = customModel || isCustomModel;

  const modelSelectValue = showCustomInput ? '__custom__' : (config.model || '');

  const update = (partial: Partial<ClaudeConfig>) => {
    onChange({ ...config, ...partial });
  };

  return (
    <div className="session-settings-bar">
      <div className="settings-bar-primary">
        {/* Model */}
        <div className="settings-bar-field">
          <label>Model</label>
          <select
            className="settings-bar-select"
            value={modelSelectValue}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setCustomModel(true);
                update({ model: config.model || '' });
              } else {
                setCustomModel(false);
                update({ model: e.target.value || undefined });
              }
            }}
            disabled={disabled}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {showCustomInput && (
            <input
              className="settings-bar-input"
              value={config.model || ''}
              onChange={(e) => update({ model: e.target.value || undefined })}
              placeholder="model name"
              disabled={disabled}
            />
          )}
        </div>

        {/* Effort */}
        <div className="settings-bar-field">
          <label>Effort</label>
          <div className="settings-bar-segmented">
            {EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`segmented-btn ${(config.effort || '') === opt.value ? 'active' : ''}`}
                onClick={() => update({ effort: opt.value || undefined })}
                disabled={disabled}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Permission */}
        <div className="settings-bar-field">
          <label>Permission</label>
          <select
            className="settings-bar-select"
            value={config.permissionMode || ''}
            onChange={(e) => update({ permissionMode: e.target.value || undefined })}
            disabled={disabled}
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Advanced toggle */}
        <button
          className={`settings-bar-advanced-toggle ${showAdvanced ? 'open' : ''}`}
          onClick={() => setShowAdvanced(!showAdvanced)}
          type="button"
        >
          {showAdvanced ? 'Hide Advanced' : 'Advanced'}
        </button>
      </div>

      {/* Advanced section */}
      {showAdvanced && (
        <div className="settings-bar-advanced">
          {/* Budget */}
          <div className="settings-bar-field">
            <label>Budget</label>
            <div className="budget-input-wrapper">
              <span className="budget-prefix">$</span>
              <input
                className="settings-bar-input budget-input"
                type="number"
                min={0}
                step={0.01}
                value={config.maxBudgetUsd ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  update({ maxBudgetUsd: val ? parseFloat(val) : undefined });
                }}
                placeholder="No limit"
                disabled={disabled}
              />
            </div>
          </div>

          {/* System Prompt */}
          <div className="settings-bar-field full-width">
            <label>System Prompt</label>
            <textarea
              className="settings-bar-textarea"
              rows={2}
              value={config.systemPrompt || ''}
              onChange={(e) => update({ systemPrompt: e.target.value || undefined })}
              placeholder="Appended to default system prompt..."
              disabled={disabled}
            />
          </div>

          {/* Allowed Tools */}
          <div className="settings-bar-field">
            <label>Allowed Tools</label>
            <TagInput
              tags={config.allowedTools || []}
              onChange={(tags) => update({ allowedTools: tags.length ? tags : undefined })}
              disabled={disabled}
              placeholder="Type + Enter"
            />
          </div>

          {/* Disallowed Tools */}
          <div className="settings-bar-field">
            <label>Disallowed Tools</label>
            <TagInput
              tags={config.disallowedTools || []}
              onChange={(tags) => update({ disallowedTools: tags.length ? tags : undefined })}
              disabled={disabled}
              placeholder="Type + Enter"
            />
          </div>
        </div>
      )}
    </div>
  );
};
