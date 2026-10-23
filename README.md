# Madson Melo — site pessoal

Site estático (HTML + CSS + JS puro), publicado via GitHub Pages. Não tem build: edite os arquivos e faça commit.

| Arquivo | O que contém |
|---|---|
| `index.html` | Todos os textos, números, links e meta tags |
| `style.css` | Cores, fontes e layout |
| `script.js` | Animações (canvas da rede, contadores, scroll, tilt, cursor) |
| `og-image.png` | Imagem de prévia ao compartilhar o link (1200×630) |
| `favicon.svg` | Ícone da aba |

## Como editar (pelo próprio GitHub)

1. Abra `index.html` no GitHub → ícone de lápis (**Edit this file**).
2. Use **Ctrl+F** e procure por `EDITAR` — todos os pontos editáveis estão marcados.
3. Clique em **Commit changes**. O site atualiza em ~1 minuto.

### Pendências a preencher antes de divulgar

| O quê | Onde procurar (Ctrl+F) |
|---|---|
| URL do LinkedIn (4 lugares) | `SEU-PERFIL` |
| E-mail | `seu-email@exemplo.com` |
| Resultados dos cases | textos entre `[colchetes]` |
| Links e títulos dos 3 posts | `Título do post` |
| Anos da trajetória | `tl__year` |

### Números (contadores)

```html
<span class="counter" data-target="600" data-prefix="~" data-suffix=" mil">~600 mil</span>
```

- `data-target` → número final da animação
- `data-prefix` / `data-suffix` → texto antes/depois (opcionais)
- O texto entre as tags é o que aparece sem animação — mantenha igual ao resultado final.

### Cases

Cada case é um `<article class="case">` com Desafio / Ação / Resultado (`<dd>`). Para adicionar um case, copie um `<article>` inteiro.

### Expertise

Cada tag é um `<li class="chip">`. Adicione ou remova linhas.

### Cores e fontes

No topo de `style.css`, em `:root`: `--bg`, `--green`, `--blue`, `--light` etc.

## Endereço do site e SEO

As tags `canonical`, `og:url`, `og:image` e o JSON-LD usam:
`https://madsonscmelo-cyber.github.io/madsonscmelo.github.io-/`
Se renomear o repositório ou usar domínio próprio, procure por `madsonscmelo-cyber.github.io` no `index.html` e troque todas as ocorrências.

## Acessibilidade e desempenho

- `prefers-reduced-motion`: desliga scroll suave, canvas animado, tilt, cursor e contadores (mostra os valores finais).
- Se as bibliotecas da CDN falharem, todo o conteúdo aparece normalmente (sem animação).
- O canvas pausa quando sai da tela ou a aba fica oculta.

## Testar localmente

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```
