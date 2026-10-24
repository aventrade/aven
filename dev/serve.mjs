// Local static server for site/ (and dev/ for the reel): node dev/serve.mjs -> http://localhost:8792
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const PORT = Number(process.env.PORT || 8792);

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = path.startsWith('/dev/') ? ROOT : join(ROOT, 'site');
  let file = normalize(join(base, path));
  if (!file.startsWith(normalize(ROOT))) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(await readFile(join(ROOT, 'site', '404.html')).catch(() => 'Not found'));
  }
}).listen(PORT, () => console.log(`Aven on http://localhost:${PORT}`));
