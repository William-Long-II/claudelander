import * as net from 'net';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { SessionState, MemoryType } from '../shared/types';

interface StateEvent {
  sessionId: string;
  state: SessionState;
  event: string;
  timestamp: number;
}

interface MemoryEvent {
  type: 'memory';
  sessionId: string;
  memory: {
    type: MemoryType;
    content: string;
    source: 'claude';
  };
  timestamp: number;
}

class StateMonitor extends EventEmitter {
  private server: net.Server | null = null;
  private socketPath: string;

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
  }

  private isWindowsPipe(): boolean {
    return this.socketPath.startsWith('\\\\.\\pipe\\');
  }

  start(): void {
    // Clean up old socket file (not needed for Windows named pipes)
    if (!this.isWindowsPipe()) {
      try {
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath);
        }
      } catch (e) {
        console.warn('Failed to clean up old socket:', e);
      }
    }

    this.server = net.createServer((socket) => {
      // Add socket error handler
      socket.on('error', (err) => {
        console.error('Socket connection error:', err);
      });

      socket.on('data', (data) => {
        try {
          const parsed = JSON.parse(data.toString().trim());

          // Check if it's a memory event
          if (this.isValidMemoryEvent(parsed)) {
            this.emit('memoryEvent', parsed);
            return;
          }

          // Validate StateEvent structure
          if (this.isValidStateEvent(parsed)) {
            this.emit('stateChange', parsed);
          } else {
            console.error('Invalid event structure:', parsed);
          }
        } catch (e) {
          console.error('Failed to parse event:', e);
        }
      });
    });

    // Add server error handler
    this.server.on('error', (err) => {
      console.error('State monitor server error:', err);
    });

    this.server.listen(this.socketPath, () => {
      console.log('State monitor listening on:', this.socketPath);
    });
  }

  // Add validation method
  private isValidStateEvent(obj: unknown): obj is StateEvent {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'sessionId' in obj &&
      'state' in obj &&
      'event' in obj &&
      'timestamp' in obj &&
      typeof (obj as StateEvent).sessionId === 'string' &&
      typeof (obj as StateEvent).state === 'string' &&
      typeof (obj as StateEvent).event === 'string' &&
      typeof (obj as StateEvent).timestamp === 'number'
    );
  }

  // Validate memory event structure
  private isValidMemoryEvent(obj: unknown): obj is MemoryEvent {
    if (
      typeof obj !== 'object' ||
      obj === null ||
      (obj as any).type !== 'memory'
    ) {
      return false;
    }

    const memEvent = obj as MemoryEvent;
    const validTypes: MemoryType[] = ['decision', 'error_fix', 'pattern', 'context', 'note'];

    return (
      typeof memEvent.sessionId === 'string' &&
      typeof memEvent.timestamp === 'number' &&
      typeof memEvent.memory === 'object' &&
      memEvent.memory !== null &&
      validTypes.includes(memEvent.memory.type) &&
      typeof memEvent.memory.content === 'string' &&
      memEvent.memory.source === 'claude'
    );
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Clean up socket file (not needed for Windows named pipes)
    if (!this.isWindowsPipe()) {
      try {
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath);
        }
      } catch (e) {
        console.warn('Failed to clean up socket file:', e);
      }
    }
  }
}

export { StateMonitor, StateEvent, MemoryEvent };
