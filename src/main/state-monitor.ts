import * as net from 'net';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { SessionState } from '../shared/types';

interface StateEvent {
  sessionId: string;
  state: SessionState;
  event: string;
  timestamp: number;
}

class StateMonitor extends EventEmitter {
  private server: net.Server | null = null;
  private socketPath: string;

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
  }

  start(): void {
    // Wrap socket cleanup in try-catch
    try {
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }
    } catch (e) {
      console.warn('Failed to clean up old socket:', e);
    }

    this.server = net.createServer((socket) => {
      // Add socket error handler
      socket.on('error', (err) => {
        console.error('Socket connection error:', err);
      });

      socket.on('data', (data) => {
        try {
          const parsed = JSON.parse(data.toString().trim());
          // Validate StateEvent structure
          if (this.isValidStateEvent(parsed)) {
            this.emit('stateChange', parsed);
          } else {
            console.error('Invalid state event structure:', parsed);
          }
        } catch (e) {
          console.error('Failed to parse state event:', e);
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

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    try {
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }
    } catch (e) {
      console.warn('Failed to clean up socket file:', e);
    }
  }
}

export { StateMonitor, StateEvent };
