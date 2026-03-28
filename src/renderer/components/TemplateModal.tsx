import React, { useState, useEffect, useCallback } from 'react';
import { SessionTemplate } from '../../shared/types';
import './TemplateModal.css';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartFromTemplate: (template: SessionTemplate) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  onClose,
  onStartFromTemplate,
}) => {
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formWorkingDir, setFormWorkingDir] = useState('');
  const [formInitialPrompt, setFormInitialPrompt] = useState('');

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.templatesGetAll();
      setTemplates(result);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
      setShowForm(false);
      resetForm();
    }
  }, [isOpen, loadTemplates]);

  const resetForm = () => {
    setFormName('');
    setFormWorkingDir('');
    setFormInitialPrompt('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    if (!name) return;

    try {
      const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await window.electronAPI.templatesCreate({
        id,
        name,
        workingDir: formWorkingDir || undefined,
        initialPrompt: formInitialPrompt || undefined,
      });
      setShowForm(false);
      resetForm();
      loadTemplates();
    } catch (err) {
      console.error('Failed to create template:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await window.electronAPI.templatesDelete(id);
      loadTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  const handleBrowseDir = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      setFormWorkingDir(dir);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showForm) {
          setShowForm(false);
          resetForm();
        } else {
          onClose();
        }
      }
    },
    [showForm, onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="template-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-modal-title"
      >
        <div className="template-modal-header">
          <h3 id="template-modal-title">Session Templates</h3>
          <button className="template-modal-close" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {showForm ? (
          <form className="template-form" onSubmit={handleCreate}>
            <div className="template-form-field">
              <label>Name *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Frontend Dev"
                autoFocus
              />
            </div>
            <div className="template-form-field">
              <label>Working Directory</label>
              <div className="template-form-dir-row">
                <input
                  type="text"
                  value={formWorkingDir}
                  onChange={(e) => setFormWorkingDir(e.target.value)}
                  placeholder="No directory selected"
                  readOnly
                />
                <button type="button" onClick={handleBrowseDir} className="browse-btn">
                  Browse...
                </button>
              </div>
            </div>
            <div className="template-form-field">
              <label>Initial Prompt</label>
              <textarea
                value={formInitialPrompt}
                onChange={(e) => setFormInitialPrompt(e.target.value)}
                placeholder="Optional prompt to send when session starts"
                rows={3}
              />
            </div>
            <div className="template-form-buttons">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </button>
              <button type="submit" className="confirm-btn" disabled={!formName.trim()}>
                Create Template
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="template-list">
              {loading ? (
                <div className="template-empty">Loading...</div>
              ) : templates.length === 0 ? (
                <div className="template-empty">
                  No templates yet. Create one to quickly start sessions with preset configurations.
                </div>
              ) : (
                templates.map((tpl) => (
                  <div key={tpl.id} className="template-item">
                    <div className="template-item-info">
                      <div className="template-item-name">{tpl.name}</div>
                      {tpl.workingDir && (
                        <div className="template-item-detail">{tpl.workingDir}</div>
                      )}
                      {tpl.initialPrompt && (
                        <div className="template-item-detail template-item-prompt">
                          {tpl.initialPrompt.length > 80
                            ? tpl.initialPrompt.slice(0, 80) + '...'
                            : tpl.initialPrompt}
                        </div>
                      )}
                    </div>
                    <div className="template-item-actions">
                      <button
                        className="template-start-btn"
                        onClick={() => onStartFromTemplate(tpl)}
                        title="Start session from this template"
                      >
                        Start
                      </button>
                      <button
                        className="template-delete-btn"
                        onClick={() => handleDelete(tpl.id)}
                        title="Delete template"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="template-modal-footer">
              <button className="confirm-btn" onClick={() => setShowForm(true)}>
                + New Template
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
