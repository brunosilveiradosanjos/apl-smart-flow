# TC Smart Eligibility — Plano de Entrega

> Documento de planejamento. Nenhuma linha de código de aplicação foi escrita ainda.
> Objetivo: dar ao Product Owner do produto **TC (Vendeu tá na conta)** visibilidade e
> poder de decisão sobre as regras de elegibilidade — com IA aplicada onde ela
> genuinamente agrega, e não como enfeite.

---

## 1. Reframe do problema

O enunciado original pede "um dashboard para o PO ver os dados". Isso subvende o
problema real.

O Fluxo de Exceção é o **primeiro gate** da avaliação: quem está nele retorna elegível
para TCD0 e TCD1 imediatamente, sem que Prevenção STAR, Penhora/Fumaça, Fraudes ou
Crédito sejam sequer consultados. Os campos de elegibilidade vêm preenchidos com `1`,
mas isso não é resultado de avaliação — é o valor que o atalho grava.

> Para a população que passa pela Exceção, a decisão de risco **nunca é gerada**.
> Não existe log de override — existe ausência de dado.

Isso não é uma lacuna de visibilidade. É um **ponto cego estrutural**.

A entrega é bem-sucedida se o PO conseguir responder, sozinho e em minutos:

| # | Pergunta | O que ela exige |
|---|----------|-----------------|
| **P1** | Qual o volume que entra pelo atalho da Exceção? | Funil com o bypass explícito |
| **P2** | O que a Exceção realmente faz com quem passa por ela? | Desenho pré-pós sobre janelas encerradas (§6.7) |
| **P3** | A que custo real? | Taxa de expulsão pós-expiração hoje; outcome financeiro quando existir |
| **P4** | E se eu mexer nas regras? | Simulador What-If sobre a base |
| **P5** | Onde a base está inconsistente? | Violação de monotonicidade TCD0/TCD1 (§6.5) |
| **P6** | O produto responde de forma estável? | Volatilidade de decisão entre consultas (§6.6) |

Responder **P1** é um relatório. **P2**, **P5** e **P6** entregam números que hoje não
existem em lugar nenhum. É esse o alvo.

> Documentos irmãos: [`ARQUITETURA.md`](./ARQUITETURA.md) traz estrutura de pastas,
> regras de dependência e a lista de pacotes por fase; [`ANALISE-TEMPORAL.md`](./ANALISE-TEMPORAL.md)
> aprofunda granularidade, volatilidade e janela de exceção; [`PRODUTO-TC.md`](./PRODUTO-TC.md)
> guarda o contexto de negócio; [`design/TOKENS.md`](./design/TOKENS.md) o padrão visual.

---

## 2. Decisões já tomadas

| Tema | Decisão | Consequência no desenho |
|------|---------|-------------------------|
| **Dados** | Sintéticos gerados | Gerador é artefato de primeira classe, não script descartável. Acesso a dados atrás de adapter, para trocar por base real sem reescrita. |
| **LLM** | Indefinido | Provider abstraído atrás de interface. Com o AI SDK a troca Bedrock ↔ Anthropic ↔ Azure é uma linha. Decisão adiada sem custo. |
| **Prazo** | Sem prazo rígido | Construção incremental por fases; cada fase é demonstrável isoladamente e recebe uma tag git. |
| **Repositório** | Monorepo | `apps/api` + `apps/web` + `packages/contracts`. Tipagem end-to-end, um comando sobe tudo. |
| **Design** | Tokens próprios, React + Tailwind | Lovable descartado. Tokens em `docs/design/` — ver [`TOKENS.md`](./design/TOKENS.md). |

### 2.1. Stack

Ferramentas padrão do time, adotadas sem substituição:

| Camada | Ferramenta |
|--------|-----------|
| Runtime | **Node.js** |
| API | **NestJS** |
| ORM / persistência | **Sequelize** |
| Contratos e validação | **Zod** |
| Front-end | **React** (+ Vite) |
| Banco | **PostgreSQL** (JSONB) |

**Sequelize e as agregações analíticas.** O ORM cobre modelos, migrations e acesso
transacional. Mas as consultas que sustentam os painéis — window functions para
deduplicar por última consulta, `LAG`/`LEAD` para detectar flip, operadores JSONB,
views materializadas — não são o que um query builder faz bem, e tentar espremê-las no
builder produz código pior que o SQL equivalente.

A divisão fica explícita:

- **Sequelize (builder):** modelos, migrations, índices GIN e matviews declarados em
  migration com SQL bruto, escrita e leitura transacional simples
- **`sequelize.query()` com `replacements` e `QueryTypes.SELECT`:** todas as agregações
  analíticas — parametrizadas, portanto sem concatenação de string em nenhum caso

Isso não é contornar o ORM; é usá-lo para o que ele resolve e deixar o Postgres fazer
agregação, coerente com §5.1. As consultas analíticas ficam isoladas nos repositories,
uma por use case, testáveis contra base real.

**Sequelize e Zod não competem.** São fronteiras diferentes: Sequelize modela a linha
persistida, Zod modela o contrato que entra e sai da aplicação. A camada anti-corrupção
(§4.6) é exatamente onde um vira o outro — a linha do Sequelize entra, o objeto de
domínio validado por Zod sai. Nenhum tipo do ORM vaza para o domínio, para a API ou para
as tools do agente.

---

## 3. Princípios inegociáveis

### 3.1. O LLM nunca calcula um número

Ele **escolhe ferramentas** e **narra resultados**. Todo número exibido vem de um use
case determinístico, versionado e coberto por teste.

Em meios de pagamento, isso é a fronteira entre protótipo divertido e código que pode ir
para produção: auditabilidade, reprodutibilidade e a capacidade de explicar a origem de
qualquer valor na tela.

### 3.2. O LLM nunca vê identificador de pessoa

O campo `id` é CPF/CNPJ — dado pessoal — e é **obrigatório e sempre presente**. O `ec`,
que seria a alternativa natural, **pode vir nulo**. Não existe no payload um
identificador simultaneamente não-PII e sempre presente.

Solução: a camada de infraestrutura deriva um **`merchantRef`** — hash determinístico do
`id` (SHA-256 truncado) — que é a única referência a cliente exposta acima dela.

- Sempre presente, porque o `id` é obrigatório
- Estável ao longo do tempo, o que viabiliza toda a análise longitudinal (§4.5)
- Opaco e não reversível: seguro para frontend, LLM e URL de drill-down
- O `id` não sai da camada de infraestrutura

### 3.3. Uma regra de negócio, dois consumidores

O botão do What-If na UI e a tool do agente chamam **o mesmo use case**. Nunca há duas
implementações da mesma regra. É a demonstração mais limpa de SOLID aplicado a IA — e é
o slide de fechamento da apresentação.

### 3.4. Um schema, três usos

Cada contrato é definido uma vez em Zod, em `packages/contracts`, e serve como DTO
validado no NestJS, tipo estático no React e schema da tool exposta ao agente.

### 3.5. IA entra sobre fundação pronta, nunca antes

As Fases 0→2 são inteiramente determinísticas: os números existem, são testados e estão
na tela antes de qualquer LLM tocar neles. Só então o agente entra (Fase 3), e entra
como navegação sobre dados já validados. Invertida a ordem, a entrega vira um chatbot
alucinando sobre números que ninguém conferiu.

---

## 4. O fluxo de elegibilidade real

```
Solicitação de verificação
│
├─[1]─ Fluxo de Exceção?          SIM ──► ELEGÍVEL {tcd0:1, tcd1:1}   ⚠ atalho
│                                          (nenhum modelo é consultado)
├─[2]─ Prevenção STAR reprova?    SIM ──► INELEGÍVEL {tcd0:0, tcd1:0}
│
├─[3]─ Penhora / Fumaça reprova?  SIM ──► INELEGÍVEL {tcd0:0, tcd1:0}
│
└─[4]─ Avaliação de risco (simultânea)
       ├── Prevenção a Fraudes  → modeloFraudes  → elegibilidadeFraudes {tcd0, tcd1}
       └── Risco de Crédito     → modeloCredito  → elegibilidadeCredito {tcd0, tcd1}
                                                    │
                                                   AND por trilho
                                                    ▼
                                        elegibilidade {tcd0, tcd1}
```

Regras confirmadas:

- **Gates 1–3 são terminais e binários**, com resultado idêntico nos dois trilhos e nas
  duas dimensões.
- **Gate 4 é paralelo e por trilho.**
- **Combinação é AND por trilho.** Verificado contra todos os exemplos fornecidos.
- **Semântica dos trilhos:** `TCD0` é a modalidade *"Hoje"* (mesmo dia) e `TCD1` a
  modalidade *"Amanhã"* (dia seguinte) — modalidades comerciais distintas do mesmo
  produto, não estágios. **TCD0 é o trilho mais restritivo**: antecipa mais e mais cedo,
  logo expõe mais. Ver [`PRODUTO-TC.md`](./PRODUTO-TC.md).
- **Monotonicidade esperada:** `tcd0 = 1` deveria implicar `tcd1 = 1` — quem passa no
  mais difícil deveria passar no mais fácil. `{tcd0:0, tcd1:1}` é o **caso comum**
  (elegível só ao dia seguinte); `{tcd0:1, tcd1:0}` é o **estado anômalo**, e ocorre em
  produção (§6.5).
- **Invariante do modelo:** sem `ec` resolvido e chegando ao gate 4, o cliente é sempre
  avaliado por `M1` nas duas dimensões. A recíproca **não** vale — `M1` também ocorre com
  `ec` presente. Vira regra de validação na ingestão e caso de teste.

### 4.1. Payload real

```jsonc
{
  "id": "9189ARC9891",                        // CPF/CNPJ — PII, sempre presente
  "ec": 1234567890,                           // 10 posições — PODE SER NULL
  "elegibilidadeFraudes": { "tcd0": 1, "tcd1": 1 },
  "elegibilidadeCredito": { "tcd0": 1, "tcd1": 0 },
  "modeloFraudes": "M1",                      // modelo OU gate terminal
  "modeloCredito": "M2",                      // modelo OU gate terminal
  "elegibilidade":  { "tcd0": 1, "tcd1": 0 }  // AND por trilho
  // + campo de data de consulta (coluna adicional na tabela)
}
```

### 4.2. Os campos `modelo*` são polimórficos

`modeloFraudes` e `modeloCredito` carregam **duas semânticas distintas** no mesmo campo:

| Valor | Significado | Gate de saída derivado |
|-------|-------------|------------------------|
| `EXCECAO` | Gate 1 encerrou — nenhum modelo rodou | `EXCEPTION` |
| `PREVENCAO` | Gate 2 encerrou | `STAR` |
| `PENHORAEFUMACA` | Gate 3 encerrou | `LIEN` |
| `M1` / `M2` / `M3` | Gate 4 avaliou, com este modelo | `RISK` |

**Consequência prática:** o gate de saída e o marcador de passagem pela Exceção são
**deriváveis do payload atual**. Não é preciso alterar a instrumentação de produção — é
trabalho de tradução na camada de infraestrutura, papel do Repository Pattern.

Duas armadilhas embutidas:

**a) `M1` de fraude ≠ `M1` de crédito.** Os conjuntos se sobrepõem nos nomes mas são
espaços distintos. Um enum único permitiria agregações sem sentido, do tipo "taxa de
aprovação do M1" somando as duas dimensões. No domínio serão **tipos separados**
(`FraudModel` e `CreditModel`, branded types), impedindo a mistura em tempo de compilação.

**b) O modelo é proxy de maturidade do cliente.** Modelos mais fracos atendem clientes
novos ou recém-credenciados; mais fortes atendem vigentes ativos. Isso o torna uma
**dimensão de segmentação disponível de imediato**, sem depender de MCC ou porte. Mas
comparar taxa de aprovação entre modelos é **viés de seleção** — populações diferentes,
não performances comparáveis. O dashboard sinaliza isso onde a comparação aparecer.

### 4.3. `ec` nulo não significa "não é cliente Cielo"

Este é o ponto mais fácil de errar na leitura dos dados.

O cruzamento é feito apenas contra a **base de clientes ativos**, por decisão de
engenharia para reduzir volume. Logo `ec = null` significa **"não resolvido na base
ativa"**, e agrupa duas populações distintas:

1. **Cliente novo** — quer contratar o TC no ato da filiação e ainda não possui EC
2. **Cliente vigente inativo** — já é cliente Cielo, mas está fora da base de cruzamento

Consequências:

- O nome `isCredenciado` seria **semanticamente falso**. O modelo de domínio usa
  `hasResolvedEc`, e a UI rotula como *"sem EC resolvido (novo ou inativo)"*.
- Existe um **viés de amostragem estrutural no produto**: clientes inativos são tratados
  como se fossem novos, e recebem sempre o modelo mais fraco (`M1`).
- Afirmações do tipo *"a Exceção está concentrada em clientes novos"* são **inválidas**
  sem uma fonte adicional que separe as duas populações (§11).

Esse achado é um entregável em si: o produto tem um ponto cego de segmentação, além do
ponto cego de decisão da §1.

### 4.4. Regra de integridade na ingestão

Nos gates terminais, `modeloFraudes` e `modeloCredito` carregam sempre o mesmo valor.
Divergência entre eles (um terminal, outro modelo) é registro corrompido. Junto com a
invariante `ec` nulo → `M1`, alimenta um contador de qualidade de dados na UI.

### 4.5. Granularidade: consulta ≠ cliente

Um mesmo cliente pode ser consultado **um número indefinido de vezes por dia**. Isso é o
fato de maior impacto sobre a modelagem analítica, e a fonte de erro mais provável de
todo o projeto.

**O risco:** se a unidade de análise for a consulta, um cliente integrado que consulta 500
vezes por dia pesa 500× mais no funil do que um que consulta uma vez. O funil deixaria de
descrever a base de clientes e passaria a descrever o padrão de tráfego de quem integrou.

**A solução:** duas métricas explicitamente distintas, com alternância visível na UI.

| Métrica | Unidade | Uso |
|---------|---------|-----|
| **Clientes distintos** (padrão) | `merchantRef` | Visão de negócio — é o que o PO quer |
| **Volume de consultas** | registro | Visão operacional — capacidade, custo, tráfego |

**Deduplicação:** ao contar clientes distintos, a decisão representativa no período é a
**última consulta** (estado corrente). Primeira consulta fica disponível como alternativa,
para analisar entrada versus estado final.

Isso torna o `merchantRef` (§3.2) infraestrutura crítica, não só uma medida de privacidade:
sem ele não há como agrupar consultas do mesmo cliente.

### 4.6. Modelo de domínio derivado

O payload permanece intocado. A infraestrutura traduz para o modelo que o domínio, a
aplicação e a UI enxergam:

```jsonc
{
  "merchantRef": "a3f9c2...",     // hash do id — nunca o CPF/CNPJ
  "ec": 1234567890,               // nullable
  "hasResolvedEc": true,          // ec != null — NÃO significa "é credenciado"
  "consultedAt": "2026-07-14T13:22:41Z",

  "exitGate": "RISK",             // EXCEPTION | STAR | LIEN | RISK
  "viaException": false,          // exitGate === EXCEPTION
  "riskOutcome": "DENIED_CREDIT", // APPROVED | DENIED_FRAUD | DENIED_CREDIT | DENIED_BOTH

  "fraudModel": "M1",             // null nos gates terminais
  "creditModel": "M2",            // null nos gates terminais

  "elegibilidadeFraudes": { "tcd0": 1, "tcd1": 1 },
  "elegibilidadeCredito": { "tcd0": 1, "tcd1": 0 },
  "elegibilidade":        { "tcd0": 1, "tcd1": 0 },

  "isInconsistent": false,        // tcd0 === 1 && tcd1 === 0
  "inconsistencySource": null     // FRAUD | CREDIT | BOTH
}
```

Campos ainda dependentes de confirmação (§11): segmentação e outcome.

---

## 5. Arquitetura

```
apps/web  (React + Vite)
   │  Sankey por trilho · Inconsistência · Volatilidade · Contrafactual · What-If · Chat
   │
   ▼  HTTP / SSE
apps/api  (NestJS)
   │
   ├─ Agent Layer      tools (Zod) = wrappers finos dos use cases
   │                   SEM acesso a banco. SEM SQL gerado por LLM. SEM PII.
   │
   ├─ Application      GetFunnel · GetInconsistencyReport · GetVolatilityReport
   │                   GetExceptionCounterfactual · SimulateScenario · ExplainDecision
   │                   CompareCohorts · DetectAnomalies · ValidateEngine
   │
   ├─ Domain           motor de regras puro, sem I/O, 100% testável
   │                   entidades: Merchant · Decision · Gate · Track · Rule · Scenario
   │
   └─ Infrastructure   ACL de tradução do payload · repositories JSONB (GIN + matviews)
                       LlmProvider (adapter plugável)

packages/contracts    schemas Zod compartilhados (fonte única de verdade)
```

A **camada anti-corrupção (ACL)** concentra toda a tradução das §4.2 a §4.6: derivação de
`exitGate`, `merchantRef`, `isInconsistent`, `hasResolvedEc` e a separação de tipos entre
modelos de fraude e de crédito. O domínio nunca vê o campo polimórfico.

### 5.1. Agregação fica no Postgres, não no Node

O plano original previa Streams do Node.js. **Revisto.** Trazer milhões de linhas para o
pod do EKS a fim de agregar em JavaScript é mais lento, mais caro e mais frágil do que
deixar o banco fazer aquilo em que é bom. E com múltiplas consultas por cliente por dia
(§4.5), a tabela é ordens de grandeza maior que a base de clientes — o que torna a decisão
ainda mais clara.

- Simulação What-If → **SQL parametrizado sobre o JSONB**
- Índices **GIN** nas keys quentes, e índice de suporte a `(merchantRef, consultedAt)`
  para a deduplicação por última consulta
- **Views materializadas** para os cortes fixos do funil, com refresh agendado
- Node orquestra, valida e tipa; Postgres agrega

### 5.2. Vercel AI SDK, não LangChain.js

Em um NestJS com injeção de dependência e SOLID, LangChain traz abstrações que competem
com o container do Nest. O AI SDK é fino, tipado com Zod, tem streaming nativo, generative
UI de primeira classe e abstração de provider embutida — o que resolve de graça a decisão
adiada de LLM.

---

## 6. Visualização

### 6.1. Arquitetura de informação — do panorama ao caso especial

A ordem de leitura não segue o interesse analítico, segue o volume. A maior parte da
base é decidida no gate 4 pelos modelos; Exceção, STAR e Penhora/Fumaça são caminhos de
borda. Abrir pela Exceção — como este plano fazia — faz uma borda parecer o produto e
distorce a noção de proporção antes de qualquer número aparecer.

| Nível | Conteúdo | Pergunta que o PO faz aqui |
|-------|----------|---------------------------|
| **1 · Panorama** | Composição por gate de saída e matriz dimensão × modelo (§6.2) | "Como a base está sendo decidida?" |
| **2 · Detalhe do cenário** | Por modelo: drift, decomposição da reprovação, inconsistência, volatilidade | "O que mudou, e onde?" |
| **3 · Caminhos especiais** | Exceção (pré-pós, contrafactual, vigência), STAR, Penhora/Fumaça | "E os casos que fogem do fluxo?" |

**O agente é o mecanismo de descida.** Em vez de construir vinte telas de drill-down, o
panorama é a única tela fixa e o agente faz a travessia sob demanda: o PO lê o resumo,
pergunta *"por que o M3 de crédito caiu essa semana?"*, e recebe o nível 2 daquele
recorte. Isso muda o papel do chat de recurso lateral para **camada de navegação** — e
resolve estruturalmente o problema do chatbot órfão (§8.3), em vez de apenas mitigá-lo.

Para a apresentação, a ordem também é melhor dramaturgia: base → detalhe → anomalia.
Chega-se à Exceção tendo estabelecido a proporção, em vez de abrir por ela.

### 6.2. Panorama por modelo (nível 1)

Primeira tela. Precisa responder "como a base está sendo decidida" sem induzir a
conclusão errada — e o risco aqui é concreto.

**A armadilha:** colocar M1, M2 e M3 lado a lado numa barra ranqueada por taxa de
aprovação convida à leitura *"M3 aprova mais, logo M3 é melhor"*. Como o modelo é proxy
de maturidade do cliente (§4.2b), são populações diferentes — as taxas **não são
comparáveis entre si**. Se a primeira tela ranqueia, o PO forma a crença em segundos e
nenhuma nota de rodapé desfaz depois.

**A estrutura que impede a leitura errada:** uma matriz **dimensão × modelo**, não uma
lista de três. Fraude e Crédito usam os mesmos rótulos para modelos diferentes (§4.2a),
e a matriz comunica isso de saída.

```
                    M1                M2                M3
  Fraude        volume · share    volume · share         —
                taxa por trilho   taxa por trilho
                tendência 30d     tendência 30d

  Crédito       volume · share    volume · share    volume · share
                taxa por trilho   taxa por trilho   taxa por trilho
                tendência 30d     tendência 30d     tendência 30d
```

Cada célula declara a **população que atende** antes da taxa. A tendência é a comparação
que de fato vale: **do mesmo modelo ao longo do tempo**, nunca entre modelos. Onde
qualquer corte cruzado aparecer, o aviso de viés de seleção acompanha o número.

Acima da matriz, uma faixa de composição mostra quanto da base sequer chegou ao gate 4 —
é o que dá contexto de proporção para os caminhos especiais do nível 3.

### 6.3. Um Sankey por trilho

Sankey representa mal paralelismo e reconvergência, e o gate 4 é exatamente isso.

Solução: **um Sankey por trilho, com toggle TCD0 / TCD1**. Dentro de um trilho toda
decisão é binária e o diagrama fica limpo:

```
Clientes distintos no período
   ├──► Fluxo de Exceção ─────────────────────────────► ELEGÍVEL   ⚠ atalho
   ├──► Prevenção STAR ───────────────────────────────► Inelegível
   ├──► Penhora / Fumaça ─────────────────────────────► Inelegível
   └──► Avaliação de risco
            ├──► Reprovado só em Fraude ──────────────► Inelegível
            ├──► Reprovado só em Crédito ─────────────► Inelegível
            ├──► Reprovado em ambos ──────────────────► Inelegível
            └──► Aprovado em ambos ───────────────────► ELEGÍVEL
```

Decompor o gate 4 por causa revela **qual modelo é o gargalo dominante**.

Regras visuais:

- O link da Exceção é o **único elemento em cor de alerta** da tela
- Rótulo direto: `Exceção: 12.400 clientes · 18% das elegibilidades`
- Alternância explícita **clientes distintos / volume de consultas** (§4.5)
- **Delta vs. período anterior** em cada nó
- Clique em qualquer nó → drill-down do coorte
- Filtros de primeira classe: **EC resolvido × não resolvido** e **modelo**

### 6.4. Matriz TCD0 × TCD1

|              | TCD1 = 1 (dia seguinte) | TCD1 = 0 |
|--------------|-------------------------|----------|
| **TCD0 = 1** (mesmo dia) | ambos | ⚠ **anômalo** |
| **TCD0 = 0** | só dia seguinte — *caso comum* | nenhum |

O quadrante `{tcd0:1, tcd1:0}` viola a monotonicidade esperada e é destacado como
anomalia: o cliente foi aprovado no trilho mais restritivo e reprovado no mais
permissivo. Todos os quadrantes são clicáveis.

### 6.5. Painel de Inconsistência (P5)

Requisito explícito: expor os casos em que `tcd0 = 1` e `tcd1 = 0` — o cliente foi
aprovado no trilho **mais restritivo** (mesmo dia) e reprovado no **mais permissivo**
(dia seguinte). Ocorre em produção sem que deveria.

Atenção ao sentido: `{tcd0:0, tcd1:1}` é o **caso comum e legítimo** — elegível só ao dia
seguinte. Inverter o predicado faria o painel apontar para a população normal.

Duas propriedades reduzem o espaço de investigação antes de qualquer consulta ao banco.

**A anomalia é sempre herdada, nunca emergente.** Como a combinação é AND por trilho,
`elegibilidade.tcd0 = 1` exige que *ambas* as dimensões tenham `tcd0 = 1`; e
`elegibilidade.tcd1 = 0` exige que *ao menos uma* tenha `tcd1 = 0`. Essa dimensão passa
então a ter `tcd0 = 1` e `tcd1 = 0` — já está anômala por si só. Não existe caso em que o
estado inválido surja da composição de duas dimensões válidas.

A consequência é prática: **sempre há um modelo identificável na origem**.

| Origem | Condição | Leitura |
|--------|----------|---------|
| `FRAUD` | `elegibilidadeFraudes` = `{tcd0:1, tcd1:0}` | O modelo de fraude produz o estado inválido |
| `CREDIT` | `elegibilidadeCredito` = `{tcd0:1, tcd1:0}` | O modelo de crédito produz |
| `BOTH` | ambas violam | Problema sistêmico |

**Toda anomalia nasce no gate 4.** Nos gates terminais as duas dimensões recebem
valores idênticos (`{1,1}` na Exceção, `{0,0}` em STAR e Penhora/Fumaça), nenhum dos quais
viola a monotonicidade. Logo `exitGate = RISK` é condição necessária.

O painel entrega volume e taxa de violações com evolução temporal, distribuição por
origem, concentração por modelo e por status de EC, e lista drill-down por `merchantRef`,
exportável para o time responsável.

### 6.6. Painel de Volatilidade (P6)

Se um cliente pode ser consultado várias vezes no mesmo dia (§4.5), então ele pode
**receber respostas diferentes no mesmo dia**. Isso é mensurável com o dado que já existe
e ninguém está olhando.

Métricas, restritas a clientes com duas ou mais consultas no período:

- **Taxa de flip** — % que mudou de `elegibilidade` dentro do período
- **Direção** — inelegível→elegível versus elegível→inelegível
- **Transições de gate** — notadamente `RISK → EXCEPTION` e `EXCEPTION → RISK`
- **Oscilação múltipla** — clientes que alternam mais de uma vez, sinal de instabilidade
- **Concentração** — por modelo, por status de EC, por período do dia

Duas leituras de negócio saem daqui. A primeira é de experiência: um cliente que recebe
"não" e depois "sim" na mesma tarde percebe o produto como inconsistente. A segunda é
operacional: se a resposta depende de quando se pergunta, o número de aprovações depende
do padrão de tráfego de quem integrou, não da base.

### 6.7. Painel da Exceção — desenho pré-pós (P2)

A Exceção tem vigência com início e fim, geralmente curta. Logo o mesmo cliente é avaliado
pelos modelos **fora** da janela, antes ou depois. A decisão que a Exceção suprimiu não é
inobservável — está em outra linha da tabela, deslocada no tempo.

Isso substitui a estimativa por coorte comparável e o *shadow run* por **medição direta**,
num desenho em que o cliente é seu próprio controle — sem viés de seleção, porque não se
compara quem entrou na Exceção com quem não entrou, e sim o mesmo cliente em dois regimes.

```
Clientes com janela encerrada e decisão de modelo dos dois lados (n=7.100 · 57% da população)

  Reprovado antes  →  Reprovado depois      62%    a Exceção foi um furo temporário
  Reprovado antes  →  Aprovado depois       23%    a Exceção funcionou como rampa
  Aprovado antes   →  Aprovado depois       12%    a Exceção era desnecessária
  Aprovado antes   →  Reprovado depois       3%    o cliente piorou durante a janela
```

O quadrante **Aprovado → Aprovado** é o de maior valor imediato: volume que pode sair da
Exceção **sem alterar decisão nenhuma**, reduzindo a exposição do mecanismo a custo zero
de negócio. E o quadrante **Reprovado → Aprovado** impede a leitura ingênua de que a
Exceção seja apenas um furo: se for relevante, o mecanismo tem função real e o dashboard
passa a informar como calibrá-lo, não como desligá-lo.

Metodologia, cobertura e ressalvas em [`ANALISE-TEMPORAL.md §2`](./ANALISE-TEMPORAL.md).

**Proxy de outcome disponível hoje (P3):** a coorte *Reprovado depois* mede quantos
clientes entraram no produto pela Exceção e **perderam elegibilidade assim que a janela
expirou**. Não é custo financeiro, é custo de decisão e de relacionamento — mas está
inteiramente no dado atual. Quando o outcome financeiro aparecer, encaixa como coluna
adicional na mesma tabela, sem redesenho.

### 6.8. Painel What-If (P4)

Controles para ligar/desligar e parametrizar regras, com recorte por segmento (ex.:
*desligar a Exceção apenas para clientes sem EC resolvido*). Ao aplicar, o Sankey mostra
**estado atual vs. simulado lado a lado**, com delta de elegibilidade e delta de risco
assumido.

---

## 7. Dados: o gerador é o roteiro da demo

Com massa sintética, o gerador deixa de ser utilitário e passa a ser peça central. Ele
precisa produzir:

**a) Múltiplas consultas por cliente**, com distribuição realista (cauda longa: poucos
clientes com centenas de consultas, muitos com uma só). Sem isso, §4.5 e §6.6 não têm o
que medir, e o funil pareceria correto por acidente.

**b) Flips de decisão** entre consultas do mesmo cliente, incluindo entradas e saídas do
Fluxo de Exceção — que alimentam tanto P6 quanto o contrafactual por observação direta.

**c) Distribuições realistas**, respeitando a invariante `ec` nulo → `M1` e a correlação
entre maturidade, presença de EC, modelo aplicado e probabilidade de aprovação.

**d) As duas subpopulações de `ec` nulo** (novo e vigente inativo) com perfis de risco
distintos, para demonstrar o custo do ponto cego de segmentação da §4.3.

**e) Decisão sombra para a população da Exceção**, oculta do payload padrão — gabarito
para validar o método de coorte comparável.

**f) Outcome correlacionado com o perfil** — inadimplência e fraude realizada. Sem
outcome, **P3** não tem resposta nem fictícia.

**g) Inconsistências plantadas** nas três origens da §6.5, em proporções distintas.

**h) Cenários plantados** — insights escondidos na massa, para descoberta ao vivo:

| Cenário plantado | O que o PO descobre na demo |
|------------------|-----------------------------|
| Subgrupo da Exceção que os modelos reprovariam e que inadimple 3× mais | A Exceção tem custo concentrado e identificável |
| Cliente que oscila entre elegível e inelegível no mesmo dia | O produto responde de forma instável |
| Funil muito diferente por consulta vs. por cliente distinto | A métrica errada conta uma história errada |
| Inconsistência TCD0/TCD1 crescendo, originada num modelo específico | O painel aponta o responsável |
| Vigentes inativos escondidos entre os "clientes novos" | O ponto cego de segmentação tem custo real |
| Divergências entre decisão gravada e motor recalculado | O `ValidateEngine` acha regra não documentada |

**i) Seed determinístico** — a mesma massa em qualquer máquina, sempre.

### 7.1. Auditoria do motor

Com dados sintéticos não é possível provar fidelidade contra produção — comparar o motor
com uma decisão que o próprio gerador produziu é circular. O que se entrega é o
**mecanismo**, validado pelas divergências plantadas em (h):

- `ValidateEngine` compara decisão gravada × decisão recalculada
- Indicador na UI: `Fidelidade do simulador: 99,2% (1,2M registros)`
- Relatório das divergências agrupadas por padrão

Argumento na apresentação: *"o simulador não pede fé — ele se audita. Plugue a base real e
ele informa a própria fidelidade."*

---

## 8. Camada de IA

### 8.1. Os cinco usos

| # | Uso | Implementação |
|---|-----|---------------|
| 1 | **Agente com tools** | Pergunta em linguagem natural → tool call tipada → use case determinístico |
| 2 | **Narrativa automática** | Deltas calculados em código; LLM apenas redige. Renderizada no topo, sem o PO precisar perguntar |
| 3 | **Explicação de decisão** | Gate de saída, modelo e histórico de consultas traduzidos para linguagem de negócio |
| 4 | **Triagem de anomalia** | Detecção estatística em código; LLM prioriza e contextualiza |
| 5 | **Generative UI** | O agente responde com **gráfico**, não parágrafo — tool result renderizado como componente React |

### 8.2. Tools expostas ao agente

Espelham 1:1 os use cases, com schema Zod compartilhado:

```
getFunnel(track, period, unit, segment?)     → funil no trilho; unit = clientes | consultas
getInconsistencyReport(period, groupBy?)     → violações TCD0/TCD1 e origem
getVolatilityReport(period, groupBy?)        → flips, direção e transições de gate
getExceptionCounterfactual(period, segment?) → o que os modelos teriam decidido
simulateScenario(rules[], track, segment?)   → impacto de mudança de regra
explainDecision(merchantRef)                 → gate, modelo, histórico e motivo
compareCohorts(cohortA, cohortB)             → perfil e outcome comparados
detectAnomalies(period)                      → desvios estatísticos
```

Nenhuma tool aceita ou retorna `id`. `merchantRef` é a única referência a cliente.
Toda tool que conta clientes exige `unit` explícito — não há default implícito capaz de
produzir a leitura errada da §4.5.

### 8.3. O chat é a camada de navegação, não um recurso lateral

O risco do chatbot órfão — caixa de texto vazia que ninguém usa — não se resolve com
mitigação de UI. Resolve-se dando a ele uma função que nenhuma outra parte da interface
cumpre.

Com a arquitetura de informação em três níveis (§6.1), essa função existe: **o agente é
o mecanismo de descida**. O panorama é a única tela fixa; a passagem para o nível 2 e
para o nível 3 acontece por pergunta, não por vinte telas de drill-down construídas à
mão. Isso troca esforço de front-end por capacidade de consulta e, principalmente, dá ao
chat um papel do qual a navegação depende.

Complementos que continuam valendo:

- **Perguntas sugeridas contextuais**, que mudam conforme o nível e o recorte ativo
- **Resumo executivo automático** já renderizado no panorama
- Resposta em **streaming**, com o gráfico aparecendo antes de o texto terminar

### 8.4. O que separa isto de um brinquedo

- **Evals em CI** — ~20 perguntas douradas com respostas esperadas, quebrando o build em regressão
- **Tracing** de chamadas LLM (OpenTelemetry ou Langfuse) — latência, custo, tool calls
- **Guardrails** — allowlist de tools, validação Zod dos argumentos, bloqueio de PII
- **Prompt caching** para custo previsível

### 8.5. Copiloto de Concessão — onde a IA tem o maior retorno

Toda a camada de IA descrita até aqui serve para **analisar** o que já aconteceu. Mas o
gargalo real do produto não é analítico: a Exceção é concedida por **análise humana,
sempre**, a partir de pedidos por e-mail ou Teams, sem critério registrado, sem reason code
e sem trilha de auditoria.

É o ponto do sistema onde IA tem o maior retorno — e onde ela deixa de ser demonstração
para virar redução de trabalho mensurável.

**O que o copiloto faz.** Diante de uma solicitação, monta um dossiê de decisão chamando
os *mesmos use cases* que alimentam o dashboard:

| Evidência | Use case |
|-----------|----------|
| O que os modelos dizem sobre este cliente hoje | `ExplainDecision` |
| Histórico de consultas, flips e estabilidade | `GetVolatilityReport` |
| Já teve exceção antes? Qual foi o desfecho pré-pós? | `GetExceptionHistory` |
| Como terminaram clientes de perfil semelhante que receberam exceção | `CompareCohorts` |

O analista recebe evidência consolidada e recomendação com justificativa; **decide**; e a
decisão é registrada de forma estruturada — quem, quando, por quê, sobre qual evidência.

**O que o copiloto não faz.** Ele não concede exceção. Decisão automatizada sobre acesso a
crédito tem implicação regulatória direta — inclusive o direito à revisão previsto na LGPD
— e o desenho é deliberadamente *human-in-the-loop*: a IA reúne e recomenda, a pessoa
decide. Nenhuma tool do copiloto tem efeito de escrita sobre a vigência.

**A triagem que se paga sozinha.** O quadrante *Aprovado → Aprovado* (§6.7) mostra
clientes que os modelos aprovariam de qualquer forma. Para esses, a solicitação pode ser
respondida **sem consumir análise humana** — e isso não é a IA decidindo risco, é a IA
informando que a pergunta era desnecessária. Segura, defensável, e o ganho é imediato.

**Efeito de segunda ordem.** Cada decisão registrada estruturadamente é dado que hoje não
existe. O motivo da concessão sai do texto livre e vira variável — o que torna possível,
pela primeira vez, medir consistência entre analistas, correlacionar motivo com desfecho e
eventualmente propor critério objetivo. O copiloto **produz a instrumentação que falta**.

Arquiteturalmente, isto é o princípio §3.3 levado ao limite: **uma regra de negócio, três
consumidores** — dashboard, agente analítico e copiloto de concessão, sem nenhuma
reimplementação.

---

## 9. Fases de entrega

Cada fase é demonstrável sozinha e recebe uma tag git.

### Fase 0 — Fundação
- Monorepo (pnpm workspaces), lint, format, CI
- ACL de tradução do payload (§4.2 → §4.6) com testes contra os exemplos reais
- Gerador sintético com seed, múltiplas consultas, flips, sombra, outcome e cenários plantados
- `packages/contracts` com os primeiros schemas Zod

**Pronto quando:** `pnpm dev` sobe tudo e o banco tem massa reproduzível.

A ordem segue os três níveis da §6.1 — panorama, detalhe, caminhos especiais — e não a
ordem em que os achados apareceram na análise.

### Fase 1 — Panorama (nível 1)
- Repositories JSONB, índices GIN e de deduplicação, views materializadas
- `GetModelOverview` — matriz dimensão × modelo, com população declarada e tendência
- `GetFunnel` por trilho, período, unidade e segmento
- Sankey por trilho + matriz TCD0×TCD1, com deltas e drill-down

**Pronto quando:** o PO responde "como a base está sendo decidida?" e **P1** sozinho.

### Fase 2 — Detalhe dos cenários (nível 2)
- `GetInconsistencyReport` e `GetVolatilityReport` com seus painéis
- Drift por modelo e decomposição da reprovação por causa

**Pronto quando:** o PO responde **P5** e **P6** sozinho.

### Fase 3 — Agente como camada de navegação
- `LlmProvider` plugável, agente com as tools dos níveis 1 e 2
- Narrativa automática e explicação de decisão
- Chat com streaming e generative UI

**Pronto quando:** uma pergunta em linguagem natural desce do panorama ao detalhe com o
gráfico correto.

*Entra aqui, e não depois, porque a partir de dois níveis o agente substitui telas de
drill-down em vez de decorá-las (§6.1, §8.3). Antes disso não teria o que navegar.*

### Fase 4 — Caminhos especiais (nível 3)
- Motor de regras puro no domínio, com cobertura de teste
- `GetExceptionCounterfactual`, priorizando observação direta sobre coorte comparável
- Auditoria de vigência e exceções não utilizadas
- `SimulateScenario` em SQL parametrizado, `ValidateEngine` e indicador de fidelidade
- Painel What-If com comparação lado a lado
- STAR e Penhora/Fumaça

**Pronto quando:** o PO responde **P2**, **P3** e **P4**. *Aqui a entrega deixa de ser dashboard e vira ferramenta de decisão.*

> **Trade-off assumido.** Esta fase concentra o resultado mais forte da entrega e agora
> vem depois do agente. Se o tempo apertar, é ela que precisa ser protegida — não a
> Fase 5.

### Fase 5 — Maturidade
- Evals em CI, tracing, guardrails
- Performance (índices revisados, cache, refresh de matviews)
- Roteiro de demo ensaiado

**Pronto quando:** a entrega se defende sozinha sob perguntas técnicas.

### Fase 6 — Copiloto de Concessão *(opcional, alto impacto)*
- Dossiê de decisão montado sobre os use cases já existentes
- Triagem automática dos casos que os modelos já aprovam
- Registro estruturado da decisão humana

**Pronto quando:** uma solicitação real de exceção é respondida com evidência em vez de
intuição.

Custo marginal baixo — os use cases já existem desde a Fase 4, e o que falta é uma tela e
um prompt. Fica fora do caminho crítico do desafio, mas é o que transforma a entrega de
"visibilidade para o PO" em "intervenção no processo". Vale ao menos como protótipo
demonstrável na apresentação.

---

## 10. Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Unidade de análise por consulta em vez de cliente | **Crítico** — o funil descreveria tráfego de integração, não a base | §4.5: métrica dupla, default por cliente distinto, `unit` obrigatório nas tools |
| Campo de data sem hora | **Crítico** — sem ordenação intradiária não há deduplicação por última consulta nem volatilidade | Confirmar cedo (§11); se for só data, P6 muda de escopo e a dedup passa a ser por dia |
| Não existe outcome disponível | **Crítico** — P3 fica sem resposta | Confirmar cedo (§11). Sem outcome a entrega se apoia em P1/P2/P4/P5/P6 |
| `ec` nulo lido como "cliente novo" | Alto — conclusão inválida sobre o perfil da Exceção | §4.3: rótulo honesto, e o dashboard nunca afirma "novo" sem fonte que separe |
| Mistura de `M1` de fraude com `M1` de crédito | Alto — agregações sem sentido | Branded types separados, erro em tempo de compilação |
| Motor do simulador diverge do sistema real | Alto — decisão sobre número errado | `ValidateEngine` + indicador de fidelidade na UI |
| Agente alucina números | Alto — perda total de credibilidade | Princípio §3.1 + evals em CI + guardrails |
| PII (CPF/CNPJ) trafegando para o LLM | Alto — risco regulatório | `merchantRef` desde o commit 1 (§3.2) |
| Contrafactual por matching lido como medição | Médio — decisão sobre estimativa | Rótulo do método usado + `n` visível + erro medido contra a sombra sintética |
| Comparação de taxa entre modelos lida como performance | Médio — conclusão inválida por viés de seleção | Aviso na UI onde a comparação aparece |
| Agregação lenta na base cheia | Médio — demo trava | Agregação no Postgres, GIN, matviews, medição desde a Fase 1 |

---

## 11. Pontos abertos

Hipóteses adotadas para não bloquear a Fase 0.

1. **Quais campos a tabela de vigência possui?** Solicitante, aprovador, motivo, canal,
   prazo pedido versus concedido — cada um destrava uma dimensão de análise do processo de
   concessão. *Hipótese adotada: apenas identificador do cliente, início e fim.*
2. **Existe registro das solicitações negadas**, ou a tabela guarda só as aprovadas? Se só
   as aprovadas, há viés de sobrevivência e não é possível medir a taxa de aprovação da
   análise manual nem aprender com as recusas. *Hipótese adotada: apenas aprovadas.*
3. **Qual o volume mensal de solicitações de exceção?** Define se a Fase 5 se paga.
   *Hipótese adotada: volume relevante o suficiente para justificar a triagem.*
4. **Qual a duração típica da janela de exceção?** Define o horizonte da análise pré-pós.
   *Hipótese adotada: dias a poucas semanas.*
5. **A reavaliação após a expiração é automática** ou depende de nova solicitação? Muda a
   interpretação da taxa de expulsão. *Hipótese adotada: nova consulta espontânea.*
6. **Existe fonte que separe cliente novo de vigente inativo** quando `ec` é nulo? Sem
   ela, as duas populações permanecem agrupadas e o dashboard não pode afirmar qual
   predomina. *Hipótese adotada: não disponível; rótulo conjunto.*
7. **Existe outcome financeiro** (inadimplência, fraude confirmada, churn) e em que
   janela? Em pesquisa pelo time. Não bloqueia: **P3** opera com a taxa de expulsão
   pós-expiração (§6.7) até que exista. *Hipótese adotada: ausente por ora, plugável.*
8. **Existem reason codes** para reprovação em STAR e Penhora/Fumaça? Enriqueceriam o
   `ExplainDecision`, mas não bloqueiam. *Hipótese adotada: não disponíveis.*
9. **Atributos de segmentação** além de modelo e status de EC (MCC, porte, UF, tempo de
   casa). *Hipótese adotada: sintéticos, plugáveis quando existirem.*
10. **Critério de roteamento entre M2 e M3** — informado pelo time como não prioritário
    agora. Até lá o dashboard trata modelo como proxy de maturidade e sinaliza o viés de
    seleção.
