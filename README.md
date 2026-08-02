# TC Smart Eligibility

Painel de governança da elegibilidade do produto **TC — "Vendeu, Tá na Conta"** (Cielo),
com camada de IA aplicada onde ela agrega e não como enfeite.

**Estado atual: planejamento completo, nenhuma linha de código de aplicação.** Tudo neste
repositório é definição, protótipo de leitura e material de decisão.

---

## O problema

O Fluxo de Exceção é o **primeiro portão** da avaliação de elegibilidade: quem está nele
entra elegível sem que Prevenção STAR, Penhora/Fumaça, Fraudes ou Crédito sejam
consultados.

> Para essa população, a decisão de risco **nunca é gerada**. Não existe log de override —
> existe ausência de dado.

Não é lacuna de visibilidade, é ponto cego estrutural. E o mecanismo que ignora os modelos
de risco é acionado por **análise humana via e-mail ou Teams**, sem critério registrado nem
trilha de auditoria.

## As seis perguntas que a entrega precisa responder

| | Pergunta | Como |
|---|---|---|
| **P1** | Qual o volume que entra pelo atalho da Exceção? | Funil com o bypass explícito |
| **P2** | O que a Exceção faz com quem passa por ela? | Desenho pré-pós — o cliente é seu próprio controle |
| **P3** | A que custo real? | Taxa de expulsão pós-expiração; outcome financeiro quando existir |
| **P4** | E se eu mexer nas regras? | Simulador What-If |
| **P5** | Onde a base está inconsistente? | Anomalia `{tcd0:1, tcd1:0}`, com origem rastreável |
| **P6** | O produto responde de forma estável? | Volatilidade decomposta por causa |

---

## Integrações de IA

### No produto

| # | Integração | O que é | Fase |
|---|-----------|---------|------|
| 1 | **Agente Analista** | Chatbot do painel. Tool calling sobre 9 tools de leitura, streaming, in-process | 3 |
| 2 | **Generative UI** | Tool result renderiza como componente React — o gráfico aparece antes do texto terminar | 3 |
| 3 | **Servidor MCP** | Processo separado, cliente HTTP da API. Expõe os mesmos use cases a Claude Code, Claude Desktop e outros agentes internos | 3 |
| 4 | **Narrador** | Resumo executivo automático. Uma chamada com saída estruturada sobre deltas já calculados — **não é agente** | 3 |
| 5 | **Triagem de anomalia** | Detecção é estatística determinística; o LLM só prioriza e redige | 3 |
| 6 | **Proxy de tokenização de PII** | Determinístico, sem LLM. Substitui CPF/CNPJ/EC por referência opaca antes de qualquer chamada ao provedor | 3 |
| 7 | **Evals em CI** | Seleção de tool, fidelidade numérica e presença de ressalva | 5 |
| 8 | **Copiloto de Concessão** | Segundo agente, human-in-the-loop. Monta dossiê e recomenda; a pessoa decide | 6 |

### No processo de construção

| Integração | Papel |
|-----------|-------|
| **Skills versionadas** | Nove skills em `.claude/skills/` — design, MCP, documentos, criação de skills |
| **MCP de desenvolvimento** | Filesystem e Postgres MCP, na configuração local de quem desenvolve — **não vai para o produto** |

### As três ideias que sustentam a camada de IA

**O LLM nunca calcula um número.** Ele escolhe ferramentas e narra resultados. Isso vira
teste executável: todo número na resposta precisa aparecer em algum `toolResult` daquela
conversa, verificável por regex — deixa de ser promessa de arquitetura e passa a quebrar o
build.

**Uma regra, três superfícies.** O mesmo use case atende o painel, o chatbot e o servidor
MCP. Nenhuma regra de negócio é escrita duas vezes.

**O identificador entra pela porta da frente, não pelo modelo.** A busca por CPF, CNPJ ou
EC funciona, e o identificador nunca chega ao provedor de LLM.

E duas decisões de **não** usar IA: o narrador e o detector de anomalia não são agentes, e
chamá-los assim seria inflação de vocabulário. Multiagente com fan-out foi considerado e
descartado — adiciona falha parcial e custo sem ganho de tempo mensurável no volume atual.

---

## Documentos

| Documento | Conteúdo |
|-----------|----------|
| [`PLANO-ENTREGA.md`](docs/PLANO-ENTREGA.md) | Documento principal: problema, princípios, fluxo real, painéis, fases |
| [`AGENTES-E-MCP.md`](docs/AGENTES-E-MCP.md) | Agentes, tools, MCP, guardrails, evals |
| [`ARQUITETURA.md`](docs/ARQUITETURA.md) | Estrutura de pastas, regras de dependência, pacotes por fase |
| [`ANALISE-TEMPORAL.md`](docs/ANALISE-TEMPORAL.md) | Granularidade, volatilidade, janela de exceção, desenho pré-pós |
| [`PRODUTO-TC.md`](docs/PRODUTO-TC.md) | Contexto de negócio, TCD0 × TCD1, condições operacionais |
| [`design/TOKENS.md`](docs/design/TOKENS.md) | Cores, tipografia e forma na linguagem Cielo |
| [`prototipos/painel-po.html`](docs/prototipos/painel-po.html) | Protótipo de leitura validado |

## Stack

Node · NestJS · Sequelize · Zod · PostgreSQL (JSONB) · React · Tailwind · Vercel AI SDK ·
MCP SDK

Monorepo com quatro pacotes: `apps/api`, `apps/web`, `packages/contracts`,
`packages/mcp-server`.

## O que descobrimos sobre os dados

Achados que mudaram o desenho e não estavam no enunciado:

- Os campos `modelo*` são **polimórficos** — carregam o modelo aplicado *ou* o portão que
  encerrou a decisão. O gate de saída é derivável sem mudar produção
- `M1` de fraude **não é** o `M1` de crédito — mesmos nomes, espaços distintos
- `ec` nulo **não** significa "não é cliente Cielo" — significa "não resolvido na base
  ativa", e agrupa cliente novo com vigente inativo
- Um cliente é consultado **várias vezes por dia**, então contar por consulta descreveria
  tráfego de integração, não a base
- A Exceção é **janela temporal**, não estado — o que torna o contrafactual medição direta
  em vez de estimativa
- A anomalia `{tcd0:1, tcd1:0}` é **sempre herdada** de um dos modelos, nunca emergente da
  composição — logo sempre há um responsável identificável

## Decisões em aberto

1. Provider do LLM — Bedrock ou Anthropic direto
2. Tailwind v3 ou v4 (única com custo de retrabalho se ficar para depois)
3. Frequência real da anomalia `{tcd0:1, tcd1:0}` — muda o gerador sintético
4. Existe outcome financeiro? Decide se **P3** existe além do proxy
5. Campos da tabela de vigência, e se solicitações negadas são registradas
6. Hex oficiais da marca e nome da família tipográfica
7. Um cliente pode trocar de EC ao longo do tempo?
