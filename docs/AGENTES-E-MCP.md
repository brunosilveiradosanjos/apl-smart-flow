# Agentes e MCP

> Como a camada de IA é construída: quantos agentes existem, o que cada um pode fazer, e
> onde o MCP entra de verdade — separando o que agrega do que seria protocolo por
> protocolo.
>
> Complementa `ARQUITETURA.md` (estrutura e pacotes) e `PLANO-ENTREGA.md` §8 (camada de IA).

---

## 1. A ideia central: uma regra, três consumidores

O plano já estabelecia que o botão do What-If e a tool do agente chamam **o mesmo use
case**. O MCP estende isso para um terceiro consumidor, sem duplicar nada:

```
                    Use cases  (a única implementação da regra de negócio)
                        │
        ┌───────────────┼────────────────────────┐
        │               │                        │
  HTTP controllers   Agent tools            MCP server
   → dashboard        (in-process)          (processo separado)
                      → chatbot do PO       → Claude Code, Claude Desktop,
                                              outros agentes internos
```

O mesmo `GetExceptionCounterfactual` que desenha o painel responde à pergunta do PO no
chat e fica disponível para um analista investigando pelo Claude Code. **Uma regra, três
superfícies.** É o argumento de arquitetura mais forte da entrega.

---

## 2. Quantos agentes — e onde eu não usaria agente

Agente é caro: latência, custo, modos de falha novos. Só vale onde há **decisão sobre
qual informação buscar**. Onde o caminho é fixo, uma chamada direta resolve melhor.

| Peça | É agente? | Por quê |
|------|-----------|---------|
| **Analista** (chatbot do painel) | **Sim** | Precisa escolher entre 8 tools, encadear chamadas e decidir quando parar |
| **Copiloto de Concessão** (Fase 6) | **Sim** | Outro system prompt, outro conjunto de tools, outra política de guardrail |
| **Narrador** (resumo automático) | **Não** | Entrada fixa, saída fixa. É *uma* chamada com structured output, não um loop de tools |
| **Detector de anomalia** | **Não** | Estatística determinística. O LLM só prioriza e redige o que o código já achou |

Chamar o narrador de "agente" seria inflação de vocabulário. Ele recebe deltas já
calculados e devolve texto — não decide nada.

### 2.1. Multiagente: uma não-escolha deliberada

Considerei fan-out (um sub-agente por modelo, comparando em paralelo) e descartei: o
volume de tools é pequeno, as chamadas são rápidas, e orquestração paralela adicionaria
falha parcial e custo sem ganhar tempo perceptível. Se a latência virar problema medido,
volta para a mesa — mas não antes.

### 2.2. Os dois agentes, lado a lado

| | Analista | Copiloto de Concessão |
|---|---|---|
| Usuário | Product Owner | Analista de risco |
| Escopo | Agregados, toda a base | Um cliente por vez |
| Tools | 8, **todas leitura** | 4 de leitura + 1 de escrita |
| Escrita | nenhuma | registra a decisão **humana**, nunca concede |
| Guardrail crítico | não inventar número | não decidir sozinho |
| Fase | 3 | 6 |

---

## 3. As tools do Analista

Espelham 1:1 os use cases. Schemas vêm de `packages/contracts` — os mesmos que validam o
DTO no Nest e tipam o React.

```
getModelOverview(period, segment?)            panorama dimensão × modelo
getFunnel(track, period, unit, segment?)      composição do funil
getInconsistencyReport(period, groupBy?)      anomalia {tcd0:1, tcd1:0} e origem
getVolatilityReport(period, groupBy?)         flips, decompostos por causa
getExceptionCounterfactual(period, segment?)  pré-pós das janelas encerradas
getExceptionAudit(period)                     vigência declarada × comportamento
explainDecision(merchantRef)                  gate, modelo, histórico
compareCohorts(cohortA, cohortB)              perfil e outcome comparados
```

Quatro regras de desenho que importam mais que a lista:

**a) Nenhuma tool aceita expressão livre.** Não existe parâmetro `sql`, `filter` ou
`query`. Todo argumento é enumerado ou tipado. O agente escolhe *qual* tool e *quais
valores*, nunca *como consultar*.

**b) `unit` é obrigatório onde se conta cliente.** Sem default implícito — é a mitigação
da armadilha de granularidade (`ANALISE-TEMPORAL.md` §3): contar por consulta em vez de
por cliente distinto descreveria tráfego de integração, não a base.

**c) Nenhuma tool recebe ou devolve `id`.** `merchantRef` é a única referência a cliente
que sobe da infraestrutura. O CPF/CNPJ não existe acima da ACL.

**d) Toda tool devolve dado + como renderizar.** O retorno carrega a série já agregada e um
descritor de visualização, para o front escolher o componente:

```jsonc
{
  "data":  { /* números */ },
  "render": { "component": "FunnelChart", "props": { "track": "TCD0" } },
  "basis": { "unit": "clientes", "n": 118700, "coverage": 1.0 }
}
```

O campo `basis` viaja junto de propósito: é o que permite a resposta dizer *"57% das
janelas encerradas"* em vez de apresentar um recorte como se fosse o total.

---

## 4. Generative UI — como "responde com gráfico, não parágrafo" funciona

O Vercel AI SDK entrega os `toolResults` junto do stream. O front mantém um mapa de
`component → React` e renderiza o resultado **enquanto o texto ainda está chegando**:

```
Pergunta → agente escolhe tool → API executa use case
                                       │
                     ┌─────────────────┴───────────────┐
                 toolResult                        texto (stream)
                     │                                 │
          front renderiza <FunnelChart/>      narração aparece embaixo
```

O gráfico aparece antes da frase terminar. E como o componente é o **mesmo** que o painel
usa, não existe uma versão "do chat" e outra "da tela".

---

## 5. Onde o MCP entra — e onde não entra

### 5.1. Não entra: dentro do processo

Usar MCP como transporte entre o agente do NestJS e os próprios use cases seria adicionar
um salto de protocolo dentro de um único processo, com serialização e latência, para
resolver um problema que a injeção de dependência já resolve. **O agente do painel chama
use case direto.**

### 5.2. Entra: para fora do processo

O valor do MCP é **interoperabilidade**. Um servidor MCP torna a análise de elegibilidade
consumível por qualquer cliente que fale o protocolo:

| Cliente | Uso real |
|---------|----------|
| Chatbot do painel | já usa as tools in-process — não precisa de MCP |
| **Claude Code / Desktop** | dev ou analista investigando: *"roda o contrafactual de julho e compara com junho"* sem abrir o dashboard |
| **Outros agentes internos** | qualquer time da Cielo consome elegibilidade sem integrar com a API na mão |
| **Copiloto de Concessão** | pode viver fora do painel e ainda assim usar as mesmas tools |

O ganho concreto: hoje, para outro time usar esses dados, alguém escreve um cliente HTTP e
descobre os parâmetros na documentação. Com MCP, o agente **descobre as tools sozinho**,
com schema, descrição e exemplos.

### 5.3. O servidor MCP é cliente HTTP da API

```
packages/mcp-server/          ← processo separado
        │  HTTP tipado por packages/contracts
        ▼
   apps/api  (use cases)
```

Não importa a camada de aplicação diretamente. Isso mantém a regra de que os apps não
dependem uns dos outros, permite rodar o servidor MCP em outro lugar, e garante que a API
continua sendo o único lugar onde a regra existe.

### 5.4. As três primitivas do MCP — usar todas, não só tools

A maioria das implementações expõe só tools. As outras duas resolvem problemas reais aqui:

**Tools** — os oito use cases, com os mesmos schemas Zod.

**Resources** — contexto que o agente lê sem gastar tool call:

| Resource | Conteúdo |
|----------|----------|
| `tc://produto` | `PRODUTO-TC.md` — o que é o produto, TCD0 × TCD1, monotonicidade |
| `tc://dicionario` | significado de cada campo, incluindo o `modelo*` polimórfico |
| `tc://glossario` | STAR, Penhora e Fumaça, Fluxo de Exceção, flip intra-regime |

Sem isso, o agente traduz "TCD1" como jargão ou, pior, inventa o significado.

**Prompts** — as perguntas douradas viram prompts reutilizáveis:

```
/panorama-mensal        composição por gate + matriz de modelos
/investigar-drift       um modelo caiu — decompõe e compara períodos
/auditar-excecao        pré-pós + vigência declarada × aplicada
/anomalia-trilhos       volume e origem de {tcd0:1, tcd1:0}
```

O mesmo conjunto alimenta os evals (§7) e os botões de sugestão do chat. Escrito uma vez.

### 5.5. MCP de desenvolvimento — outra coisa

O `.md` original citava Filesystem MCP e Postgres MCP para acelerar a escrita do código.
São ferramentas **de construção**, não do produto, e não vão para o repositório da
aplicação. Ficam na configuração local de quem desenvolve.

Vale a distinção porque na apresentação é fácil confundir: *"usamos MCP"* pode significar
"o produto expõe um servidor MCP" ou "usei MCP para escrever mais rápido". As duas coisas
são verdade aqui, e são diferentes.

---

## 6. Guardrails

Concretos, não aspiracionais:

| Guardrail | Como |
|-----------|------|
| **Allowlist por agente** | O Analista recebe 8 tools de leitura. A tool de escrita do Copiloto não está no registro dele — não é bloqueio em runtime, é ausência |
| **Sem expressão livre** | Nenhum parâmetro aceita SQL, filtro ou código |
| **Argumentos validados** | Zod na entrada de toda tool; erro de validação volta como mensagem legível para o modelo corrigir, nunca como 500 |
| **Limite de passos** | `maxSteps` fecha o loop; excedeu, responde o que tem e diz que parou |
| **Timeout por tool** | Consulta lenta não trava o stream |
| **Filtro de PII na saída** | Rede de segurança: varre a resposta por padrão de CPF/CNPJ antes de emitir. Não deveria disparar nunca — se disparar, é bug de ACL |
| **Escrita é human-in-the-loop** | Nenhuma tool do Copiloto concede exceção. Decisão automatizada sobre acesso a crédito tem implicação regulatória (`PLANO-ENTREGA.md` §8.5) |

---

## 7. Evals — com tools, o que se testa muda

Eval de texto não serve aqui. Com tools, há três checagens objetivas:

**1. Seleção de tool.** Dada a pergunta, o agente chamou a tool certa com os argumentos
certos? *"Por que o M3 caiu?"* deve chamar `getModelOverview` com o período correto — não
`getFunnel`.

**2. Fidelidade numérica — a checagem que mais importa.** Todo número presente na resposta
precisa aparecer em algum `toolResult` daquela conversa. É verificável por regex sobre a
saída, cruzando com o retorno das tools.

> É a tradução executável do princípio "o LLM nunca calcula um número". Deixa de ser
> promessa de arquitetura e vira teste que quebra o build.

**3. Ressalva presente.** Resposta que usa um recorte com cobertura parcial precisa
mencionar a cobertura. Verificável contra o campo `basis` do retorno.

As perguntas douradas dos prompts MCP (§5.4) são o conjunto de eval. Uma definição, três
usos: prompt MCP, sugestão no chat, caso de teste.

---

## 8. Estrutura e pacotes

### 8.1. Pastas

```
apps/api/src/agent/
├── analyst/
│   ├── analyst.agent.ts          loop, maxSteps, streaming
│   ├── tools/                    um arquivo por tool
│   └── prompt.ts                 system prompt
├── copilot/                      Fase 6
│   ├── copilot.agent.ts
│   └── tools/
├── shared/
│   ├── tool-registry.ts          allowlist por agente
│   ├── pii-filter.ts
│   └── render-spec.ts            descritor de visualização
└── agent.module.ts

packages/mcp-server/              ← novo pacote
├── src/
│   ├── server.ts                 stdio + streamable HTTP
│   ├── api-client.ts             cliente HTTP tipado por contracts
│   ├── tools/
│   ├── resources/                produto, dicionário, glossário
│   └── prompts/                  perguntas douradas
└── README.md                     como plugar no Claude Code

apps/web/src/features/agent/
├── ChatPanel.tsx
├── SuggestedQuestions.tsx
└── renderers/                    component → React (generative UI)
```

### 8.2. Pacotes adicionais

**`apps/api` — Fase 3**

| Pacote | Papel |
|--------|-------|
| `ai` | tool calling, streaming, `maxSteps` |
| `@ai-sdk/amazon-bedrock` **ou** `@ai-sdk/anthropic` | provider — decisão ainda aberta |

**`packages/mcp-server` — Fase 3**

| Pacote | Papel |
|--------|-------|
| `@modelcontextprotocol/sdk` | servidor MCP, transportes stdio e HTTP |
| `zod` | reusa os schemas de `contracts` |

**`apps/web` — Fase 3**

| Pacote | Papel |
|--------|-------|
| `@ai-sdk/react` | `useChat`, streaming, render de tool results |

O skill `mcp-builder`, já instalado em `.claude/skills/`, cobre a construção do servidor.

---

## 9. Pontos em aberto

1. **Provider do LLM** — Bedrock ou Anthropic direto. Bedrock mantém o dado na conta AWS e
   usa IAM em vez de chave; é o argumento mais forte em ambiente corporativo. Só muda o
   adapter.
2. **O servidor MCP vai ser exposto além da máquina local?** Se sim, precisa de
   autenticação e a decisão de transporte deixa de ser trivial. Começar por stdio local
   resolve o caso do Claude Code sem abrir superfície.
3. **Quem mais consumiria o MCP na Cielo?** Se houver um segundo time interessado, o
   servidor sobe de "demonstração de arquitetura" para entrega com usuário real — e isso
   muda a prioridade dele nas fases.
