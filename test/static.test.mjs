// Auditoria estática de tudo que vai para produção em site/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_CSP, buildCsp, securityHeaders } from '../config/security-policy.mjs';
import { netlifyHeaders, vercelConfig } from '../tools/gen-headers.mjs';
import { VIDEO_IDS } from '../site/assets/js/yt-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'site');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const files = walk(SITE);
const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => relative(SITE, file).replaceAll('\\', '/');
const ofType = (...exts) => files.filter((f) => exts.includes(extname(f)));
const index = read(join(SITE, 'index.html'));

test('HTML não tem script, estilo nem manipulador de evento embutido', () => {
  for (const file of ofType('.html')) {
    const html = read(file);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${rel(file)}: script embutido`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${rel(file)}: style embutido`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${rel(file)}: atributo style`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${rel(file)}: manipulador embutido`);
    assert.doesNotMatch(html, /(href|src)\s*=\s*["']\s*(javascript|data|vbscript):/i, `${rel(file)}: URL perigosa`);
    assert.doesNotMatch(html, /<(form|object|embed|base|applet)[\s>]/i, `${rel(file)}: elemento proibido`);
  }
});

test('JS não usa APIs de injeção nem execução dinâmica', () => {
  const forbidden = [
    /\beval\s*\(/, /\bnew\s+Function\b/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/,
    /document\.write/, /\.srcdoc\b/, /set(Timeout|Interval)\s*\(\s*['"`]/, /\blocalStorage\b/,
    /\bsessionStorage\b/, /document\.cookie/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/,
    /postMessage\s*\([^)]*,\s*['"`]\*['"`]/, /importScripts/, /\bimport\s*\(/,
  ];
  for (const file of ofType('.js')) {
    const source = read(file);
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${rel(file)}: ${pattern}`);
  }
});

test('todo endereço externo está na lista permitida', () => {
  const allowed = new Set([
    'www.youtube.com', 'www.instagram.com', 'i.ytimg.com', 'www.youtube-nocookie.com', 'www.w3.org',
  ]);
  for (const file of files.filter((f) => !f.endsWith('_headers'))) {
    for (const match of read(file).matchAll(/https?:\/\/[^\s"'`)<>;,]+/g)) {
      assert.ok(allowed.has(new URL(match[0]).hostname), `${rel(file)}: ${match[0]}`);
    }
    assert.doesNotMatch(read(file), /http:\/\/(?!www\.w3\.org)/, `${rel(file)}: http sem TLS`);
  }
});

test('links que abrem nova aba isolam a janela de origem', () => {
  const anchors = [...index.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const external = anchors.filter((a) => /target="_blank"/.test(a));
  assert.ok(external.length >= 6);
  for (const anchor of external) assert.match(anchor, /rel="noopener noreferrer"/, anchor);
  for (const anchor of anchors.filter((a) => /href="https?:/.test(a))) {
    assert.match(anchor, /target="_blank"/, anchor);
  }
});

test('o site aponta para o Instagram certo e só para os quatro vídeos', () => {
  assert.match(index, /https:\/\/www\.instagram\.com\/dominimaker\//);
  assert.deepEqual(new Set([...index.matchAll(/data-video="([^"]+)"/g)].map((m) => m[1])), new Set(VIDEO_IDS));
  const found = new Set([...index.matchAll(/(?:vi\/|watch\?v=)([A-Za-z0-9_-]{11})/g)].map((m) => m[1]));
  assert.deepEqual(found, new Set(VIDEO_IDS));
});

test('nada de segredo, caminho local nem dado pessoal na publicação', () => {
  const patterns = [
    /AKIA[0-9A-Z]{16}/, /ghp_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9-]{20,}/, /AIza[0-9A-Za-z_-]{30,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY/, /[A-Za-z]:\\Users\\/, /\/home\/[a-z]/,
    /Kleberson/i, /klebe\b/i, /miracena/i, /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i,
  ];
  for (const file of files) {
    for (const pattern of patterns) assert.doesNotMatch(read(file), pattern, `${rel(file)}: ${pattern}`);
  }
});

test('clientes não aparecem como lista no site', () => {
  assert.doesNotMatch(index, /Rogueon|MobilizaPop|Digital Conect/i);
});

test('publicação só tem tipos de arquivo esperados, sem mapas de código nem arquivos ocultos', () => {
  const okay = new Set(['.html', '.css', '.js', '.svg', '.txt']);
  for (const file of files) {
    const name = rel(file);
    if (name === '_headers') continue;
    assert.ok(okay.has(extname(file)), `tipo inesperado: ${name}`);
    assert.doesNotMatch(name, /(^|\/)\.(?!well-known\/)/, `arquivo oculto: ${name}`);
    assert.doesNotMatch(read(file), /sourceMappingURL/, `mapa de código: ${name}`);
  }
});

test('CSP não tem curinga, unsafe-inline nem unsafe-eval', () => {
  for (const csp of [buildCsp({ production: true }), buildCsp({ production: false }), META_CSP]) {
    assert.doesNotMatch(csp, /unsafe-|\*|data:|blob:|\bhttp:/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /require-trusted-types-for 'script'/);
  }
  assert.match(buildCsp({ production: true }), /frame-ancestors 'none'/);
  assert.match(buildCsp({ production: true }), /upgrade-insecure-requests/);
});

test('a meta CSP do HTML é idêntica à política central', () => {
  const meta = index.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(meta);
  assert.equal(meta[1], META_CSP);
});

test('_headers e vercel.json estão em dia com a política central', () => {
  assert.equal(read(join(SITE, '_headers')).replaceAll('\r\n', '\n'), netlifyHeaders());
  assert.equal(read(join(ROOT, 'vercel.json')).replaceAll('\r\n', '\n'), vercelConfig());
  const headers = securityHeaders({ production: true });
  assert.match(headers['Strict-Transport-Security'], /max-age=31536000/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  // Sem isto o player do YouTube mostra o Erro 153.
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
});

test('iframe do player nasce isolado', () => {
  const main = read(join(SITE, 'assets/js/main.js'));
  assert.match(main, /'sandbox', 'allow-scripts allow-same-origin allow-presentation'/);
  assert.doesNotMatch(main, /allow-top-navigation|allow-popups|allow-forms|allow-modals/);
  assert.match(main, /postMessage\(message, YT_ORIGIN\)/);
  assert.match(main, /contentWindow === event\.source/);
});

test('o projeto não tem dependências de terceiros', () => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.private, true);
});

test('security.txt é válido e não está vencido', () => {
  const text = read(join(SITE, '.well-known/security.txt'));
  assert.match(text, /^Contact: https:\/\//m);
  const expires = text.match(/^Expires: (.+)$/m);
  assert.ok(expires);
  assert.ok(new Date(expires[1]).getTime() > Date.now());
});
