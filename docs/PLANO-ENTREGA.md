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
Crédito sejam sequer consultados. Os campos de elegibilidade do payload vêm preenchidos
com `1`, mas isso não é resultado de avaliação — é o valor que o atalho grava.

> Para a população que passa pela Exceção, a decisão de risco **nunca é gerada**.
> Não existe log de override — existe ausência de dado.

Isso não é uma lacuna de visibilidade. É um **ponto cego estrutural**.

A entrega é bem-sucedida se o PO conseguir responder, sozinho e em minutos:

| # | Pergunta | O que ela exige |
|---|----------|-----------------|
| **P1** | Qual o volume que entra pelo atalho da Exceção? | Funil com o bypass explícito |
| **P2** | Quanto risco isso mascara? | Contrafactual sobre a população da Exceção (§6.4) |
| **P3** | A que custo real? | Cruzamento decisão × outcome (inadimplência / fraude realizada) |
| **P4** | E se eu mexer nas regras? | Simulador What-If sobre a base |
| **P5** | Onde a base está inconsistente? | Detecção de violação de monotonicidade TCD0/TCD1 (§6.3) |

Responder **P1** é um relatório. **P2** e **P5** entregam números que hoje não existem em
lugar nenhum. É esse o alvo.

---

## 2. Decisões já tomadas

| Tema | Decisão | Consequência no desenho |
|------|---------|-------------------------|
| **Dados** | Sintéticos gerados | Gerador é artefato de primeira classe, não script descartável. Acesso a dados atrás de adapter, para trocar por base real sem reescrita. |
| **LLM** | Indefinido | Provider abstraído atrás de interface. Com o AI SDK a troca Bedrock ↔ Anthropic ↔ Azure é uma linha. Decisão adiada sem custo. |
| **Prazo** | Sem prazo rígido | Construção incremental por fases; cada fase é demonstrável isoladamente e recebe uma tag git. |
| **Repositório** | Monorepo | `apps/api` + `apps/web` + `packages/contracts`. Tipagem end-to-end, um comando sobe tudo. |

---

## 3. Princípios inegociáveis

### 3.1. O LLM nunca calcula um número

Ele **escolhe ferramentas** e **narra resultados**. Todo número exibido vem de um use
case determinístico, versionado e coberto por teste.

Em meios de pagamento, isso é a fronteira entre protótipo divertido e código que pode ir
para produção: auditabilidade, reprodutibilidade e a capacidade de explicar a origem de
qualquer valor na tela.

### 3.2. O LLM nunca vê identificador de pessoa

O campo `id` é CPF/CNPJ — dado pessoal. E o `ec`, que seria a alternativa natural,
**pode vir nulo** (clientes ainda não credenciados). Não existe, no payload, um
identificador simultaneamente não-PII e sempre presente.

Solução: a camada de infraestrutura deriva um **`merchantRef`** — hash determinístico do
`id` (SHA-256 truncado) — que é a única referência a cliente exposta acima dela.

- Estável ao longo do tempo, permite ligar decisões do mesmo cliente
- Opaco, não reversível, seguro para frontend, LLM e URL de drill-down
- Funciona com `ec` nulo
- O `id` não sai da camada de infraestrutura

Quando a base real entrar, não há retrabalho nem risco de vazamento.

### 3.3. Uma regra de negócio, dois consumidores

O botão do What-If na UI e a tool do agente chamam **o mesmo use case**. Nunca há duas
implementações da mesma regra. É a demonstração mais limpa de SOLID aplicado a IA — e é
o slide de fechamento da apresentação.

### 3.4. Um schema, três usos

Cada contrato é definido uma vez em Zod, em `packages/contracts`, e serve como DTO
validado no NestJS, tipo estático no React e schema da tool exposta ao agente. Uma
definição, três consumidores, zero divergência.

### 3.5. IA entra por último

Fases 0→2 são inteiramente determinísticas. A camada de IA (Fase 3) é construída sobre
fundação já validada. Invertida, a entrega vira um chatbot alucinando sobre dados que
ninguém conferiu.

---

## 4. O fluxo de elegibilidade real

Sequência de avaliação de uma solicitação, conforme especificado pelo time:

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

- **Gates 1–3 são terminais e binários.** Encerram a avaliação, com resultado idêntico
  para ambos os trilhos e para ambas as dimensões.
- **Gate 4 é paralelo e por trilho.** Fraudes e Crédito avaliam simultaneamente, cada um
  emitindo decisão independente para TCD0 e TCD1.
- **Combinação é AND por trilho.** Qualquer `0` em uma das dimensões zera a elegibilidade
  final naquele trilho. Verificado contra todos os exemplos fornecidos.
- **Monotonicidade esperada:** `tcd1 = 1` deveria implicar `tcd0 = 1`. O estado
  `{tcd0:0, tcd1:1}` é **inconsistente** — e ocorre em produção hoje (§6.3).

### 4.1. Payload real

```jsonc
{
  "id": "9189ARC9891",                        // CPF/CNPJ alfanumérico — PII
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

Este é o achado central da modelagem. `modeloFraudes` e `modeloCredito` carregam **duas
semânticas distintas** no mesmo campo:

| Valor | Significado | Gate de saída derivado |
|-------|-------------|------------------------|
| `EXCECAO` | Gate 1 encerrou — nenhum modelo rodou | `EXCEPTION` |
| `PREVENCAO` | Gate 2 encerrou | `STAR` |
| `PENHORAEFUMACA` | Gate 3 encerrou | `LIEN` |
| `M1` / `M2` / `M3` | Gate 4 avaliou, com este modelo | `RISK` |

**Consequência prática:** tanto o gate de saída quanto o marcador de passagem pela
Exceção são **deriváveis do payload atual**. Não é preciso alterar a instrumentação de
produção — é trabalho de tradução na camada de infraestrutura, que é precisamente o papel
do Repository Pattern.

Duas armadilhas que essa modelagem esconde:

**a) `M1` de fraude ≠ `M1` de crédito.** Os conjuntos se sobrepõem nos nomes mas são
espaços distintos (fraude usa ao menos `M1`/`M2`; crédito usa `M1`/`M2`/`M3`). Um enum
único permitiria agregações sem sentido, do tipo "taxa de aprovação do M1" somando as
duas dimensões. No domínio serão **tipos separados** (`FraudModel` e `CreditModel`,
branded types), impossibilitando a mistura em tempo de compilação.

**b) O modelo é proxy de maturidade do cliente.** Modelos mais fracos atendem clientes
novos ou recém-credenciados; mais fortes atendem vigentes ativos. Isso torna o modelo uma
**dimensão de segmentação disponível de imediato** — sem depender de MCC ou porte. Mas
também significa que comparar taxa de aprovação entre modelos é **viés de seleção**: são
populações diferentes, não performances comparáveis. O dashboard sinalizará isso onde a
comparação aparecer, em vez de bloquear a análise.

### 4.3. Regra de integridade na ingestão

Nos gates terminais, `modeloFraudes` e `modeloCredito` carregam sempre o mesmo valor.
Divergência entre eles (um terminal, outro modelo) é registro corrompido. A validação
entra na ingestão e alimenta um contador de qualidade de dados na UI.

### 4.4. Modelo de domínio derivado

O payload permanece intocado. A camada de infraestrutura traduz para o modelo abaixo,
que é o que o domínio, a aplicação e a UI enxergam:

```jsonc
{
  "merchantRef": "a3f9c2...",     // hash do id — nunca o CPF/CNPJ
  "ec": 1234567890,               // nullable; null = ainda não credenciado
  "isCredenciado": true,          // derivado de ec != null
  "consultedAt": "2026-07-14T13:22:41Z",

  "exitGate": "RISK",             // EXCEPTION | STAR | LIEN | RISK
  "viaException": false,          // exitGate === EXCEPTION
  "riskOutcome": "DENIED_CREDIT", // APPROVED | DENIED_FRAUD | DENIED_CREDIT | DENIED_BOTH

  "fraudModel": "M1",             // null nos gates terminais
  "creditModel": "M2",            // null nos gates terminais

  "elegibilidadeFraudes": { "tcd0": 1, "tcd1": 1 },
  "elegibilidadeCredito": { "tcd0": 1, "tcd1": 0 },
  "elegibilidade":        { "tcd0": 1, "tcd1": 0 },

  "isInconsistent": false,        // tcd1 === 1 && tcd0 === 0
  "inconsistencySource": null     // FRAUD | CREDIT | BOTH
}
```

Campos ainda dependentes de confirmação (§11): segmentação e outcome.

---

## 5. Arquitetura

```
apps/web  (React + Vite)
   │  Sankey por trilho · Painel de Inconsistência · Contrafactual · What-If · Chat
   │
   ▼  HTTP / SSE
apps/api  (NestJS)
   │
   ├─ Agent Layer      tools (Zod) = wrappers finos dos use cases
   │                   SEM acesso a banco. SEM SQL gerado por LLM. SEM PII.
   │
   ├─ Application      GetFunnel · GetInconsistencyReport · GetExceptionCounterfactual
   │                   SimulateScenario · ExplainDecision · CompareCohorts
   │                   DetectAnomalies · ValidateEngine
   │
   ├─ Domain           motor de regras puro, sem I/O, 100% testável
   │                   entidades: Merchant · Decision · Gate · Track · Rule · Scenario
   │
   └─ Infrastructure   ACL de tradução do payload · repositories JSONB (GIN + matviews)
                       LlmProvider (adapter plugável)

packages/contracts    schemas Zod compartilhados (fonte única de verdade)
```

A **camada anti-corrupção (ACL)** na infraestrutura é onde vive toda a tradução da §4.2 e
§4.4: derivação de `exitGate`, `merchantRef`, `isInconsistent` e a separação de tipos
entre modelos de fraude e de crédito. O domínio nunca vê o campo polimórfico.

### 5.1. Agregação fica no Postgres, não no Node

O plano original previa Streams do Node.js para processar a massa. **Revisto.** Trazer
milhões de linhas para o pod do EKS a fim de agregar em JavaScript é mais lento, mais
caro e mais frágil do que deixar o banco fazer aquilo em que é bom.

- Simulação What-If → **SQL parametrizado sobre o JSONB**
- Índices **GIN** nas keys quentes (`elegibilidadeFraudes`, `elegibilidadeCredito`, …)
- **Views materializadas** para os cortes fixos do funil, com refresh agendado
- Node orquestra, valida e tipa; Postgres agrega

Streams permanecem justificados apenas em export linha-a-linha, caso apareça.

### 5.2. Vercel AI SDK, não LangChain.js

Em um NestJS com injeção de dependência e SOLID, LangChain traz camadas de abstração que
competem com o container do Nest. O AI SDK é fino, tipado com Zod, tem streaming nativo,
generative UI de primeira classe e abstração de provider embutida
(`@ai-sdk/amazon-bedrock`, `@ai-sdk/anthropic`, …) — o que resolve de graça a decisão
adiada de LLM.

---

## 6. Visualização

### 6.1. Um Sankey por trilho

Sankey representa mal paralelismo e reconvergência, e o gate 4 é exatamente isso. Forçar
TCD0 e TCD1 num único diagrama produziria um emaranhado ilegível.

Solução: **um Sankey por trilho, com toggle TCD0 / TCD1**. Dentro de um trilho toda
decisão é binária e o diagrama fica limpo:

```
Solicitações
   ├──► Fluxo de Exceção ─────────────────────────────► ELEGÍVEL   ⚠ atalho
   ├──► Prevenção STAR ───────────────────────────────► Inelegível
   ├──► Penhora / Fumaça ─────────────────────────────► Inelegível
   └──► Avaliação de risco
            ├──► Reprovado só em Fraude ──────────────► Inelegível
            ├──► Reprovado só em Crédito ─────────────► Inelegível
            ├──► Reprovado em ambos ──────────────────► Inelegível
            └──► Aprovado em ambos ───────────────────► ELEGÍVEL
```

Decompor o gate 4 por causa revela de imediato **qual modelo é o gargalo dominante** —
pergunta recorrente de PO que hoje não tem resposta rápida.

Regras visuais:

- O link da Exceção é o **único elemento em cor de alerta** da tela
- Rótulo direto: `Exceção: 12.400 ECs · 18% das elegibilidades`
- **Delta vs. período anterior** em cada nó
- Clique em qualquer nó → drill-down do coorte
- Filtro de primeira classe: **credenciado × não credenciado** (`ec` nulo) e **modelo**

### 6.2. Matriz TCD0 × TCD1

O Sankey por trilho perde a relação entre os dois; a matriz de coocorrência recupera:

|              | TCD1 = 1 | TCD1 = 0 |
|--------------|----------|----------|
| **TCD0 = 1** | ambos    | só TCD0  |
| **TCD0 = 0** | ⚠ **inconsistente** | nenhum |

O quadrante `{tcd0:0, tcd1:1}` viola a monotonicidade esperada e é destacado como
anomalia. Todos os quadrantes são clicáveis e alimentam o drill-down.

### 6.3. Painel de Inconsistência (P5)

Requisito explícito: expor os casos em que `tcd1 = 1` e `tcd0 = 0`, que ocorrem em
produção sem que deveriam.

Duas propriedades reduzem o espaço de investigação antes de qualquer consulta ao banco.

**A inconsistência é sempre herdada, nunca emergente.** Como a combinação é AND por
trilho, `elegibilidade.tcd1 = 1` exige que *ambas* as dimensões tenham `tcd1 = 1`; e
`elegibilidade.tcd0 = 0` exige que *ao menos uma* tenha `tcd0 = 0`. Essa dimensão passa
então a ter `tcd0 = 0` e `tcd1 = 1` — ou seja, já está inconsistente por si só. Não
existe caso em que o estado inválido surja da composição de duas dimensões válidas.

A consequência é prática: **sempre há um modelo identificável na origem**. A origem se
resolve em três valores, e não quatro:

| Origem | Condição | Leitura |
|--------|----------|---------|
| `FRAUD` | `elegibilidadeFraudes` viola a monotonicidade | O modelo de fraude produz o estado inválido |
| `CREDIT` | `elegibilidadeCredito` viola | O modelo de crédito produz |
| `BOTH` | ambas violam | Problema sistêmico |

**Toda inconsistência nasce no gate 4.** Nos gates terminais as duas dimensões recebem
valores idênticos (`{1,1}` na Exceção, `{0,0}` em STAR e Penhora/Fumaça), nenhum dos
quais viola a monotonicidade. Logo `exitGate = RISK` é condição necessária, e a
investigação começa já restrita à avaliação de risco.

O painel entrega:

- Volume e taxa de violações, com evolução temporal (está crescendo?)
- Distribuição por origem, conforme a tabela acima
- Concentração por modelo, por segmento e por status de credenciamento
- Lista drill-down por `merchantRef`, exportável para o time responsável

Este painel é um resultado de qualidade de dados que se sustenta sozinho, independente do
restante da entrega.

### 6.4. Painel do contrafactual (P2)

A população da Exceção nunca é avaliada, então o contrafactual não existe no dado. Dois
caminhos, e o dashboard suporta ambos:

**a) Coorte comparável (funciona com o dado de hoje).** Para cada EC da Exceção, localizar
ECs de perfil equivalente — mesmo status de credenciamento, mesmo modelo elegível, mesmo
segmento — que passaram pela avaliação normal, e usar a taxa de reprovação observada como
estimativa. É *matching* estatístico simples, não exige nenhuma mudança em produção, e o
resultado é sempre rotulado como **estimativa**, com o `n` da coorte visível.

**b) Shadow run (evolução de produto).** Rodar os modelos em modo sombra para a população
da Exceção, sem efeito sobre a decisão. Custo baixo, e transforma a estimativa em medição.
Entra como recomendação que acompanha a entrega.

No dataset sintético, o gerador produz a decisão sombra verdadeira e a mantém oculta do
payload padrão — o que permite **medir o erro do método (a)** contra a verdade conhecida.
Essa validação é, por si só, um argumento forte de rigor na apresentação.

```
População via Exceção:              12.400 ECs
Seria reprovada pelos modelos:       3.720 ECs  (30%)   [estimativa · n=48.200]
   ├─ por Fraude:                    1.100
   ├─ por Crédito:                   2.100
   └─ por ambos:                       520
Inadimplência observada no grupo:     8,4%   vs.  2,1% na base aprovada normalmente
```

### 6.5. Painel What-If (P4)

Controles para ligar/desligar e parametrizar regras, com recorte por segmento (ex.:
*desligar a Exceção apenas para não credenciados*). Ao aplicar, o Sankey mostra **estado
atual vs. simulado lado a lado**, com delta de elegibilidade e delta de risco assumido.

---

## 7. Dados: o gerador é o roteiro da demo

Com massa sintética, o gerador deixa de ser utilitário e passa a ser peça central. Um
dataset uniforme produz uma apresentação sem clímax. Ele precisa produzir:

**a) Distribuições realistas**, com correlação entre maturidade do cliente, presença de
`ec`, modelo aplicado e probabilidade de aprovação.

**b) Decisão sombra para a população da Exceção**, oculta do payload padrão — serve de
gabarito para validar o método de coorte comparável (§6.4).

**c) Outcome correlacionado com o perfil** — inadimplência e fraude realizada. Sem
outcome, **P3** não tem resposta nem fictícia.

**d) Inconsistências plantadas** nas quatro origens da §6.3, em proporções distintas, para
que o painel tenha o que diagnosticar.

**e) Cenários plantados** — insights escondidos na massa, para descoberta ao vivo:

| Cenário plantado | O que o PO descobre na demo |
|------------------|-----------------------------|
| Subgrupo da Exceção que os modelos reprovariam e que inadimple 3× mais | A Exceção tem custo concentrado e identificável |
| Exceção concentrada em não credenciados (`ec` nulo) | O atalho tem um perfil dominante que ninguém mapeou |
| Inconsistência TCD0/TCD1 crescendo e originada num modelo específico | O painel de inconsistência aponta o responsável |
| Drift na taxa de aprovação de um modelo de crédito | Detecção de anomalia funciona sem ninguém pedir |
| Divergências entre decisão gravada e motor recalculado | O `ValidateEngine` acha regra não documentada |

**f) Seed determinístico** — a mesma massa em qualquer máquina, sempre.

### 7.1. Auditoria do motor

Com dados sintéticos não é possível provar fidelidade contra produção — comparar o motor
com uma decisão que o próprio gerador produziu é circular. O que se entrega é o
**mecanismo**, validado pelas divergências plantadas em (e):

- `ValidateEngine` compara decisão gravada × decisão recalculada
- Indicador exibido na UI: `Fidelidade do simulador: 99,2% (1,2M registros)`
- Relatório das divergências agrupadas por padrão

Argumento na apresentação: *"o simulador não pede fé — ele se audita. Plugue a base real
e ele informa a própria fidelidade."*

---

## 8. Camada de IA

### 8.1. Os cinco usos

| # | Uso | Implementação |
|---|-----|---------------|
| 1 | **Agente com tools** | Pergunta em linguagem natural → tool call tipada → use case determinístico |
| 2 | **Narrativa automática** | Deltas calculados em código; LLM apenas redige. Renderizada no topo, sem o PO precisar perguntar |
| 3 | **Explicação de decisão** | Gate de saída e modelo traduzidos para linguagem de negócio |
| 4 | **Triagem de anomalia** | Detecção estatística em código; LLM prioriza e contextualiza |
| 5 | **Generative UI** | O agente responde com **gráfico**, não parágrafo — tool result renderizado como componente React |

### 8.2. Tools expostas ao agente

Espelham 1:1 os use cases, com schema Zod compartilhado:

```
getFunnel(track, period, segment?)           → composição do funil no trilho
getInconsistencyReport(period, groupBy?)     → violações TCD0/TCD1 e origem
getExceptionCounterfactual(period, segment?) → o que os modelos teriam decidido
simulateScenario(rules[], track, segment?)   → impacto de mudança de regra
explainDecision(merchantRef)                 → gate, modelo e motivo traduzidos
compareCohorts(cohortA, cohortB)             → perfil e outcome comparados
detectAnomalies(period)                      → desvios estatísticos
```

Nenhuma tool aceita ou retorna `id`. `merchantRef` é a única referência a cliente.

### 8.3. Evitando o chatbot órfão

- **Perguntas sugeridas contextuais**, que mudam conforme o filtro ativo no dashboard
- **Resumo executivo automático** (uso 2) já renderizado ao abrir a tela
- Resposta em **streaming**, com o gráfico aparecendo antes de o texto terminar

### 8.4. O que separa isto de um brinquedo

- **Evals em CI** — ~20 perguntas douradas com respostas esperadas, quebrando o build em regressão
- **Tracing** de chamadas LLM (OpenTelemetry ou Langfuse) — latência, custo, tool calls
- **Guardrails** — allowlist de tools, validação Zod dos argumentos, bloqueio de PII
- **Prompt caching** para custo previsível

---

## 9. Fases de entrega

Cada fase é demonstrável sozinha e recebe uma tag git.

### Fase 0 — Fundação
- Monorepo (pnpm workspaces), lint, format, CI
- ACL de tradução do payload (§4.2 → §4.4) com testes contra os exemplos reais
- Gerador sintético com seed, decisão sombra, outcome, inconsistências e cenários plantados
- `packages/contracts` com os primeiros schemas Zod

**Pronto quando:** `pnpm dev` sobe tudo e o banco tem massa reproduzível.

### Fase 1 — Funil e inconsistência
- Repositories JSONB, índices GIN, views materializadas
- `GetFunnel` por trilho, período e segmento
- Sankey por trilho + matriz TCD0×TCD1, com deltas e drill-down
- `GetInconsistencyReport` e painel de inconsistência

**Pronto quando:** o PO responde **P1** e **P5** sozinho.

### Fase 2 — Contrafactual, motor e simulação
- Motor de regras puro no domínio, com cobertura de teste
- `GetExceptionCounterfactual` por coorte comparável, validado contra a sombra sintética
- `SimulateScenario` em SQL parametrizado
- `ValidateEngine` e indicador de fidelidade
- Painel What-If com comparação lado a lado

**Pronto quando:** o PO responde **P2**, **P3** e **P4**. *Aqui a entrega deixa de ser dashboard e vira ferramenta de decisão.*

### Fase 3 — Camada de IA
- `LlmProvider` plugável, agente com as 7 tools
- Narrativa automática e explicação de decisão
- Chat com streaming e generative UI

**Pronto quando:** uma pergunta em linguagem natural devolve um gráfico correto.

### Fase 4 — Maturidade
- Evals em CI, tracing, guardrails
- Performance (índices revisados, cache, refresh de matviews)
- Roteiro de demo ensaiado

**Pronto quando:** a entrega se defende sozinha sob perguntas técnicas.

---

## 10. Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Não existe outcome (inadimplência/fraude) disponível | **Crítico** — P3 fica sem resposta | Confirmar cedo (§11). Sem outcome, P2 perde o desfecho e a entrega se apoia em P1/P4/P5 |
| `ec` nulo tratado como dado faltante em vez de estado de negócio | Alto — segmentação errada em toda a análise | Confirmar semântica (§11) antes da Fase 1 |
| Mistura de `M1` de fraude com `M1` de crédito | Alto — agregações sem sentido | Branded types separados, erro em tempo de compilação |
| Motor do simulador diverge do sistema real | Alto — decisão sobre número errado | `ValidateEngine` + indicador de fidelidade na UI |
| Agente alucina números | Alto — perda total de credibilidade | Princípio §3.1 + evals em CI + guardrails |
| PII (CPF/CNPJ) trafegando para o LLM | Alto — risco regulatório | `merchantRef` desde o commit 1 (§3.2) |
| Contrafactual por matching lido como medição | Médio — decisão sobre estimativa | Rótulo explícito de estimativa + `n` visível + erro medido contra a sombra sintética |
| Comparação de taxa entre modelos lida como performance | Médio — conclusão inválida por viés de seleção | Aviso na UI onde a comparação aparece |
| Dataset sintético não convence | Médio — demo sem impacto | Cenários plantados, outcome correlacionado, distribuições realistas |
| Agregação lenta na base cheia | Médio — demo trava | Agregação no Postgres, GIN, matviews, medição desde a Fase 1 |

---

## 11. Pontos abertos

Hipóteses adotadas para não bloquear a Fase 0.

1. **`ec: null` significa cliente ainda não credenciado?** Ou é dado faltante? Muda de
   ruído a ser limpo para dimensão analítica de primeira classe. *Hipótese adotada: estado
   de negócio — prospect ainda não credenciado.*
2. **O `id` é estável e único por cliente ao longo do tempo?** É a base do `merchantRef` e
   de toda a análise longitudinal. *Hipótese adotada: sim.*
3. **Existe outcome disponível** (inadimplência, fraude confirmada, churn) e em que
   janela? Sem ele, **P3** não tem resposta. *Hipótese adotada: inadimplência 90d e fraude
   confirmada, sintéticos.*
4. **Nome e granularidade do campo de data** — `date` ou `timestamp`? Uma consulta por
   cliente por dia, ou várias? *Hipótese adotada: timestamp, múltiplas consultas por
   cliente ao longo do tempo.*
5. **Existem reason codes** para reprovação em STAR e Penhora/Fumaça? Enriqueceriam o
   `ExplainDecision`, mas não bloqueiam. *Hipótese adotada: não disponíveis.*
6. **Atributos de segmentação** além de modelo e status de credenciamento (MCC, porte,
   UF, tempo de casa). *Hipótese adotada: sintéticos, plugáveis quando existirem.*
7. **Critério de roteamento entre M2 e M3** — informado pelo time como não prioritário
   agora. Registrado para quando chegar; até lá o dashboard trata modelo como proxy de
   maturidade e sinaliza o viés de seleção.
