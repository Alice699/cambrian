declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  platform: string;
};

declare const Buffer: {
  concat(chunks: unknown[]): { toString(encoding?: string): string };
};

declare module "node:http" {
  export type IncomingMessage = any;
  export type ServerResponse = any;
  export type Server = any;
  export function createServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Server;
}

declare module "node:child_process" {
  export interface ExecFileOptions {
    timeout?: number;
    maxBuffer?: number;
    shell?: boolean;
    windowsHide?: boolean;
  }

  export function execFile(
    file: string,
    args: string[],
    options: ExecFileOptions,
    callback: (error: unknown, stdout: string, stderr: string) => void,
  ): void;
}
