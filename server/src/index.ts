// HTTP server: serves the built client from client/dist and upgrades /ws
// to the game WebSocket — one port for everything in production.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameRoom } from './game.js';

const PORT = Number(process.env.PORT) || 8080;
const here = path.dirname(fileURLToPath(import.meta.url));
// works from both server/src (tsx dev) and server/dist (built): repo root is two levels up
const clientDist = path.resolve(here, '..', '..', 'client', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  let filePath = path.join(clientDist, url === '/' ? 'index.html' : url);
  if (!filePath.startsWith(clientDist)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback
      filePath = path.join(clientDist, 'index.html');
    }
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('client build not found — run: npm run build');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    });
  });
});

const room = new GameRoom();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if ((req.url ?? '').split('?')[0] === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => room.addConnection(ws));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[server] Vice Coast listening on http://localhost:${PORT} (ws: /ws)`);
});

process.on('SIGINT', () => {
  room.stop();
  server.close();
  process.exit(0);
});
