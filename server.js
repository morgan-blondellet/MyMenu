// MyMenu : sert l'application et lit les pages de recettes pour l'import par adresse.
// Node 18 ou plus, aucune dépendance. Lancement : node server.js (PORT=3000 par défaut).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1'; // seulement pour les tests locaux
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/* Refuse les adresses internes (localhost, réseau privé…) pour que le serveur
   ne puisse pas être utilisé pour sonder le réseau où il est hébergé. */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') ||
    v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}
async function assertPublicHost(hostname) {
  if (ALLOW_PRIVATE) return;
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new UserError('Ce site est introuvable. Vérifiez l’adresse.');
  if (addrs.some(a => isPrivateIp(a.address))) throw new UserError('Cette adresse n’est pas autorisée.');
}

async function fetchPage(rawUrl) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserError('Seules les adresses http et https sont acceptées.');
    await assertPublicHost(url.hostname);
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5' },
      });
    } catch (e) {
      throw new UserError(e.name === 'TimeoutError' ? 'Le site met trop de temps à répondre.' : 'Le site n’a pas pu être joint.', 502);
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) { url = new URL(location, url); continue; }
    if (!res.ok) throw new UserError(`Le site a refusé la demande (erreur ${res.status}).`, 502);
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) throw new UserError('Cette adresse ne mène pas à une page web.');
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const charset = (type.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(charset).decode(Buffer.concat(chunks)); }
    catch { html = Buffer.concat(chunks).toString('utf8'); }
    return { url: url.href, html };
  }
  throw new UserError('Trop de redirections.');
}

/* Renvoie les blocs JSON-LD (schema.org) s'il y en a ; sinon la page entière,
   pour que l'application cherche les microdonnées. */
function extract({ url, html }) {
  const jsonld = [...html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1].trim()).filter(Boolean);
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1];
  const finalUrl = canonical && /^https?:\/\//i.test(canonical) ? canonical : url;
  return jsonld.some(b => /recipe/i.test(b)) ? { url: finalUrl, jsonld } : { url: finalUrl, html };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      return send(res, 200, await readFile(path.join(ROOT, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && u.pathname === '/api/extract') {
      const target = u.searchParams.get('url') || '';
      if (!/^https?:\/\//i.test(target)) throw new UserError('Saisissez une adresse complète, commençant par https://');
      return send(res, 200, extract(await fetchPage(target)));
    }
    send(res, 404, { error: 'Page introuvable.' });
  } catch (e) {
    if (e instanceof UserError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Erreur du serveur MyMenu.' });
  }
});

server.listen(PORT, () => console.log(`MyMenu : http://localhost:${PORT}`));
