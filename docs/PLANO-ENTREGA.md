# TC Smart Eligibility — Plano de Entrega

> Documento de planejamento. Nenhuma linha de código de aplicação foi escrita ainda.
> Objetivo: dar ao Product Owner do produto **TC (Vendeu tá na conta)** visibilidade e
> poder de decisão sobre as regras de elegibilidade — com IA aplicada onde ela
> genuinamente agrega, e não como enfeite.

---

## 1. Reframe do problema

O enunciado original pede "um dashboard para o PO ver os dados". Isso subvende o
problema real, que está na própria descrição do desafio:

> *"o Fluxo de Exceção **sobrepõe** as decisões dos modelos de crédito e fraude"*

Isso não é uma lacuna de visibilidade. É uma lacuna de **governança de decisão**:
existe um mecanismo em produção que anula os modelos de risco, e não há instrumento
para quantificar o que ele faz.

A entrega é bem-sucedida se o PO conseguir responder, sozinho e em minutos:

| # | Pergunta | O que ela exige |
|---|----------|-----------------|
| **P1** | Quanto o Fluxo de Exceção resgata? | Funil com o link de retorno explícito |
| **P2** | A que custo? Os ECs resgatados performam pior? | Cruzamento decisão × outcome |
| **P3** | E se eu mexer nela? | Simulador What-If sobre a base |

Responder P1 é um relatório. Responder P1+P2+P3 é o **instrumento de decisão de
roadmap do produto**. É esse o alvo.

---

## 2. Decisões já tomadas

| Tema | Decisão | Consequência no desenho |
|------|---------|-------------------------|
| **Dados** | Sintéticos gerados | Gerador é artefato de primeira classe, não script descartável. Camada de acesso a dados fica atrás de um adapter para trocar por base real sem reescrita. |
| **LLM** | Indefinido | Provider abstraído atrás de interface. Com o AI SDK a troca Bedrock ↔ Anthropic ↔ Azure é uma linha. Decisão adiada sem custo. |
| **Prazo** | Sem prazo rígido | Construção incremental por fases; cada fase é demonstrável isoladamente e recebe uma tag git. |
| **Repositório** | Monorepo | `apps/api` + `apps/web` + `packages/contracts`. Tipagem end-to-end, um comando sobe tudo. |

---

## 3. Princípios inegociáveis

### 3.1. O LLM nunca calcula um número

Ele **escolhe ferramentas** e **narra resultados**. Todo número exibido vem de um use
case determinístico, versionado e coberto por teste.

Em contexto de meios de pagamento, isso é a fronteira entre protótipo divertido e
código que pode ir para produção: auditabilidade, reprodutibilidade e a capacidade de
explicar a origem de qualquer valor na tela. Este princípio deve ser declarado
explicitamente na apresentação.

### 3.2. Uma regra de negócio, dois consumidores

O botão do What-If na UI e a tool do agente chamam **o mesmo use case**. Nunca há duas
implementações da mesma regra. É a demonstração mais limpa de SOLID aplicado a IA — e
é o slide de fechamento da apresentação.

### 3.3. Um schema, três usos

Cada contrato é definido uma vez em Zod, dentro de `packages/contracts`, e serve como:

1. DTO validado na entrada do NestJS
2. Tipo estático consumido pelo React
3. Schema da tool exposta ao agente

Uma definição, três consumidores, zero divergência.

### 3.4. IA entra por último

Fases 0→2 são inteiramente determinísticas. A camada de IA (Fase 3) é construída sobre
uma fundação já validada. Invertida, a entrega vira um chatbot alucinando sobre dados
que ninguém conferiu.

---

## 4. Arquitetura

```
apps/web  (React + Vite)
   │  Sankey · Painel What-If · Chat com streaming e generative UI
   │
   ▼  HTTP / SSE
apps/api  (NestJS)
   │
   ├─ Agent Layer      tools (Zod) = wrappers finos dos use cases
   │                   SEM acesso a banco. SEM SQL gerado por LLM.
   │
   ├─ Application      GetFunnel · SimulateScenario · ExplainDecision
   │                   CompareCohorts · DetectAnomalies · ValidateEngine
   │
   ├─ Domain           motor de regras puro, sem I/O, 100% testável
   │                   entidades: Merchant · Decision · Rule · Scenario
   │
   └─ Infrastructure   repositories JSONB (GIN + matviews)
                       LlmProvider (adapter plugável)

packages/contracts    schemas Zod compartilhados (fonte única de verdade)
```

### 4.1. Agregação fica no Postgres, não no Node

O plano original previa Streams do Node.js para processar a massa. **Revisto.** Trazer
milhões de linhas para o pod do EKS a fim de agregar em JavaScript é mais lento, mais
caro e mais frágil do que deixar o banco fazer aquilo em que é bom.

- Simulação What-If → **SQL parametrizado sobre o JSONB**
- Índices **GIN** nas keys quentes (`elegibilidadeFraudes`, `modeloCredito`, …)
- **Views materializadas** para os cortes fixos do funil, com refresh agendado
- Node orquestra, valida e tipa; Postgres agrega

Streams permanecem justificados apenas em export linha-a-linha, caso apareça.

### 4.2. Vercel AI SDK, não LangChain.js

Em um NestJS com injeção de dependência e SOLID, LangChain traz camadas de abstração
que competem com o container do Nest. O AI SDK é fino, tipado com Zod, tem streaming
nativo, generative UI de primeira classe e abstração de provider embutida
(`@ai-sdk/amazon-bedrock`, `@ai-sdk/anthropic`, …) — o que resolve de graça a decisão
adiada de LLM.

---

## 5. Dados: o gerador é o roteiro da demo

Com dados sintéticos, o gerador deixa de ser utilitário e passa a ser peça central.
Um dataset uniforme produz uma apresentação sem clímax. O gerador precisa produzir:

**a) Distribuições realistas** — porte, MCC, tempo de casa, TPV, região, com
correlações plausíveis entre elas.

**b) Outcome, não só decisão** — inadimplência e fraude realizada, correlacionadas com
o perfil do EC. Sem outcome, a pergunta **P2** ("a que custo?") não tem resposta nem
sintética, e o dashboard vira relatório descritivo.

**c) Cenários plantados** — insights deliberadamente escondidos na massa, para serem
descobertos ao vivo:

| Cenário plantado | O que o PO descobre na demo |
|------------------|----------------------------|
| Segmento resgatado pela Exceção com inadimplência 3× | A Exceção tem um custo concentrado e identificável |
| Drift na taxa de aprovação do M2 nas últimas semanas | Detecção de anomalia funciona sem ninguém pedir |
| MCC específico com reprovação anômala em Penhora/Fumaça | Drill-down e explicação individual têm serventia |
| Divergências propositais entre decisão gravada e motor | O `ValidateEngine` acha regra não documentada |

**d) Seed determinístico** — a mesma massa em qualquer máquina, sempre. Demo não pode
depender de sorte, e os testes precisam de base estável.

### 5.1. Auditoria do motor (ex-"shadow validation")

Com dados sintéticos não é possível provar fidelidade contra produção — comparar o
motor com uma decisão que o próprio gerador produziu é circular. O que se entrega é o
**mecanismo**, validado pelas divergências plantadas no item (c):

- Use case `ValidateEngine` compara decisão gravada × decisão recalculada
- Indicador exibido na UI: `Fidelidade do simulador: 99,2% (1,2M ECs)`
- Relatório das divergências agrupadas por padrão

Argumento na apresentação: *"o simulador não pede fé — ele se audita. Plugue a base
real e ele informa a própria fidelidade."* Demonstra a capacidade sem forjar o
resultado.

---

## 6. Visualização

### 6.1. Sankey — escolha estrutural, não estética

O Fluxo de Exceção é um **link de retorno**: sai de "Reprovado M2/M3" e retorna a
"Aprovado TCD1". Em funil de barras esse retorno é invisível; em Sankey ele aparece
como uma faixa contornando os modelos de risco, e o problema se explica sozinho.

- O link da Exceção é o **único elemento em cor de alerta** da tela
- Rótulo direto: `Exceção: 12.400 ECs · 18% das aprovações`
- **Delta vs. período anterior** em cada nó — volume absoluto é relatório, variação é insight
- Clique em qualquer nó → drill-down do coorte

Taxonomia inicial (a validar — ver §10):

```
Base elegível
  → Penhora / Fumaça
    → Prevenção STAR
      → Fraude (M1)
        → Crédito (M2 / M3)
          → TCD0 / TCD1
          ↖ Fluxo de Exceção (retorno a partir dos reprovados)
```

### 6.2. Painel What-If

Controles para ligar/desligar e parametrizar regras, com recorte por segmento
(ex.: *desligar a Exceção apenas para MCC 5812*). Ao aplicar, o Sankey mostra
**estado atual vs. simulado lado a lado**, com o delta de aprovação e o delta de risco
assumido.

---

## 7. Camada de IA

### 7.1. Os cinco usos

| # | Uso | Implementação |
|---|-----|---------------|
| 1 | **Agente com tools** | Pergunta em linguagem natural → tool call tipada → use case determinístico |
| 2 | **Narrativa automática** | Deltas calculados em código; LLM apenas redige. Renderizada no topo, sem o PO precisar perguntar |
| 3 | **Explicação de decisão** | Reason codes determinísticos → LLM traduz para linguagem de negócio |
| 4 | **Triagem de anomalia** | Detecção estatística em código; LLM prioriza e contextualiza |
| 5 | **Generative UI** | O agente responde com **gráfico**, não com parágrafo — tool result renderizado como componente React |

### 7.2. Tools expostas ao agente

Espelham 1:1 os use cases, com schema Zod compartilhado:

```
getFunnel(period, segment?)            → composição do funil
simulateScenario(rules[], segment?)    → impacto de mudança de regra
explainDecision(merchantId)            → reason codes traduzidos
compareCohorts(cohortA, cohortB)       → perfil e outcome comparados
detectAnomalies(period)                → desvios estatísticos
```

### 7.3. Evitando o chatbot órfão

Caixa de chat vazia é chatbot que ninguém usa. Mitigações:

- **Perguntas sugeridas contextuais**, que mudam conforme o filtro ativo no dashboard
- **Resumo executivo automático** (uso 2) já renderizado ao abrir a tela
- Resposta em **streaming**, com o gráfico aparecendo antes do texto terminar

### 7.4. O que separa isto de um brinquedo

- **Evals em CI** — ~20 perguntas douradas com respostas esperadas, quebrando o build em regressão
- **Tracing** de chamadas LLM (OpenTelemetry ou Langfuse) — latência, custo, tool calls
- **Guardrails** — allowlist de tools, validação Zod dos argumentos, escopo de dados limitado
- **Prompt caching** para custo previsível

Este bloco é o diferencial competitivo da entrega. Praticamente ninguém "que plugou um
chatbot" tem eval rodando em CI.

---

## 8. Fases de entrega

Cada fase é demonstrável sozinha e recebe uma tag git. Se o tempo acabar em qualquer
ponto, o que existe até ali é apresentável.

### Fase 0 — Fundação
- Monorepo (pnpm workspaces), lint, format, CI
- Taxonomia do funil validada e modelo JSONB definido
- Gerador sintético com seed, outcome e cenários plantados
- `packages/contracts` com os primeiros schemas Zod

**Pronto quando:** `pnpm dev` sobe tudo e o banco tem massa reproduzível.

### Fase 1 — Funil determinístico
- Repositories JSONB, índices GIN, views materializadas
- Use case `GetFunnel` com recorte por período e segmento
- Sankey em React com deltas e drill-down

**Pronto quando:** o PO responde **P1** sozinho.

### Fase 2 — Motor e simulação
- Motor de regras puro no domínio, com cobertura de teste
- `SimulateScenario` em SQL parametrizado
- `ValidateEngine` e indicador de fidelidade
- Painel What-If com comparação lado a lado

**Pronto quando:** o PO responde **P2** e **P3**. *Aqui a entrega deixa de ser dashboard e vira ferramenta de decisão.*

### Fase 3 — Camada de IA
- `LlmProvider` plugável, agente com as 5 tools
- Narrativa automática e explicação de decisão
- Chat com streaming e generative UI

**Pronto quando:** uma pergunta em linguagem natural devolve um gráfico correto.

### Fase 4 — Maturidade
- Evals em CI, tracing, guardrails
- Performance (índices revisados, cache, refresh de matviews)
- Roteiro de demo ensaiado

**Pronto quando:** a entrega se defende sozinha sob perguntas técnicas.

---

## 9. Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Motor do simulador diverge do sistema real | Alto — decisão tomada sobre número errado | `ValidateEngine` + indicador de fidelidade explícito na UI |
| Agente alucina números | Alto — perda total de credibilidade | Princípio §3.1 + evals em CI + guardrails |
| Dataset sintético não convence | Médio — demo sem impacto | Cenários plantados, outcome correlacionado, distribuições realistas |
| Chatbot sem uso real | Médio — feature morta | Perguntas sugeridas + narrativa automática proativa |
| Agregação lenta na base cheia | Médio — demo trava | Agregação no Postgres, GIN, matviews, medição desde a Fase 1 |
| Taxonomia do funil incorreta | Alto — retrabalho em cascata | Validar em Fase 0, antes de qualquer código de agregação |

---

## 10. Pontos abertos (dependem de você)

1. **Taxonomia exata do funil** — a sequência em §6.1 é hipótese derivada do enunciado.
   Ordem real das etapas, condições de saída e o que exatamente dispara o Fluxo de
   Exceção precisam ser confirmados.
2. **Estrutura real do JSONB** — nomes e semântica das keys além de
   `elegibilidadeFraudes` e `modeloCredito`.
3. **Semântica de TCD0 × TCD1** — são trilhos distintos do produto ou estágios
   sequenciais? Muda o desenho dos nós terminais do Sankey.
4. **Métricas de outcome disponíveis** — quais indicadores de performance do EC existem
   de fato (inadimplência, fraude realizada, churn) e em que janela.
5. **Segmentações que o PO já usa** — MCC, porte, região, tempo de casa: quais ele cita
   nas reuniões? Essas devem ser os filtros de primeira classe.

Nada disso bloqueia a Fase 0: o gerador sintético pode partir da hipótese e ser
ajustado quando as respostas chegarem.
