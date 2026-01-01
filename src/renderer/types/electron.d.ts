export interface ElectronAPI {
  platform: string;
  homedir: string;
  createSession: (id: string, cwd: string) => Promise<void>;
  writeToSession: (id: string, data: string) => void;
  resizeSession: (id: string, cols: number, rows: number) => void;
  killSession: (id: string) => void;
  onPtyData: (callback: (id: string, data: string) => void) => void;
  onPtyExit: (callback: (id: string, exitCode: number) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
