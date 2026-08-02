# Padrão de tipografia e cores — base Cielo

> **Valores lidos visualmente de capturas do site**, não extraídos do CSS nem do brand
> book. O ambiente bloqueia `cielo.com.br` por política de rede (403 no CONNECT), então
> não foi possível amostrar os hex na fonte. São aproximações fiéis o suficiente para
> desenhar, e devem ser conferidas contra os valores oficiais antes de qualquer coisa ir
> para produção. A troca está isolada em [`tokens.css`](./tokens.css).

Alvo de implementação: **React + Tailwind v4**.

---

## 1. Paleta

### Marca

| Papel | Hex aprox. | Onde aparece no site |
|-------|-----------|----------------------|
| `blue` | `#0a6aea` | Botões de ação, links, fundo do hero |
| `cyan` | `#00aeef` | Anel da seção "Dinheiro rápido na conta", ícones de linha |
| `navy` | `#12263f` | Todos os títulos de seção |
| `lime` | `#c8d400` | Faixa "Time Cielo", ícones da barra promocional |

O azul e o ciano são as duas cores centrais. Vale registrar o resultado do teste, porque
duas cores frias costumam falhar:

```
#0b5fd5 ↔ #00aeef    CVD ΔE 19.7 (deutan) · normal 21.2    PASS
```

(o teste rodou sobre `#0b5fd5`; o valor adotado no `tokens.css` é `#0a6aea`, vizinho — revalidar junto com os hex oficiais)

Passam com folga como par categórico — servem para Fraude × Crédito sem precisar de
muleta.

### Neutros

| Papel | Light | Dark (derivado) |
|-------|-------|-----------------|
| `bg` | `#ffffff` | `#0a1420` |
| `band` | `#f0f2f4` | `#0e1b2b` |
| `surface` | `#ffffff` | `#122236` |
| `tint` | `#eef2f7` | `#17293e` |
| `ink` | `#12263f` | `#eef3f8` |
| `ink-2` | `#4a5a6a` | `#9fb1c4` |
| `muted` | `#7b8896` | `#6b7f94` |
| `line` | `#dde3e9` | `#1e3048` |

O site é só claro. O modo escuro é derivação minha, mantendo o mesmo matiz.

### Semânticas

| Papel | Hex | Uso |
|-------|-----|-----|
| `good` | `#0ca30c` | Elegível |
| `warning` | `#c8d400` (lime) | Exceção — a lime da marca faz esse papel |
| `serious` | `#ec835a` | Deterioração |
| `critical` | `#d03b3b` | Furo, inconsistência, flip sem explicação |

## 2. Regras de contraste que o teste impôs

Duas cores da marca ficam abaixo de 3:1 sobre branco:

```
#00aeef   2.53 : 1     ciano
#c8d400   1.63 : 1     lime
```

Não são inutilizáveis — mudam de papel:

- **Ciano** só em preenchimento com rótulo direto ao lado, nunca como texto sobre branco
- **Lime** só como **faixa com texto navy por cima** — que é exatamente como o site usa em
  "Time Cielo". Navy sobre lime tem contraste alto; lime sobre branco não tem
- Nenhuma das duas carrega significado sozinha

## 3. Tipografia

A face institucional é uma **sans geométrica humanista** de terminais levemente
arredondados, com `a` de dois andares e `g` de um andar. Não consigo nomeá-la com
segurança a partir do print, e o CSP de artifacts bloqueia CDN de fonte — então a pilha
de sistema fica como substituta até o nome ser confirmado.

```
--sans: system-ui, -apple-system, "Segoe UI", sans-serif;
--mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

### A assinatura: peso misto na mesma linha

O padrão mais característico do site não é a fonte, é como ela é usada:

> **Te atender bem** e **estar ao seu lado** sempre que precisar
> **Maquininha sem aluguel** e sem taxas escondidas

Trechos em peso alto alternando com peso regular **dentro da mesma headline**, marcando o
que importa. Isso é reproduzível com qualquer face e vale adotar — é o que faz o texto
parecer Cielo mesmo sem a fonte oficial.

### Escala

| Nível | Tamanho | Peso | Cor |
|-------|---------|------|-----|
| Display | `clamp(30px, 4.4vw, 46px)` | 700 | `navy` |
| H2 | `clamp(21px, 2.6vw, 30px)` | 700 | `navy` |
| H3 | 17px | 600 | `navy` |
| Corpo | 16px | 400 | `ink-2` |
| Apoio | 14px | 400 | `ink-2` |
| Rótulo mono | 10–11px | 500 | `muted` |

Tracking praticamente neutro — o site não usa títulos apertados. Números em coluna com
`tabular-nums`.

## 4. Forma

Adotar a marca significou reescrever a linguagem de forma, não só trocar hex: o protótipo
anterior era instrumento de precisão — cantos vivos, denso, sem sombra — e a Cielo é o
oposto, arredondada e arejada.

Tokens de raio:

```
sm: 8px      inputs, chips
md: 12px     células de dado, faixas
lg: 16px     cartões
full: 9999px botões
```

Sombra de cartão: `0 2px 12px rgba(18, 38, 63, 0.08)`.

## 5. Layout

- Seções alternando **branco** e **cinza claro** (`bg`) em faixas de largura total
- Títulos de seção **centralizados**, com subtítulo abaixo
- Ícones em **linha** (não preenchidos), em `cyan` ou `blue`
- Respiro vertical generoso entre blocos

## 6. Ponto de troca

Só os blocos `:root` do [`tokens.css`](./tokens.css) mudam quando os valores oficiais
chegarem. Depois de trocar, **rode o validador de novo**:

```bash
node <caminho>/dataviz/scripts/validate_palette.js "<hex>,<hex>" \
  --mode light --surface "#ffffff"
```

Pendências para fechar o padrão:

1. **Hex exatos** do CSS ou do brand book
2. **Nome da família tipográfica** institucional
3. Se existe **design system interno** já publicado — se existir, ele manda, e este
   documento vira apenas o mapeamento para os componentes do painel
