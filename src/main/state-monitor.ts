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
    // Clean up old socket if it exists
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.server = net.createServer((socket) => {
      socket.on('data', (data) => {
        try {
          const event: StateEvent = JSON.parse(data.toString().trim());
          this.emit('stateChange', event);
        } catch (e) {
          console.error('Failed to parse state event:', e);
        }
      });
    });

    this.server.listen(this.socketPath);
    console.log('State monitor listening on:', this.socketPath);
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }
  }
}

export { StateMonitor, StateEvent };
