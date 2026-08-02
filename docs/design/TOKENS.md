# Padrão de tipografia e cores

> **Estes valores são um ponto de partida, não os tokens oficiais da Cielo.**
> O ambiente desta sessão bloqueia `cielo.com.br` por política de rede, então não foi
> possível extrair a paleta real do site. O que está aqui é uma paleta na família
> cromática da marca (azul + verde), construída e validada por script, montada para ser
> **trocada em um único lugar** quando os valores oficiais chegarem — ver §5.

Alvo de implementação: **React + Tailwind**.

---

## 1. Cores de marca

| Papel | Light | Dark | Uso |
|-------|-------|------|-----|
| `brand` | `#0057b8` | `#2e86e0` | Ação primária, volume no funil, dimensão Fraude |
| `brand-alt` | `#00a758` | `#14a05f` | Dimensão Crédito, confirmação |
| `brand-ink` | `#003a7a` | `#4c9ee8` | Hover e estados pressionados |

Validado com `scripts/validate_palette.js` do skill `dataviz`, contra as superfícies reais
de cada modo:

```
light  #0057b8 ↔ #00a758   CVD ΔE 29.3 · normal 31.1 · contraste ≥3:1   PASS
dark   #2e86e0 ↔ #14a05f   CVD ΔE 21.5 · normal 22.9 · contraste ≥3:1   PASS
```

## 2. Neutros

Puxados levemente para o azul da marca — cinza puro lê como não escolhido.

| Papel | Light | Dark |
|-------|-------|------|
| `bg` (plano da página) | `#f4f6f9` | `#0a1119` |
| `surface` (cartão) | `#ffffff` | `#101b26` |
| `sunken` (faixa interna) | `#e8ecf2` | `#0d1620` |
| `ink` (texto primário) | `#0b1a2b` | `#eef3f8` |
| `ink-2` (secundário) | `#44566b` | `#a2b3c4` |
| `muted` (rótulo, eixo) | `#7a8b9c` | `#6d8095` |
| `line` (régua) | `#d7dee7` | `#1c2b3a` |

## 3. Cores semânticas

Reservadas. Nunca reaproveitadas como cor de série, e nunca sozinhas — sempre com
rótulo ou marca ao lado.

| Papel | Hex | Significado no produto |
|-------|-----|------------------------|
| `good` | `#0ca30c` | Elegível, rampa funcionou |
| `warning` | `#fab219` | Exceção desnecessária, desperdício |
| `serious` | `#ec835a` | Deterioração durante a janela |
| `critical` | `#d03b3b` | Furo, inconsistência, flip sem explicação |

**Regra que evita o problema de daltonismo:** preenchimentos grandes usam **uma cor só**
(a marca). As cores semânticas aparecem apenas em **marcas pequenas com rótulo** — chip,
ponto, régua de topo. Verde e cinza em blocos grandes lado a lado falham para
deuteranopia (ΔE 5.5 medido); em marca pequena com rótulo, o texto carrega o significado.

## 4. Tipografia

A face institucional da Cielo não pôde ser confirmada (§ nota do topo), e o CSP de
artifacts bloqueia CDN de fonte. Até lá, pilha de sistema — o ponto de troca está isolado
em duas variáveis.

| Papel | Família | Uso |
|-------|---------|-----|
| `sans` | `system-ui, -apple-system, "Segoe UI", sans-serif` | Títulos e corpo |
| `mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Rótulos, códigos, todo número em coluna |

Escala e pesos:

| Nível | Tamanho | Peso | Tracking |
|-------|---------|------|----------|
| Display | `clamp(29px, 4.4vw, 45px)` | 760 | −0.035em |
| H2 | `clamp(19px, 2.4vw, 24px)` | 660 | −0.02em |
| H3 | 15px | 620 | −0.008em |
| Corpo | 15px | 400 | — |
| Apoio | 13px | 400 | — |
| Rótulo mono | 10px | 400–600 | +0.14em, caixa alta |

Números em coluna usam `font-variant-numeric: tabular-nums`. Números grandes isolados
(valor de destaque) usam figuras proporcionais — `tabular-nums` deixa `121` frouxo em
corpo grande.

## 5. Ponto de troca

Quando os valores oficiais chegarem, só o bloco `theme.extend.colors` do
`tailwind.tokens.js` muda. Nada no código de componente referencia hex diretamente.

Depois de trocar, **rode o validador de novo** — a paleta da marca precisa passar nas
mesmas portas:

```bash
node .claude/skills/../dataviz/scripts/validate_palette.js "<hex>,<hex>" \
  --mode light --surface "#ffffff"
```

Três caminhos para obter os valores reais:

1. Colar os hex aqui diretamente
2. Enviar o brand book em PDF — o skill `pdf` já está instalado e extrai as cores
3. Liberar `cielo.com.br` na política de rede do ambiente
   ([documentação](https://code.claude.com/docs/en/claude-code-on-the-web)), que hoje
   responde 403 no CONNECT
