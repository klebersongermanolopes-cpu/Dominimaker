# Segurança do site Dominimaker

Site estático: sem servidor próprio, banco de dados, login, formulário, cookies ou dependências de terceiros. Isso elimina a maior parte das falhas comuns, porque não há dado de visitante para roubar nem servidor de aplicação para invadir. O risco que sobra é o site ser adulterado, ser embutido em outra página ou carregar algo de fora.

## Ameaças e proteções

| Ameaça | Proteção |
|---|---|
| Injeção de script (XSS) | CSP sem `unsafe-inline` e sem `unsafe-eval`, Trusted Types obrigatório, nenhum `innerHTML` no código |
| Script de terceiros comprometido | Nenhum script externo. A API de JavaScript do YouTube não é carregada; o player é controlado por `postMessage` |
| Player do YouTube acessando a página | Iframe com `sandbox` e sem `allow-top-navigation`, `allow-popups`, `allow-forms` ou `allow-modals` |
| Mensagem falsa para o player | Confere origem e janela de origem, limita o tamanho e só aproveita campos numéricos |
| Troca do vídeo exibido | Lista fixa com os 4 IDs. Qualquer outro ID é recusado antes de virar URL |
| Clickjacking | `frame-ancestors 'none'` e `X-Frame-Options: DENY` |
| Vazamento de dados para fora | `connect-src 'none'`, `form-action 'none'`, imagens só de `i.ytimg.com` |
| Rebaixamento para HTTP | HSTS e `upgrade-insecure-requests` em produção |
| Aba aberta controlando o site | `rel="noopener noreferrer"` em todo link externo e `Cross-Origin-Opener-Policy` |
| Abuso de recursos do navegador | `Permissions-Policy` nega câmera, microfone, localização, pagamento, USB e sensores |
| Cadeia de suprimentos | Zero dependências, com `package-lock.json` vazio de pacotes |
| Dados pessoais | Sem cookies próprios, sem analytics, sem armazenamento local, fontes do próprio sistema |

## Limites do GitHub Pages

O Pages não permite cabeçalhos próprios. Na prática:

| Proteção | No GitHub Pages |
|---|---|
| CSP, Trusted Types, referrer | Valem pela meta tag |
| HTTPS e HSTS | O GitHub fornece com **Enforce HTTPS** ligado |
| Clickjacking (`frame-ancestors`, `X-Frame-Options`) | Não dá para enviar. O `main.js` esconde a página quando embutida, o que cobre o caso comum mas não substitui o cabeçalho |
| COOP, CORP, Permissions-Policy | Ausentes |
| `/.well-known/security.txt` | Só vale na raiz de um domínio próprio, não em `usuario.github.io/repo/` |

Se quiser a proteção completa, use Cloudflare Pages, Netlify ou Vercel, que já têm os arquivos prontos, ou ponha o Cloudflare na frente de um domínio próprio. Ative também 2FA na conta do GitHub e proteja a branch `main`.

## Por que o Referrer-Policy não é mais fechado

O YouTube exige saber a origem da página. Com `no-referrer`, o player mostra o **Erro 153** e o filme não toca. Por isso a política é `strict-origin-when-cross-origin`, que envia só o domínio, nunca o caminho. Os pôsteres usam `no-referrer`, pois não precisam disso.

## Como rodar os testes

```bash
npm test
```

```bash
npm audit
```

## O que foi testado

**Automático (`npm test`, 38 testes: 37 passam e 1 é pulado neste Windows):** path traversal em 23 variações, byte nulo, injeção de CRLF, URL gigante, métodos proibidos, arquivos ocultos, vazamento em mensagens de erro, Host malicioso, cabeçalhos em todas as respostas, tipos MIME, varredura por segredos e dados pessoais, lista de domínios externos, validação do player, mensagens forjadas e poluição de protótipo.

**No navegador, com a política ativa (Chromium), todos bloqueados:** `eval`, `new Function`, `innerHTML`, script embutido, script externo, `fetch` para outro domínio, imagem de rastreio, iframe externo, CSS externo, atributo `style`, troca de `<base>` e envio de formulário. Uma mensagem forjada para o player foi ignorada.

## O que ainda precisa ser verificado depois de publicar

Estes pontos dependem do domínio real e não podem ser testados localmente:

1. Conferir os cabeçalhos em https://securityheaders.com e o TLS em https://www.ssllabs.com/ssltest/.
2. Confirmar que a hospedagem aplicou o arquivo de cabeçalhos. A meta tag protege o básico, mas não cobre `frame-ancestors`, HSTS nem `X-Frame-Options`.
3. Ativar 2FA na conta da hospedagem, do domínio e do YouTube. É nelas que está o maior risco real, e nenhum código resolve isso.
4. Renovar `site/.well-known/security.txt` antes de 01/11/2027.

## Limites desta auditoria

- Testes automatizados e autoataque não substituem um pentest feito por terceiros.
- O teste de link simbólico é pulado no Windows sem privilégio de administrador.
- O YouTube é um terceiro: quando o player carrega, ele recebe IP e dados de acesso do visitante. O modo `youtube-nocookie` reduz cookies, mas não anula isso. O rodapé do site avisa o visitante. Como o vídeo toca sozinho, avalie com um advogado se a LGPD exige consentimento prévio no seu caso.

## Alterar a política

Edite `config/security-policy.mjs`, rode `npm run headers` e copie a nova `META_CSP` para a meta tag de `site/index.html`. Os testes falham se algum desses arquivos ficar diferente.
