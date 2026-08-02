# Arquitetura e dependências

> Definições para revisão **antes** de qualquer implementação. Estrutura de pastas, regras
> de dependência e a lista completa de pacotes, separada por fase para não instalar tudo de
> uma vez.
>
> Complementa `PLANO-ENTREGA.md` §5 (arquitetura em camadas) e §2.1 (stack).

---

## 1. O monorepo

```
apl-smart-flow/
├── .claude/skills/            skills do projeto (versionadas)
├── docs/                      planejamento, produto, design
│   ├── design/                tokens
│   └── prototipos/            protótipos de leitura
│
├── apps/
│   ├── api/                   NestJS
│   └── web/                   React + Vite
│
├── packages/
│   ├── contracts/             schemas Zod — fonte única de verdade
│   └── mcp-server/            servidor MCP — expõe os use cases a outros agentes
│
├── docker-compose.yml         Postgres local
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.js
└── package.json
```

Quatro pacotes. `contracts` é folha (não depende de ninguém); `api`, `web` e `mcp-server`
dependem dele e nunca um do outro — o `mcp-server` fala com a `api` por HTTP, não por
import. Ver [`AGENTES-E-MCP.md`](./AGENTES-E-MCP.md) §5.3.

### Por que pnpm

Links simbólicos reais entre workspaces, sem `npm link` nem duplicação de `node_modules`.
`npm workspaces` funciona e é troca de uma linha se você preferir — só perde velocidade e
o isolamento estrito de dependências fantasmas.

---

## 2. `packages/contracts`

```
packages/contracts/src/
├── primitives/
│   ├── merchant-ref.ts        MerchantRef (branded)
│   ├── eligibility.ts         EligibilityPair { tcd0, tcd1 }
│   ├── track.ts               Track = 'TCD0' | 'TCD1'
│   └── models.ts              FraudModel e CreditModel (branded, separados)
├── decision/
│   ├── raw-payload.ts         o payload como produção emite
│   └── decision-record.ts     o modelo de domínio derivado
├── queries/
│   ├── funnel.ts              entrada e saída de GetFunnel
│   ├── model-overview.ts
│   ├── inconsistency.ts
│   ├── volatility.ts
│   ├── exception.ts
│   └── simulation.ts
├── agent/
│   └── tools.ts               schemas das tools (reusam queries/)
└── index.ts
```

**A regra de ouro (§3.4 do plano):** cada schema é escrito uma vez em Zod e vira três
coisas — DTO validado no Nest, tipo estático no React, e schema da tool do agente. Nenhum
tipo é declarado duas vezes.

`raw-payload.ts` e `decision-record.ts` existem **separados de propósito**: o primeiro
descreve o que a produção emite (campos `modelo*` polimórficos, `ec` nullable), o segundo o
que o resto do sistema enxerga. A ACL é a única coisa autorizada a converter um no outro.

---

## 3. `apps/api` — NestJS

```
apps/api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── domain/                     ← puro. Sem Nest, sem Sequelize, sem I/O.
│   │   ├── decision/
│   │   │   ├── decision.ts         entidade + invariantes
│   │   │   ├── eligibility.ts      AND por trilho, monotonicidade
│   │   │   └── gate.ts             EXCEPTION | STAR | LIEN | RISK
│   │   ├── rules/
│   │   │   ├── rule-engine.ts      motor recalculável (Fase 4)
│   │   │   └── scenario.ts         parâmetros do What-If
│   │   └── errors/
│   │
│   ├── application/                ← use cases. Orquestram, não conhecem SQL.
│   │   ├── ports/                  interfaces que a infra implementa
│   │   │   ├── decision-repository.port.ts
│   │   │   ├── exception-window-repository.port.ts
│   │   │   └── llm-provider.port.ts
│   │   ├── funnel/get-funnel.usecase.ts
│   │   ├── overview/get-model-overview.usecase.ts
│   │   ├── inconsistency/get-inconsistency-report.usecase.ts
│   │   ├── volatility/get-volatility-report.usecase.ts
│   │   ├── exception/
│   │   │   ├── get-exception-counterfactual.usecase.ts
│   │   │   └── audit-exception-application.usecase.ts
│   │   ├── simulation/simulate-scenario.usecase.ts
│   │   └── explain/explain-decision.usecase.ts
│   │
│   ├── infrastructure/
│   │   ├── persistence/
│   │   │   ├── models/             Sequelize
│   │   │   ├── acl/                ← tradução payload → domínio
│   │   │   │   ├── decision.mapper.ts
│   │   │   │   ├── gate.mapper.ts        modelo* polimórfico → exitGate
│   │   │   │   ├── merchant-ref.ts       hash do CPF/CNPJ
│   │   │   │   └── integrity.ts          validações de ingestão
│   │   │   ├── queries/            ← SQL analítico, um arquivo por use case
│   │   │   └── repositories/       implementam as ports
│   │   ├── llm/
│   │   │   ├── llm.module.ts
│   │   │   └── providers/          bedrock.ts · anthropic.ts
│   │   └── config/                 env tipado
│   │
│   ├── agent/                      ← só wrappers. Sem banco, sem SQL, sem PII.
│   │   ├── agent.service.ts
│   │   ├── tools/                  um arquivo por tool
│   │   └── prompts/                system prompt (usa PRODUTO-TC.md)
│   │
│   └── http/
│       ├── controllers/
│       ├── pipes/zod-validation.pipe.ts
│       └── filters/
│
├── migrations/                     SQL bruto: GIN, matviews
├── seeds/                          ← gerador sintético
│   ├── generator/
│   │   ├── profiles.ts             distribuições e maturidade
│   │   ├── windows.ts              vigências de exceção
│   │   ├── consultations.ts        cauda longa, flips
│   │   └── scenarios.ts            cenários plantados
│   └── seed.ts
└── test/
    ├── fixtures/real-payloads.ts   ← os 6 exemplos do time
    ├── unit/
    └── e2e/
```

### 3.1. Regra de dependência

As setas apontam **para dentro**. Nada aponta para fora.

```
   http ─┐
         ├─→ application ──→ domain
  agent ─┘         ↑
                   │ implementa as ports
           infrastructure

   contracts ← todos (folha, sem dependências)
```

Três proibições que o lint vai reforçar (§6.2):

1. `domain/` **não importa** Nest, Sequelize, `pg`, nem nada de `infrastructure/`
2. `application/` **não importa** `infrastructure/` — só as `ports/`
3. `agent/` **não importa** `infrastructure/` nem `domain/` diretamente — só use cases

A terceira é a que garante o princípio "o LLM nunca calcula um número": se o agente não
alcança o repositório, ele não tem como inventar uma consulta.

### 3.2. Onde o SQL mora

`infrastructure/persistence/queries/` — um arquivo por use case, cada um exportando uma
função que recebe parâmetros tipados e devolve linhas tipadas, executada com
`sequelize.query()` + `replacements`. Nunca concatenação de string.

Os models do Sequelize cobrem escrita, migrations e leitura transacional simples. As
agregações (window functions, JSONB, matviews) são SQL escrito à mão, porque o query
builder produz código pior — ver `PLANO-ENTREGA.md` §2.1.

---

## 4. `apps/web` — React + Vite

```
apps/web/src/
├── main.tsx
├── app/
│   ├── router.tsx
│   ├── providers.tsx           QueryClient, tema
│   └── layout/
│
├── features/                   ← por domínio, não por tipo de arquivo
│   ├── overview/               nível 1 — funil + matriz dimensão × modelo
│   │   ├── components/
│   │   ├── hooks/
│   │   └── OverviewPage.tsx
│   ├── inconsistency/          nível 2 — P5
│   ├── volatility/             nível 2 — P6
│   ├── exception/              nível 3 — P1, P2, P3
│   ├── simulation/             What-If — P4
│   └── agent/                  chat, generative UI
│
├── components/                 primitivos compartilhados
│   ├── ui/                     Button, Chip, Badge, Card
│   └── viz/                    Funnel, StageBar, Meter, EmphasisBar
│
├── lib/
│   ├── api-client.ts           tipado por contracts
│   ├── format.ts               pt-BR, tabular-nums
│   └── labels.ts               TCD0 → "Mesmo dia" (PRODUTO-TC.md §6)
│
└── styles/
    └── tokens.css              gerado dos tokens de design
```

**Organização por feature, não por tipo.** Uma pasta `components/` global com trinta
arquivos soltos não diz nada sobre o produto; `features/exception/` diz que ali mora o
painel do portão 1.

`components/viz/` merece nota: o protótipo inteiro que já validamos é **HTML e CSS puro** —
funil, matriz, medidor, barra de ênfase, quadrantes. Nenhuma biblioteca de gráfico. Isso é
deliberado e deve continuar até aparecer uma necessidade real (§5.3).

---

## 5. Pacotes

Separados por fase. Nada é instalado antes de ser usado.

### 5.1. Raiz do monorepo — Fase 0

| Pacote | Papel | Nota |
|--------|-------|------|
| `typescript` | compilador, versão única para todos | |
| `turbo` | orquestra build e teste respeitando a ordem `contracts → api/web`, com cache no CI | Pode sair se preferir só `pnpm --filter`; ganha simplicidade, perde cache |
| `eslint` + `typescript-eslint` | lint | flat config |
| `eslint-plugin-boundaries` | **transforma a regra de dependência em erro de build** | O item mais importante desta lista — ver §6.2 |
| `prettier` | formatação | |
| `husky` + `lint-staged` | hook de pre-commit | Opcional; se o time não usa, o CI cobre |
| `@types/node` | | |

### 5.2. `packages/contracts` — Fase 0

| Pacote | Papel |
|--------|-------|
| `zod` | única dependência de runtime |

### 5.3. `apps/api`

**Fase 0 — fundação, ACL e gerador**

| Pacote | Papel | Nota |
|--------|-------|------|
| `@nestjs/common` `@nestjs/core` `@nestjs/platform-express` | núcleo | Fastify é mais rápido; Express tem menos atrito e o SSE do agente funciona nos dois |
| `reflect-metadata` `rxjs` | exigidos pelo Nest | |
| `@nestjs/config` | env tipado, validado com Zod | |
| `sequelize` `sequelize-typescript` `@nestjs/sequelize` | ORM e integração | |
| `pg` `pg-hstore` | driver Postgres | |
| `sequelize-cli` | migrations | Alternativa: `umzug`, mais TS-first. Sugiro `sequelize-cli` por alinhamento com o time |
| `date-fns` | manipulação de data | O projeto é cheio de janela e período |
| `vitest` | testes | Jest é o default do Nest; Vitest é mais rápido e ESM-nativo. Troca fácil se o time preferir Jest |
| `@faker-js/faker` | massa sintética | Com seed fixo — a reprodutibilidade é requisito |

**Fase 1–2 — API e consultas**

| Pacote | Papel | Nota |
|--------|-------|------|
| `nestjs-pino` `pino` `pino-pretty` | log estruturado | |
| `helmet` | cabeçalhos de segurança | |
| `@nestjs/throttler` | rate limit | Barato agora, caro de retrofitar |
| `supertest` | e2e HTTP | |
| `@testcontainers/postgresql` | Postgres real nos testes | Opcional — `docker-compose` cobre se preferir |

**Fase 3 — agente**

| Pacote | Papel | Nota |
|--------|-------|------|
| `ai` | Vercel AI SDK — tool calling, streaming, `maxSteps` | Ver `PLANO-ENTREGA.md` §5.2 |
| `@ai-sdk/amazon-bedrock` **ou** `@ai-sdk/anthropic` | provider | **Decisão ainda aberta.** Instalar só um, atrás da port |

### 5.3.1. `packages/mcp-server` — Fase 3

| Pacote | Papel |
|--------|-------|
| `@modelcontextprotocol/sdk` | servidor MCP, transportes stdio e HTTP |
| `zod` | reusa os schemas de `contracts` |

Detalhamento em [`AGENTES-E-MCP.md`](./AGENTES-E-MCP.md).

**Fase 5 — maturidade**

| Pacote | Papel |
|--------|-------|
| `@opentelemetry/sdk-node` + instrumentações | tracing de latência, custo e tool calls |

### 5.4. `apps/web`

**Fase 1**

| Pacote | Papel | Nota |
|--------|-------|------|
| `react` `react-dom` | | |
| `vite` `@vitejs/plugin-react` | build | |
| `tailwindcss` | estilos | **Ver a decisão de versão em §5.5** |
| `react-router` | rotas — cada nível e recorte tem URL própria | Drill-down compartilhável importa para um PO |
| `@tanstack/react-query` | cache, revalidação, estados de carregamento | Dispensa gerenciador de estado global |
| `lucide-react` | ícones de linha | Casa com o traço da Cielo |
| `vitest` `@testing-library/react` | testes | |
| `@playwright/test` | e2e | Já instalado no ambiente |

**Fase 3 — chat**

| Pacote | Papel |
|--------|-------|
| `@ai-sdk/react` | `useChat`, streaming, render de tool results (generative UI) |

**Fase 4 — What-If**

| Pacote | Papel |
|--------|-------|
| `react-hook-form` + `@hookform/resolvers` | formulário do simulador, validado pelos schemas Zod já existentes |

### 5.5. Decisão pendente: Tailwind v3 ou v4

O `docs/design/tailwind.tokens.js` que já entreguei está no **formato v3** (preset com
`theme.extend` e plugin `addBase`). O v4 abandonou o `tailwind.config.js` em favor de
`@theme` dentro do CSS.

| | v3 | v4 |
|---|---|---|
| Config | `tailwind.config.js` | `@theme` no CSS |
| Tokens atuais | funcionam como estão | precisam virar `tokens.css` |
| Ecossistema | maduro | shadcn e afins ainda com atrito |

Para projeto novo em 2026, **v4** é a escolha. Se você concordar, converto o arquivo de
tokens — é trabalho pequeno e melhor fazer antes de existir componente.

### 5.6. O que deliberadamente não entra

| Descartado | Por quê |
|-----------|---------|
| Prisma, TypeORM | O time usa Sequelize; trocar ORM não é o problema a resolver |
| LangChain.js | Abstrações competem com o container do Nest — `PLANO-ENTREGA.md` §5.2 |
| Redux, Zustand | React Query cobre estado de servidor; estado local de UI é local |
| Recharts, Nivo, visx | O protótipo validado não usa nenhuma. Entra só quando aparecer a série temporal do drift, e aí instalamos **uma** |
| Storybook | Custo alto para o tamanho do time e do escopo |
| `class-validator` / `class-transformer` | Zod já é a fronteira; dois validadores é um a mais |

---

## 6. Decisões que sustentam a arquitetura

### 6.1. A ACL é uma pasta, não um arquivo

`infrastructure/persistence/acl/` concentra toda a tradução entre o payload de produção e
o modelo de domínio: derivação de `exitGate` a partir do campo `modelo*` polimórfico,
`merchantRef` a partir do CPF/CNPJ, `isInconsistent`, `hasResolvedEc`, e a separação de
tipos entre modelos de fraude e de crédito.

É a única fronteira onde o formato de produção é conhecido. Acima dela, ninguém sabe que
`modeloFraudes` pode conter `"PENHORAEFUMACA"`.

### 6.2. A regra de dependência vira lint

Convenção documentada apodrece. `eslint-plugin-boundaries` declara as camadas e o CI
quebra quando alguém importa Sequelize no domínio ou o repositório no agente.

Esboço da configuração:

```
elements:
  domain          apps/api/src/domain/*
  application     apps/api/src/application/*
  infrastructure  apps/api/src/infrastructure/*
  agent           apps/api/src/agent/*
  http            apps/api/src/http/*

rules:
  domain          → (nada, exceto contracts)
  application     → domain, contracts
  infrastructure  → application, domain, contracts
  agent           → application, contracts
  http            → application, contracts
```

### 6.3. Os seis payloads reais são fixture de teste

`test/fixtures/real-payloads.ts` guarda os exemplos que o time enviou. A suíte da ACL roda
contra eles e verifica, de uma vez: o mapeamento de gate, o AND por trilho, a invariante de
`M1` sem EC resolvido, o predicado de anomalia no sentido correto, e a ausência do `id` na
saída.

É a única verificação do projeto que roda contra dado real e não sintético.

### 6.4. Um comando sobe tudo

```
pnpm dev     docker-compose up + api + web em paralelo
pnpm seed    gera a massa sintética com seed fixo
pnpm test    contracts → api → web, na ordem
pnpm lint    inclui a checagem de fronteiras
```

---

## 7. Pontos para você revisar

1. **Tailwind v3 ou v4** (§5.5) — é a única decisão que gera retrabalho se ficar para depois
2. **Vitest ou Jest** — recomendo Vitest; se o time padroniza Jest, alinho
3. **Express ou Fastify** — recomendo Express por menor atrito
4. **`sequelize-cli` ou `umzug`** para migrations — recomendo `sequelize-cli` por alinhamento
5. **Turborepo entra?** — útil no CI, dispensável em três pacotes
6. **Husky** — só se o time já usa hooks de pre-commit
7. Algum pacote da §5.6 que você queira resgatar, ou algum interno da Cielo que deva entrar
   no lugar de um destes
