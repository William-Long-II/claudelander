import { BrowserWindow, ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';

export interface OrchestrationTask {
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

export interface OrchestrationJob {
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

interface OrchestrationConfig {
  maxConcurrent: number;
  timeoutMs: number;
  retryOnFail: boolean;
  aggregateResults: boolean;
}

const DEFAULT_CONFIG: OrchestrationConfig = {
  maxConcurrent: 3,
  timeoutMs: 300000, // 5 minutes
  retryOnFail: false,
  aggregateResults: true,
};

class OrchestrationManager {
  private jobs: Map<string, OrchestrationJob> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private taskTimeouts: Map<string, NodeJS.Timeout> = new Map();

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  initialize() {
    // Create a new orchestration job
    ipcMain.handle('orchestration:create-job', async (_event, name: string, description?: string, config?: Partial<OrchestrationConfig>) => {
      const jobConfig = { ...DEFAULT_CONFIG, ...config };
      const job: OrchestrationJob = {
        id: uuid(),
        name,
        description,
        tasks: [],
        status: 'pending',
        createdAt: new Date().toISOString(),
        maxConcurrent: jobConfig.maxConcurrent,
      };
      this.jobs.set(job.id, job);
      this.notifyUpdate();
      return job;
    });

    // Add tasks to a job
    ipcMain.handle('orchestration:add-tasks', async (_event, jobId: string, tasks: Array<{ name: string; prompt: string }>) => {
      const job = this.jobs.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      if (job.status !== 'pending') {
        throw new Error('Cannot add tasks to a job that has already started');
      }

      const newTasks: OrchestrationTask[] = tasks.map(t => ({
        id: uuid(),
        name: t.name,
        prompt: t.prompt,
        status: 'pending',
      }));

      job.tasks.push(...newTasks);
      this.jobs.set(jobId, job);
      this.notifyUpdate();
      return job;
    });

    // Start a job
    ipcMain.handle('orchestration:start-job', async (_event, jobId: string) => {
      const job = this.jobs.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      if (job.tasks.length === 0) {
        throw new Error('Cannot start a job with no tasks');
      }
      if (job.status !== 'pending') {
        throw new Error('Job has already been started');
      }

      job.status = 'running';
      job.startedAt = new Date().toISOString();
      this.jobs.set(jobId, job);
      this.notifyUpdate();

      // Start executing tasks
      this.executeJobTasks(jobId);

      return job;
    });

    // Cancel a job
    ipcMain.handle('orchestration:cancel-job', async (_event, jobId: string) => {
      const job = this.jobs.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      // Cancel all running tasks
      for (const task of job.tasks) {
        if (task.status === 'running' || task.status === 'pending') {
          task.status = 'cancelled';
          // Clear any timeout
          const timeout = this.taskTimeouts.get(task.id);
          if (timeout) {
            clearTimeout(timeout);
            this.taskTimeouts.delete(task.id);
          }
        }
      }

      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      this.jobs.set(jobId, job);
      this.notifyUpdate();

      return job;
    });

    // Get job status
    ipcMain.handle('orchestration:get-job', async (_event, jobId: string) => {
      return this.jobs.get(jobId);
    });

    // Get all jobs
    ipcMain.handle('orchestration:get-jobs', async () => {
      return Array.from(this.jobs.values());
    });

    // Delete a job
    ipcMain.handle('orchestration:delete-job', async (_event, jobId: string) => {
      const job = this.jobs.get(jobId);
      if (job && (job.status === 'running')) {
        throw new Error('Cannot delete a running job');
      }
      this.jobs.delete(jobId);
      this.notifyUpdate();
      return true;
    });

    // Update task result (called by sessions when they complete)
    ipcMain.handle('orchestration:update-task-result', async (_event, taskId: string, result: string) => {
      for (const job of this.jobs.values()) {
        const task = job.tasks.find(t => t.id === taskId);
        if (task) {
          task.result = result;
          task.status = 'completed';
          task.completedAt = new Date().toISOString();

          // Clear timeout
          const timeout = this.taskTimeouts.get(taskId);
          if (timeout) {
            clearTimeout(timeout);
            this.taskTimeouts.delete(taskId);
          }

          this.jobs.set(job.id, job);
          this.checkJobCompletion(job.id);
          this.notifyUpdate();
          return true;
        }
      }
      return false;
    });

    // Update task error
    ipcMain.handle('orchestration:update-task-error', async (_event, taskId: string, error: string) => {
      for (const job of this.jobs.values()) {
        const task = job.tasks.find(t => t.id === taskId);
        if (task) {
          task.error = error;
          task.status = 'failed';
          task.completedAt = new Date().toISOString();

          // Clear timeout
          const timeout = this.taskTimeouts.get(taskId);
          if (timeout) {
            clearTimeout(timeout);
            this.taskTimeouts.delete(taskId);
          }

          this.jobs.set(job.id, job);
          this.checkJobCompletion(job.id);
          this.notifyUpdate();
          return true;
        }
      }
      return false;
    });

    // Assign session to task
    ipcMain.handle('orchestration:assign-session', async (_event, taskId: string, sessionId: string) => {
      for (const job of this.jobs.values()) {
        const task = job.tasks.find(t => t.id === taskId);
        if (task) {
          task.sessionId = sessionId;
          task.status = 'running';
          task.startedAt = new Date().toISOString();
          this.jobs.set(job.id, job);
          this.notifyUpdate();
          return true;
        }
      }
      return false;
    });
  }

  private async executeJobTasks(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') return;

    const pendingTasks = job.tasks.filter(t => t.status === 'pending');
    const runningTasks = job.tasks.filter(t => t.status === 'running');

    // Start tasks up to maxConcurrent
    const slotsAvailable = job.maxConcurrent - runningTasks.length;
    const tasksToStart = pendingTasks.slice(0, slotsAvailable);

    for (const task of tasksToStart) {
      // Notify renderer to create a session for this task
      this.mainWindow?.webContents.send('orchestration:start-task', {
        jobId,
        task,
      });
    }
  }

  private checkJobCompletion(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const pendingTasks = job.tasks.filter(t => t.status === 'pending');
    const runningTasks = job.tasks.filter(t => t.status === 'running');
    const completedTasks = job.tasks.filter(t => t.status === 'completed');
    const failedTasks = job.tasks.filter(t => t.status === 'failed');

    // If there are pending tasks and slots available, execute more
    if (pendingTasks.length > 0 && runningTasks.length < job.maxConcurrent) {
      this.executeJobTasks(jobId);
      return;
    }

    // Check if all tasks are done
    if (pendingTasks.length === 0 && runningTasks.length === 0) {
      if (failedTasks.length === 0) {
        job.status = 'completed';
      } else if (completedTasks.length > 0) {
        job.status = 'partial';
      } else {
        job.status = 'failed';
      }
      job.completedAt = new Date().toISOString();

      // Aggregate results
      if (completedTasks.length > 0) {
        job.aggregatedResult = this.aggregateResults(completedTasks);
      }

      this.jobs.set(jobId, job);
      this.notifyUpdate();

      // Notify completion
      this.mainWindow?.webContents.send('orchestration:job-completed', {
        jobId,
        status: job.status,
        completedCount: completedTasks.length,
        failedCount: failedTasks.length,
      });
    }
  }

  private aggregateResults(tasks: OrchestrationTask[]): string {
    const results = tasks
      .filter(t => t.result)
      .map(t => `## ${t.name}\n\n${t.result}`)
      .join('\n\n---\n\n');
    return results;
  }

  private notifyUpdate() {
    this.mainWindow?.webContents.send('orchestration:update', Array.from(this.jobs.values()));
  }

  // Clean up on shutdown
  destroy() {
    for (const timeout of this.taskTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.taskTimeouts.clear();
    this.jobs.clear();
  }
}

export const orchestrationManager = new OrchestrationManager();
