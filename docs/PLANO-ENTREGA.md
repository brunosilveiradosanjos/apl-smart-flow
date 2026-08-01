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
Crédito sejam sequer consultados.

A consequência é mais séria do que "a Exceção sobrepõe os modelos":

> Para a população que passa pela Exceção, a decisão de risco **nunca é gerada**.
> Não existe log de override — existe ausência de dado.

Isso não é uma lacuna de visibilidade. É um **ponto cego estrutural**, e o instrumento
para eliminá-lo é o contrafactual: rodar os modelos em modo sombra sobre a população da
Exceção para revelar o que eles teriam decidido.

A entrega é bem-sucedida se o PO conseguir responder, sozinho e em minutos:

| # | Pergunta | O que ela exige |
|---|----------|-----------------|
| **P1** | Qual o volume que entra pelo atalho da Exceção? | Funil com o bypass explícito |
| **P2** | Quanto risco isso mascara? | Contrafactual: modelos em modo sombra sobre a população da Exceção |
| **P3** | A que custo real? | Cruzamento decisão × outcome (inadimplência / fraude realizada) |
| **P4** | E se eu mexer nela? | Simulador What-If sobre a base |

Responder **P1** é um relatório. Responder **P2** é entregar um número que hoje não
existe em lugar nenhum. É esse o alvo.

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

O campo `id` do payload é CPF/CNPJ — dado pessoal. Mesmo com massa sintética, a
disciplina se estabelece desde o commit 1:

- O agente opera sobre **agregados**, nunca sobre registros individuais
- `ExplainDecision` recebe o **`ec`** (identificador comercial de 10 posições), nunca o `id`
- O `id` não sai da camada de infraestrutura; nem para o LLM, nem para o frontend

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
       ├── Prevenção a Fraudes  → modeloFraudes (M1)  → elegibilidadeFraudes {tcd0, tcd1}
       └── Risco de Crédito     → modeloCredito (M2/M3) → elegibilidadeCredito {tcd0, tcd1}
                                                    │
                                          combinação por trilho
                                                    ▼
                                        elegibilidade {tcd0, tcd1}
```

Características que dirigem todo o desenho:

- **Gates 1–3 são terminais e binários.** Encerram a avaliação, com resultado igual para
  ambos os trilhos.
- **Gate 4 é paralelo e por trilho.** Fraudes e Crédito são avaliados simultaneamente, e
  cada um emite decisão independente para TCD0 e TCD1.
- **TCD0 e TCD1 são trilhos independentes**, não estágios sequenciais. O exemplo real
  `{tcd0:1, tcd1:0}` prova que um EC pode ser elegível a um e não ao outro.

### 4.1. Payload atual

```jsonc
{
  "id": "9189ARC9891",                        // CPF/CNPJ alfanumérico — PII
  "ec": "1234567890",                         // identificação Cielo, 10 posições
  "elegibilidadeFraudes": { "tcd0": 1, "tcd1": 1 },
  "elegibilidadeCredito": { "tcd0": 1, "tcd1": 0 },
  "modeloFraudes": "M1",
  "modeloCredito": "M2",
  "elegibilidade":  { "tcd0": 1, "tcd1": 0 }  // combinação das duas dimensões
}
```

### 4.2. Lacunas de instrumentação

Este payload **não é suficiente para construir o funil**. Quatro ausências são
bloqueantes:

| Falta | Por que bloqueia |
|-------|------------------|
| **Gate que encerrou a decisão** | Com `elegibilidade {0,0}` não há como saber se a causa foi STAR, Penhora, Fraude ou Crédito. É literalmente o dado que constrói o Sankey. |
| **Marcador de passagem pela Exceção** | `{tcd0:1, tcd1:1}` é indistinguível entre "entrou pelo atalho" e "passou legitimamente por todos os gates". Sem isso, **P1 é irrespondível**. |
| **Timestamp da decisão** | Sem eixo temporal não há série histórica, delta vs. período anterior nem detecção de drift. |
| **Reason codes por gate** | Sem motivo, `ExplainDecision` não tem o que explicar. |

Ausências não bloqueantes, mas que limitam o valor:

- **Atributos de segmentação** (MCC, porte, região, tempo de casa) — são os filtros de
  primeira classe do dashboard
- **Outcome** (inadimplência, fraude realizada) — sem ele, **P3** não tem resposta
- **Versão do conjunto de regras** vigente na decisão — necessária para comparar períodos
  em que as regras mudaram

Diagnosticar essa lacuna é, por si só, um entregável do desafio: **o produto hoje não é
observável**. A recomendação de instrumentação abaixo acompanha a entrega.

### 4.3. Registro de decisão proposto

O payload de resposta ao cliente permanece como está. O que se propõe é o **registro
persistido para análise** — o que a API deveria emitir para que o produto seja
observável:

```jsonc
{
  "ec": "1234567890",
  "decidedAt": "2026-07-14T13:22:41Z",
  "rulesetVersion": "2026.07.1",

  "exitGate": "CREDIT",          // EXCEPTION | STAR | LIEN | FRAUD | CREDIT | APPROVED
  "viaException": false,         // resolve a indistinguibilidade de {1,1}
  "reasonCodes": ["CRD_SCORE_BELOW_CUTOFF"],

  "elegibilidadeFraudes": { "tcd0": 1, "tcd1": 1 },
  "elegibilidadeCredito": { "tcd0": 1, "tcd1": 0 },
  "modeloFraudes": "M1",
  "modeloCredito": "M2",
  "elegibilidade":  { "tcd0": 1, "tcd1": 0 },

  // preenchido apenas para viaException = true — é o contrafactual
  "shadow": {
    "elegibilidadeFraudes": { "tcd0": 0, "tcd1": 0 },
    "elegibilidadeCredito": { "tcd0": 1, "tcd1": 0 },
    "elegibilidade":        { "tcd0": 0, "tcd1": 0 }
  },

  "segment": { "mcc": "5812", "porte": "PME", "uf": "SP", "tempoCasaMeses": 14 },
  "outcome": { "inadimplente90d": false, "fraudeConfirmada": false }
}
```

O bloco `shadow` é o coração da entrega: é a decisão que os modelos **teriam tomado** se
a Exceção não tivesse encerrado a avaliação. Em produção, exigiria rodar os modelos em
modo sombra para a população da Exceção — custo baixo, valor analítico alto. No dataset
sintético, o gerador o produz e o mantém oculto do payload padrão, reproduzindo
fielmente o ponto cego.

---

## 5. Arquitetura

```
apps/web  (React + Vite)
   │  Sankey por trilho · Matriz TCD0×TCD1 · Painel What-If · Chat (SSE + generative UI)
   │
   ▼  HTTP / SSE
apps/api  (NestJS)
   │
   ├─ Agent Layer      tools (Zod) = wrappers finos dos use cases
   │                   SEM acesso a banco. SEM SQL gerado por LLM. SEM PII.
   │
   ├─ Application      GetFunnel · GetExceptionCounterfactual · SimulateScenario
   │                   ExplainDecision · CompareCohorts · DetectAnomalies · ValidateEngine
   │
   ├─ Domain           motor de regras puro, sem I/O, 100% testável
   │                   entidades: Merchant · Decision · Gate · Rule · Scenario · Track
   │
   └─ Infrastructure   repositories JSONB (GIN + matviews) · LlmProvider (adapter)

packages/contracts    schemas Zod compartilhados (fonte única de verdade)
```

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

Sankey representa mal paralelismo e reconvergência, e o gate 4 é exatamente isso.
Forçar TCD0 e TCD1 num único diagrama produziria um emaranhado ilegível.

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

Decompor o gate 4 por causa (só fraude / só crédito / ambos) revela de imediato **qual
modelo é o gargalo dominante** — pergunta recorrente de PO que hoje não tem resposta
rápida.

Regras visuais:

- O link da Exceção é o **único elemento em cor de alerta** da tela
- Rótulo direto: `Exceção: 12.400 ECs · 18% das elegibilidades`
- **Delta vs. período anterior** em cada nó — volume absoluto é relatório, variação é insight
- Clique em qualquer nó → drill-down do coorte

### 6.2. Matriz TCD0 × TCD1

O Sankey por trilho perde a relação entre os dois. Uma matriz 2×2 de coocorrência
recupera:

|              | TCD1 = 1 | TCD1 = 0 |
|--------------|----------|----------|
| **TCD0 = 1** | ambos    | só TCD0  |
| **TCD0 = 0** | só TCD1  | nenhum   |

Cada quadrante é clicável e alimenta o drill-down. Se houver relação de monotonicidade
esperada entre os trilhos (ver §10), um dos quadrantes passa a ser uma **anomalia
detectável** — e vira alerta automático no dashboard.

### 6.3. Painel do contrafactual

Área dedicada à população da Exceção, respondendo **P2** de forma direta:

```
População via Exceção:              12.400 ECs
Seria reprovada pelos modelos:       3.720 ECs  (30%)
   ├─ por Fraude:                    1.100
   ├─ por Crédito:                   2.100
   └─ por ambos:                       520
Inadimplência observada no grupo:     8,4%   vs.  2,1% na base aprovada normalmente
```

Este é o painel que justifica a entrega inteira.

### 6.4. Painel What-If

Controles para ligar/desligar e parametrizar regras, com recorte por segmento
(ex.: *desligar a Exceção apenas para MCC 5812*). Ao aplicar, o Sankey mostra **estado
atual vs. simulado lado a lado**, com delta de elegibilidade e delta de risco assumido.

---

## 7. Dados: o gerador é o roteiro da demo

Com massa sintética, o gerador deixa de ser utilitário e passa a ser peça central. Um
dataset uniforme produz uma apresentação sem clímax. Ele precisa produzir:

**a) Distribuições realistas** — porte, MCC, tempo de casa, TPV, região, com correlações
plausíveis entre si.

**b) Decisão sombra para a população da Exceção** — sem ela não há contrafactual, e **P2**
fica sem resposta.

**c) Outcome correlacionado com o perfil** — inadimplência e fraude realizada. Sem
outcome, **P3** não tem resposta nem fictícia e o dashboard vira relatório descritivo.

**d) Cenários plantados** — insights deliberadamente escondidos na massa, para serem
descobertos ao vivo:

| Cenário plantado | O que o PO descobre na demo |
|------------------|-----------------------------|
| Subgrupo da Exceção que os modelos reprovariam e que inadimple 3× mais | A Exceção tem custo concentrado e identificável |
| Drift na taxa de aprovação do modelo de crédito nas últimas semanas | Detecção de anomalia funciona sem ninguém pedir |
| MCC específico com reprovação anômala em Penhora/Fumaça | Drill-down e explicação individual têm serventia |
| Divergências propositais entre decisão gravada e motor recalculado | O `ValidateEngine` acha regra não documentada |
| ECs com `{tcd0:1, tcd1:0}` concentrados num segmento | A matriz TCD0×TCD1 revela assimetria entre trilhos |

**e) Seed determinístico** — a mesma massa em qualquer máquina, sempre. Demo não depende
de sorte, e os testes precisam de base estável.

### 7.1. Auditoria do motor

Com dados sintéticos não é possível provar fidelidade contra produção — comparar o motor
com uma decisão que o próprio gerador produziu é circular. O que se entrega é o
**mecanismo**, validado pelas divergências plantadas em (d):

- `ValidateEngine` compara decisão gravada × decisão recalculada
- Indicador exibido na UI: `Fidelidade do simulador: 99,2% (1,2M ECs)`
- Relatório das divergências agrupadas por padrão

Argumento na apresentação: *"o simulador não pede fé — ele se audita. Plugue a base real
e ele informa a própria fidelidade."* Demonstra a capacidade sem forjar o resultado.

---

## 8. Camada de IA

### 8.1. Os cinco usos

| # | Uso | Implementação |
|---|-----|---------------|
| 1 | **Agente com tools** | Pergunta em linguagem natural → tool call tipada → use case determinístico |
| 2 | **Narrativa automática** | Deltas calculados em código; LLM apenas redige. Renderizada no topo, sem o PO precisar perguntar |
| 3 | **Explicação de decisão** | Reason codes determinísticos → LLM traduz para linguagem de negócio |
| 4 | **Triagem de anomalia** | Detecção estatística em código; LLM prioriza e contextualiza |
| 5 | **Generative UI** | O agente responde com **gráfico**, não parágrafo — tool result renderizado como componente React |

### 8.2. Tools expostas ao agente

Espelham 1:1 os use cases, com schema Zod compartilhado:

```
getFunnel(track, period, segment?)          → composição do funil no trilho
getExceptionCounterfactual(period, segment?)→ o que os modelos teriam decidido
simulateScenario(rules[], track, segment?)  → impacto de mudança de regra
explainDecision(ec)                         → reason codes traduzidos (nunca recebe id)
compareCohorts(cohortA, cohortB)            → perfil e outcome comparados
detectAnomalies(period)                     → desvios estatísticos
```

### 8.3. Evitando o chatbot órfão

Caixa de chat vazia é chatbot que ninguém usa. Mitigações:

- **Perguntas sugeridas contextuais**, que mudam conforme o filtro ativo no dashboard
- **Resumo executivo automático** (uso 2) já renderizado ao abrir a tela
- Resposta em **streaming**, com o gráfico aparecendo antes de o texto terminar

### 8.4. O que separa isto de um brinquedo

- **Evals em CI** — ~20 perguntas douradas com respostas esperadas, quebrando o build em regressão
- **Tracing** de chamadas LLM (OpenTelemetry ou Langfuse) — latência, custo, tool calls
- **Guardrails** — allowlist de tools, validação Zod dos argumentos, bloqueio de PII
- **Prompt caching** para custo previsível

Este bloco é o diferencial competitivo da entrega.

---

## 9. Fases de entrega

Cada fase é demonstrável sozinha e recebe uma tag git. Se o tempo acabar em qualquer
ponto, o que existe até ali é apresentável.

### Fase 0 — Fundação
- Monorepo (pnpm workspaces), lint, format, CI
- Modelo do registro de decisão (§4.3) e schema JSONB
- Gerador sintético com seed, decisão sombra, outcome e cenários plantados
- `packages/contracts` com os primeiros schemas Zod

**Pronto quando:** `pnpm dev` sobe tudo e o banco tem massa reproduzível.

### Fase 1 — Funil determinístico
- Repositories JSONB, índices GIN, views materializadas
- `GetFunnel` com recorte por trilho, período e segmento
- Sankey por trilho + matriz TCD0×TCD1, com deltas e drill-down

**Pronto quando:** o PO responde **P1** sozinho.

### Fase 2 — Contrafactual, motor e simulação
- Motor de regras puro no domínio, com cobertura de teste
- `GetExceptionCounterfactual` e painel do contrafactual
- `SimulateScenario` em SQL parametrizado
- `ValidateEngine` e indicador de fidelidade
- Painel What-If com comparação lado a lado

**Pronto quando:** o PO responde **P2**, **P3** e **P4**. *Aqui a entrega deixa de ser dashboard e vira ferramenta de decisão.*

### Fase 3 — Camada de IA
- `LlmProvider` plugável, agente com as 6 tools
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
| Payload de produção não tem `exitGate` / `viaException` | **Crítico** — o funil e o P1 dependem deles | Registro de decisão proposto (§4.3) entra como recomendação de instrumentação; no sintético já nasce completo |
| Modelos não rodam em sombra para a população da Exceção | Alto — P2 fica sem lastro real | Demonstrar valor no sintético e propor o shadow run como evolução de produto |
| Motor do simulador diverge do sistema real | Alto — decisão sobre número errado | `ValidateEngine` + indicador de fidelidade explícito na UI |
| Agente alucina números | Alto — perda total de credibilidade | Princípio §3.1 + evals em CI + guardrails |
| PII (CPF/CNPJ) trafegando para o LLM | Alto — risco regulatório | Princípio §3.2, aplicado desde o commit 1 |
| Dataset sintético não convence | Médio — demo sem impacto | Cenários plantados, outcome correlacionado, distribuições realistas |
| Chatbot sem uso real | Médio — feature morta | Perguntas sugeridas + narrativa automática proativa |
| Agregação lenta na base cheia | Médio — demo trava | Agregação no Postgres, GIN, matviews, medição desde a Fase 1 |

---

## 11. Pontos abertos

Hipóteses adotadas para não bloquear a Fase 0. Cada uma é barata de corrigir agora e cara
depois.

1. **`elegibilidade` final é o AND por trilho?** O exemplo é consistente com isso
   (`fraudes.tcd1=1` ∧ `credito.tcd1=0` → `tcd1=0`), mas pode haver precedência ou peso
   entre as dimensões. *Hipótese adotada: AND puro por trilho.*
2. **Existe monotonicidade esperada entre TCD0 e TCD1?** Se um dos trilhos for sempre
   mais restritivo, o quadrante oposto da matriz (§6.2) é anomalia e vira alerta. *Hipótese
   adotada: trilhos independentes, sem monotonicidade.*
3. **Critério de roteamento entre M2 e M3.** Se os modelos de crédito atendem populações
   diferentes, comparar taxas de aprovação entre eles diretamente é viés de seleção — o
   dashboard precisa sinalizar isso. *Hipótese adotada: roteamento por perfil do EC.*
4. **M1 é o único modelo de fraude?** O enunciado sugere sim, mas convém confirmar antes
   de fixar o schema.
5. **Granularidade temporal.** Uma solicitação por EC por vez, ou reavaliações periódicas
   com histórico? Muda a chave do registro e o desenho da série temporal. *Hipótese
   adotada: reavaliações periódicas, histórico preservado.*
6. **Reason codes por gate.** Existem hoje, em alguma forma, os motivos de reprovação em
   STAR e Penhora/Fumaça?
7. **Métricas de outcome disponíveis** e em que janela (inadimplência 90d? fraude
   confirmada? churn?).
8. **Segmentações que o PO já usa** nas reuniões — essas devem ser os filtros de primeira
   classe.
