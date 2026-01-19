import React, { useState, useEffect, useCallback } from 'react';
import './OrchestrationPanel.css';

interface OrchestrationTask {
  id: string;
  name: string;
  prompt: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface OrchestrationJob {
  id: string;
  name: string;
  description?: string;
  tasks: OrchestrationTask[];
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  maxConcurrent: number;
  aggregatedResult?: string;
}

interface OrchestrationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateSession: (groupId: string, name: string, prompt?: string) => Promise<string>;
  defaultGroupId: string;
}

const OrchestrationPanel: React.FC<OrchestrationPanelProps> = ({
  isOpen,
  onClose,
  onCreateSession,
  defaultGroupId,
}) => {
  const [jobs, setJobs] = useState<OrchestrationJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [newJobName, setNewJobName] = useState('');
  const [newJobDescription, setNewJobDescription] = useState('');
  const [newJobTasks, setNewJobTasks] = useState<Array<{ name: string; prompt: string }>>([
    { name: '', prompt: '' },
  ]);
  const [maxConcurrent, setMaxConcurrent] = useState(3);

  // Fetch jobs on mount and listen for updates
  useEffect(() => {
    const fetchJobs = async () => {
      const result = await window.electronAPI.orchestrationGetJobs();
      setJobs(result || []);
    };

    if (isOpen) {
      fetchJobs();
    }

    // Listen for updates
    const cleanup = window.electronAPI.onOrchestrationUpdate((updatedJobs: OrchestrationJob[]) => {
      setJobs(updatedJobs);
    });

    return cleanup;
  }, [isOpen]);

  // Listen for task start events
  useEffect(() => {
    const cleanup = window.electronAPI.onOrchestrationStartTask(async (data: { jobId: string; task: OrchestrationTask }) => {
      // Create a session for this task
      try {
        const sessionId = await onCreateSession(
          defaultGroupId,
          `[Orch] ${data.task.name}`,
          data.task.prompt
        );
        // Assign the session to the task
        await window.electronAPI.orchestrationAssignSession(data.task.id, sessionId);
      } catch (error) {
        console.error('Failed to create session for orchestration task:', error);
        await window.electronAPI.orchestrationUpdateTaskError(
          data.task.id,
          error instanceof Error ? error.message : 'Failed to create session'
        );
      }
    });

    return cleanup;
  }, [onCreateSession, defaultGroupId]);

  const handleCreateJob = useCallback(async () => {
    if (!newJobName.trim()) return;

    const validTasks = newJobTasks.filter(t => t.name.trim() && t.prompt.trim());
    if (validTasks.length === 0) return;

    try {
      // Create job
      const job = await window.electronAPI.orchestrationCreateJob(newJobName, newJobDescription, {
        maxConcurrent,
      });

      // Add tasks
      await window.electronAPI.orchestrationAddTasks(job.id, validTasks);

      // Reset form
      setNewJobName('');
      setNewJobDescription('');
      setNewJobTasks([{ name: '', prompt: '' }]);
      setShowNewJobForm(false);
      setSelectedJob(job.id);
    } catch (error) {
      console.error('Failed to create orchestration job:', error);
    }
  }, [newJobName, newJobDescription, newJobTasks, maxConcurrent]);

  const handleStartJob = useCallback(async (jobId: string) => {
    try {
      await window.electronAPI.orchestrationStartJob(jobId);
    } catch (error) {
      console.error('Failed to start job:', error);
    }
  }, []);

  const handleCancelJob = useCallback(async (jobId: string) => {
    try {
      await window.electronAPI.orchestrationCancelJob(jobId);
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  }, []);

  const handleDeleteJob = useCallback(async (jobId: string) => {
    try {
      await window.electronAPI.orchestrationDeleteJob(jobId);
      if (selectedJob === jobId) {
        setSelectedJob(null);
      }
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  }, [selectedJob]);

  const addTaskField = () => {
    setNewJobTasks([...newJobTasks, { name: '', prompt: '' }]);
  };

  const removeTaskField = (index: number) => {
    if (newJobTasks.length > 1) {
      setNewJobTasks(newJobTasks.filter((_, i) => i !== index));
    }
  };

  const updateTask = (index: number, field: 'name' | 'prompt', value: string) => {
    const updated = [...newJobTasks];
    updated[index][field] = value;
    setNewJobTasks(updated);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return '○';
      case 'running': return '◐';
      case 'completed': return '●';
      case 'partial': return '◑';
      case 'failed': return '✕';
      case 'cancelled': return '⊘';
      default: return '○';
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'running': return 'status-running';
      case 'completed': return 'status-completed';
      case 'partial': return 'status-partial';
      case 'failed': return 'status-failed';
      case 'cancelled': return 'status-cancelled';
      default: return '';
    }
  };

  if (!isOpen) return null;

  const selectedJobData = jobs.find(j => j.id === selectedJob);

  return (
    <div className="orchestration-overlay" onClick={onClose}>
      <div className="orchestration-panel" onClick={e => e.stopPropagation()}>
        <div className="orchestration-header">
          <h2>Parallel Orchestration</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="orchestration-content">
          <div className="orchestration-sidebar">
            <div className="orchestration-sidebar-header">
              <span>Jobs</span>
              <button
                className="new-job-btn"
                onClick={() => setShowNewJobForm(true)}
              >
                + New
              </button>
            </div>

            <div className="jobs-list">
              {jobs.length === 0 ? (
                <div className="empty-message">No orchestration jobs yet</div>
              ) : (
                jobs.map(job => (
                  <div
                    key={job.id}
                    className={`job-item ${selectedJob === job.id ? 'selected' : ''} ${getStatusClass(job.status)}`}
                    onClick={() => setSelectedJob(job.id)}
                  >
                    <span className="job-status-icon">{getStatusIcon(job.status)}</span>
                    <span className="job-name">{job.name}</span>
                    <span className="job-task-count">{job.tasks.length} tasks</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="orchestration-main">
            {showNewJobForm ? (
              <div className="new-job-form">
                <h3>Create New Orchestration Job</h3>

                <div className="form-group">
                  <label>Job Name</label>
                  <input
                    type="text"
                    value={newJobName}
                    onChange={e => setNewJobName(e.target.value)}
                    placeholder="e.g., Multi-file refactoring"
                  />
                </div>

                <div className="form-group">
                  <label>Description (optional)</label>
                  <textarea
                    value={newJobDescription}
                    onChange={e => setNewJobDescription(e.target.value)}
                    placeholder="Brief description of the job..."
                    rows={2}
                  />
                </div>

                <div className="form-group">
                  <label>Max Concurrent Sessions</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrent}
                    onChange={e => setMaxConcurrent(parseInt(e.target.value) || 1)}
                  />
                </div>

                <div className="form-group">
                  <label>Tasks</label>
                  <div className="tasks-form">
                    {newJobTasks.map((task, index) => (
                      <div key={index} className="task-form-row">
                        <input
                          type="text"
                          value={task.name}
                          onChange={e => updateTask(index, 'name', e.target.value)}
                          placeholder="Task name"
                          className="task-name-input"
                        />
                        <textarea
                          value={task.prompt}
                          onChange={e => updateTask(index, 'prompt', e.target.value)}
                          placeholder="Task prompt / instructions..."
                          rows={3}
                          className="task-prompt-input"
                        />
                        {newJobTasks.length > 1 && (
                          <button
                            className="remove-task-btn"
                            onClick={() => removeTaskField(index)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button className="add-task-btn" onClick={addTaskField}>
                      + Add Task
                    </button>
                  </div>
                </div>

                <div className="form-actions">
                  <button className="btn secondary" onClick={() => setShowNewJobForm(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    onClick={handleCreateJob}
                    disabled={!newJobName.trim() || newJobTasks.every(t => !t.name.trim() || !t.prompt.trim())}
                  >
                    Create Job
                  </button>
                </div>
              </div>
            ) : selectedJobData ? (
              <div className="job-details">
                <div className="job-details-header">
                  <div className="job-info">
                    <h3>{selectedJobData.name}</h3>
                    {selectedJobData.description && (
                      <p className="job-description">{selectedJobData.description}</p>
                    )}
                    <div className="job-meta">
                      <span className={`job-status ${getStatusClass(selectedJobData.status)}`}>
                        {getStatusIcon(selectedJobData.status)} {selectedJobData.status}
                      </span>
                      <span>Max {selectedJobData.maxConcurrent} concurrent</span>
                      <span>Created {new Date(selectedJobData.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="job-actions">
                    {selectedJobData.status === 'pending' && (
                      <button
                        className="btn primary"
                        onClick={() => handleStartJob(selectedJobData.id)}
                      >
                        Start
                      </button>
                    )}
                    {selectedJobData.status === 'running' && (
                      <button
                        className="btn danger"
                        onClick={() => handleCancelJob(selectedJobData.id)}
                      >
                        Cancel
                      </button>
                    )}
                    {['completed', 'partial', 'failed', 'cancelled'].includes(selectedJobData.status) && (
                      <button
                        className="btn secondary"
                        onClick={() => handleDeleteJob(selectedJobData.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                <div className="task-list">
                  <h4>Tasks ({selectedJobData.tasks.length})</h4>
                  {selectedJobData.tasks.map(task => (
                    <div key={task.id} className={`task-item ${getStatusClass(task.status)}`}>
                      <div className="task-header">
                        <span className="task-status-icon">{getStatusIcon(task.status)}</span>
                        <span className="task-name">{task.name}</span>
                        <span className="task-status">{task.status}</span>
                      </div>
                      <div className="task-prompt">{task.prompt}</div>
                      {task.result && (
                        <div className="task-result">
                          <strong>Result:</strong>
                          <pre>{task.result}</pre>
                        </div>
                      )}
                      {task.error && (
                        <div className="task-error">
                          <strong>Error:</strong> {task.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {selectedJobData.aggregatedResult && (
                  <div className="aggregated-result">
                    <h4>Aggregated Results</h4>
                    <pre>{selectedJobData.aggregatedResult}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <p>Select a job to view details or create a new one</p>
                <button className="btn primary" onClick={() => setShowNewJobForm(true)}>
                  Create Orchestration Job
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrchestrationPanel;
