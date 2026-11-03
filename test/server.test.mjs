// Ataques reais contra o servidor local, por socket cru para o cliente não "limpar" a URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSiteServer, safePath } from '../tools/serve.mjs';
import { buildCsp } from '../config/security-policy.mjs';

let server, port;

before(async () => {
  server = createSiteServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(() => server.close());

function raw(request, target = port) {
  return new Promise((resolve, reject) => {
    const socket = connect(target, '127.0.0.1', () => socket.write(request));
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(data));
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
    socket.setTimeout(4000, () => socket.destroy());
  });
}
const get = (path, method = 'GET') => raw(`${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
const status = (response) => Number(response.split(' ', 2)[1]);

test('página principal responde com todos os cabeçalhos de segurança', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-security-policy'), buildCsp({ production: false }));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(res.headers.get('server'), null);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('cabeçalhos também saem em respostas de erro e em todo tipo de arquivo', async () => {
  for (const path of ['/assets/js/main.js', '/assets/css/site.css', '/assets/favicon.svg', '/robots.txt', '/nao-existe.html']) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.ok(res.headers.get('content-security-policy'), path);
    await res.arrayBuffer();
  }
});

test('tipos MIME corretos, com script servido como JavaScript', async () => {
  const cases = {
    '/': 'text/html; charset=utf-8',
    '/assets/js/main.js': 'text/javascript; charset=utf-8',
    '/assets/css/site.css': 'text/css; charset=utf-8',
    '/assets/favicon.svg': 'image/svg+xml',
    '/.well-known/security.txt': 'text/plain; charset=utf-8',
  };
  for (const [path, type] of Object.entries(cases)) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), type, path);
    await res.arrayBuffer();
  }
});

const TRAVERSALS = [
  '/../package.json', '/../../package.json', '/../config/security-policy.mjs', '/assets/../../package.json',
  '/%2e%2e/package.json', '/%2E%2E/package.json', '/.%2e/package.json', '/%2e./package.json',
  '/..%2fpackage.json', '/..%2Fpackage.json', '/assets/..%2f..%2fpackage.json',
  '/..%5cpackage.json', '/..\\package.json', '/assets\\..\\..\\package.json', '/%5c..%5cpackage.json',
  '/%252e%252e/package.json', '/%252e%252e%252fpackage.json', '/....//package.json', '/..;/package.json',
  '/C:/Windows/win.ini', '/C:%5cWindows%5cwin.ini', '//etc/passwd', '/%2fetc%2fpasswd',
];

test('nenhuma variação de path traversal escapa da pasta do site', async () => {
  for (const path of TRAVERSALS) {
    const response = await get(path);
    assert.notEqual(status(response), 200, path);
    assert.doesNotMatch(response, /"name": "dominimaker"|security-policy|\[fonts\]|root:x:/, path);
  }
});

test('byte nulo, controle e URL malformada não quebram o servidor', async () => {
  for (const path of ['/index.html%00.txt', '/%00', '/%0d%0aX-Injetado:%20sim', '/%', '/%zz', '/%c0%ae%c0%ae/package.json']) {
    const response = await get(path);
    assert.equal(status(response), 400, path);
    assert.doesNotMatch(response, /^X-Injetado/m, path);
  }
  assert.equal(status(await get('/')), 200);
});

test('arquivos ocultos, de configuração e fora da lista não são servidos', async () => {
  for (const path of ['/.env', '/.git/config', '/assets/.hidden', '/_headers', '/.well-known/../_headers', '/server.mjs', '/index.html.bak']) {
    assert.notEqual(status(await get(path)), 200, path);
  }
});

test('só GET e HEAD são aceitos', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'CONNECT']) {
    const target = method === 'CONNECT' ? 'localhost:80' : '/';
    const response = await raw(`${method} ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (method === 'CONNECT') {
      // O Node encerra CONNECT sem resposta quando não há tratador: nada é aberto.
      assert.doesNotMatch(response, /^HTTP\/1\.1 200/);
      continue;
    }
    assert.equal(status(response), 405, method);
    assert.match(response, /Allow: GET, HEAD/i, method);
  }
  const head = await get('/', 'HEAD');
  assert.equal(status(head), 200);
  assert.equal(head.split('\r\n\r\n')[1], '');
});

test('URL gigante é recusada', async () => {
  const code = status(await get('/' + 'a'.repeat(3000)));
  assert.equal(code, 414);
  // Cabeçalho acima do limite do Node: responde 431 ou derruba a conexão. Os dois recusam.
  const huge = await get('/' + 'a'.repeat(200000)).then(status, (error) => error.code);
  assert.ok([431, 414, 'ECONNRESET', 'EPIPE'].includes(huge), `recebeu ${huge}`);
});

test('erros não vazam caminho, pilha nem reflexo da entrada', async () => {
  const probe = '/<script>alert(1)</script>.html';
  for (const path of [probe, '/nao-existe', '/%zz']) {
    const response = await get(path);
    assert.doesNotMatch(response, /<script>alert|node:internal|Error:|[A-Za-z]:\\|at .+\.mjs/, path);
  }
});

test('Host malicioso não vira redirecionamento', async () => {
  const response = await raw('GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n');
  assert.equal(status(response), 200);
  assert.doesNotMatch(response, /^Location:/im);
  assert.doesNotMatch(response, /evil\.example/);
});

test('o servidor só resolve caminhos de dentro da raiz', () => {
  assert.equal(safePath('/'), 'index.html');
  assert.equal(safePath('/assets/js/main.js?x=1'), 'assets/js/main.js');
  assert.equal(safePath('/.well-known/security.txt'), '.well-known/security.txt');
  assert.equal(safePath('/assets/.well-known/x.txt'), null);
  assert.equal(safePath('../x'), null);
  assert.equal(safePath(undefined), null);
});

test('link simbólico apontando para fora da raiz não é seguido', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'dominimaker-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'root');
  mkdirSync(root);
  writeFileSync(join(root, '404.html'), 'nao encontrado');
  writeFileSync(join(base, 'segredo.txt'), 'SEGREDO');
  try {
    symlinkSync(join(base, 'segredo.txt'), join(root, 'atalho.txt'));
  } catch {
    t.skip('este sistema não permite criar link simbólico sem privilégio');
    return;
  }
  const local = createSiteServer({ root });
  await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
  t.after(() => local.close());
  const response = await raw('GET /atalho.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', local.address().port);
  assert.equal(status(response), 404);
  assert.doesNotMatch(response, /SEGREDO/);
});
