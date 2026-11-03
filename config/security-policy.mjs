// Fonte única da política de segurança. Servidor local, _headers e vercel.json saem daqui,
// e os testes conferem que nenhum deles divergiu.

const YT = 'https://www.youtube-nocookie.com';

const BASE_CSP = [
  ["default-src", "'none'"],
  ["script-src", "'self'"],
  ["style-src", "'self'"],
  ["img-src", "'self'", 'https://i.ytimg.com'],
  ["frame-src", YT],
  ["connect-src", "'none'"],
  ["font-src", "'none'"],
  ["media-src", "'none'"],
  ["object-src", "'none'"],
  ["manifest-src", "'none'"],
  ["worker-src", "'none'"],
  ["base-uri", "'none'"],
  ["form-action", "'none'"],
  ["require-trusted-types-for", "'script'"],
  ["trusted-types", "'none'"],
];

const join = (list) => list.map((parts) => parts.join(' ')).join('; ');

// Versão da meta tag: frame-ancestors é ignorado em meta, e por isso só vai no cabeçalho.
export const META_CSP = join(BASE_CSP);

export function buildCsp({ production = true } = {}) {
  const directives = [...BASE_CSP, ["frame-ancestors", "'none'"]];
  if (production) directives.push(['upgrade-insecure-requests']);
  return join(directives);
}

export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
  `autoplay=(self "${YT}")`,
  `encrypted-media=(self "${YT}")`,
  'fullscreen=(self)',
  'picture-in-picture=()',
].join(', ');

export function securityHeaders({ production = true } = {}) {
  const headers = {
    'Content-Security-Policy': buildCsp({ production }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // O player do YouTube exige a origem no Referer: uma política mais fechada dá Erro 153.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-DNS-Prefetch-Control': 'off',
    'Origin-Agent-Cluster': '?1',
  };
  if (production) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export const VERCEL_PATH = '/(.*)';
