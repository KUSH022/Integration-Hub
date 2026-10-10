/**
 * CONTROLLED TEST DOUBLE. A real HTTP server on 127.0.0.1 used only by automated tests.
 * It is not KP WFM or KP QA Agent and is never used outside the test suite.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

export type Handler = (req: RecordedRequest, res: http.ServerResponse) => void | Promise<void>;

export async function startTestServer(handler: Handler) {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        /* keep text */
      }
      const rec: RecordedRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(rec);
      await handler(rec, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

export function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
