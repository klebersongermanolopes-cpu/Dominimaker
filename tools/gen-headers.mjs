// Gera os arquivos de cabeçalho de produção a partir de config/security-policy.mjs.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { securityHeaders, VERCEL_PATH } from '../config/security-policy.mjs';

const headers = securityHeaders({ production: true });

export function netlifyHeaders() {
  const lines = ['/*'];
  for (const [key, value] of Object.entries(headers)) lines.push(`  ${key}: ${value}`);
  return lines.join('\n') + '\n';
}

export function vercelConfig() {
  return JSON.stringify({
    outputDirectory: 'site',
    cleanUrls: false,
    headers: [{
      source: VERCEL_PATH,
      headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
    }],
  }, null, 2) + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../site/_headers', import.meta.url), netlifyHeaders());
  writeFileSync(new URL('../vercel.json', import.meta.url), vercelConfig());
  console.log('Cabeçalhos gerados: site/_headers e vercel.json');
}
