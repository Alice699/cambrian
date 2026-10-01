declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
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
