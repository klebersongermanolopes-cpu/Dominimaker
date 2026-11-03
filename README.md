# Dominimaker

Portfólio de Dominik. Um voo por um dia inteiro no céu: o nome escrito em nuvens reais, e os filmes aparecendo entre elas e rodando sozinhos conforme a pessoa rola a página.

## Rodar no computador

Precisa só do Node 20 ou mais novo. Não há nada para instalar.

```bash
npm start
```

Depois abra http://127.0.0.1:4173. Abrir o `index.html` direto com dois cliques não funciona, porque os módulos e o YouTube exigem um endereço http.

## Publicar

A pasta publicada é `site/`.

### GitHub Pages (gratuito)

1. Crie um repositório público no GitHub, por exemplo `dominimaker`.
2. Envie **todo o conteúdo desta pasta** para ele, inclusive a pasta oculta `.github`. Pelo GitHub Desktop isso é automático; pelo site, arraste os arquivos e confira que `.github/workflows/pages.yml` subiu.
3. No repositório, abra **Settings → Pages** e em **Source** escolha **GitHub Actions**.
4. A cada envio na branch `main`, o workflow roda `npm test` e só publica se tudo passar. O endereço sai como `https://SEU-USUARIO.github.io/dominimaker/`.
5. Em **Settings → Pages**, marque **Enforce HTTPS**. Para usar domínio próprio, preencha **Custom domain** ali mesmo.

O GitHub Pages não deixa definir cabeçalhos HTTP, então a proteção vem da meta tag de CSP e de uma trava no `main.js` que esconde a página se alguém tentar embuti-la. Detalhes em [SECURITY.md](SECURITY.md).

### Outras hospedagens

- **Netlify ou Cloudflare Pages:** aponte a pasta de publicação para `site`. O arquivo `site/_headers` é aplicado sozinho e dá a proteção completa.
- **Vercel:** publique a raiz do projeto. O `vercel.json` já define a pasta e os cabeçalhos.

Depois de publicar, siga a lista em [SECURITY.md](SECURITY.md).

## Trocar ou adicionar um filme

1. Em `site/index.html`, copie um bloco `<section class="scene scene-reel" ...>` e troque o ID do vídeo, os textos e a duração.
2. Em `site/assets/js/yt-core.js`, inclua o ID na lista `VIDEO_IDS`. Vídeos fora da lista não tocam, de propósito.
3. Rode `npm test`.

## Onde mexer

| Arquivo | O que controla |
|---|---|
| `site/index.html` | Todos os textos e links |
| `site/assets/css/site.css` | Blocos, tipografia e cores da interface |
| `site/assets/js/flight.js` | Roteiro do voo e horários do dia (lista `DAY`) |
| `site/assets/js/sky.js` | Aparência das nuvens |
| `config/security-policy.mjs` | Política de segurança |

## Acessibilidade e aparelhos

- Quem pede movimento reduzido no sistema, ou não tem WebGL2, recebe uma versão estática com os mesmos textos, e o vídeo só carrega com um clique.
- Sem JavaScript, a página continua legível e os links do YouTube funcionam.
- A qualidade das nuvens se ajusta sozinha à velocidade do aparelho.
