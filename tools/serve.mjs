// Servidor estático para pré-visualizar e testar. Escuta só em 127.0.0.1.
// Em produção o site vai para uma hospedagem estática (ver README).
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from '../config/security-policy.mjs';

const ROOT = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const MAX_URL = 2048;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

// Caminho seguro relativo à raiz, ou null. Decodifica uma única vez e recusa qualquer ambiguidade.
export function safePath(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/')) return null;
  const rawPath = rawUrl.split('?', 1)[0].split('#', 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  const parts = decoded.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '.' || part === '..') return null;
    if (part.startsWith('_') || part.includes(':')) return null;
    if (part.startsWith('.') && !(i === 0 && part === '.well-known')) return null;
  }
  const relative = decoded.endsWith('/') ? [...parts, 'index.html'] : parts;
  return relative.length ? relative.join('/') : 'index.html';
}

export function createSiteServer({ root = ROOT, production = false } = {}) {
  const realRootPromise = realpath(root);
  const base = securityHeaders({ production });

  const server = createServer(async (req, res) => {
    const reply = (status, extra = {}, body = '') => {
      res.writeHead(status, { ...base, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return reply(405, { Allow: 'GET, HEAD' }, 'Método não permitido\n');
      }
      if (req.url.length > MAX_URL) return reply(414, {}, 'Endereço longo demais\n');

      const relative = safePath(req.url);
      if (relative === null) return reply(400, {}, 'Requisição inválida\n');

      const sendNotFound = async () => {
        const page = join(root, '404.html');
        const info = await stat(page);
        res.writeHead(404, { ...base, 'Content-Type': TYPES['.html'], 'Content-Length': info.size, 'Cache-Control': 'no-store' });
        if (req.method === 'HEAD') return res.end();
        createReadStream(page).pipe(res);
      };

      const type = TYPES[extname(relative).toLowerCase()];
      if (!type) return sendNotFound();

      const full = resolve(root, relative);
      const realRoot = await realRootPromise;
      let real;
      try {
        real = await realpath(full);
      } catch {
        return sendNotFound();
      }
      // Confere de novo depois de resolver links simbólicos.
      if (!real.startsWith(realRoot + sep)) return sendNotFound();
      const info = await stat(real);
      if (!info.isFile()) return sendNotFound();

      res.writeHead(200, {
        ...base,
        'Content-Type': type,
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(real).pipe(res);
    } catch {
      if (!res.headersSent) reply(500, {}, 'Erro interno\n');
      else res.destroy();
    }
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4173;
  createSiteServer().listen(port, '127.0.0.1', () => {
    console.log(`Dominimaker em http://127.0.0.1:${port}`);
  });
}
