# TC Smart Eligibility — Documento Consolidado

> Registro completo de tudo que foi definido: contexto de negócio, achados sobre os dados,
> arquitetura, camada de IA, design, fases e decisões. Reúne num só lugar o conteúdo de
> `PLANO-ENTREGA.md`, `AGENTES-E-MCP.md`, `ARQUITETURA.md`, `ANALISE-TEMPORAL.md`,
> `PRODUTO-TC.md` e `design/TOKENS.md`.
>
> **Estado: planejamento fechado, nenhuma linha de código de aplicação escrita.**

---

# Parte I — O problema

## 1. O desafio, e por que ele foi reenquadrado

O enunciado original pedia *"um dashboard para o PO ver os dados de elegibilidade do
produto TC"*. Isso subvende o problema.

O **Fluxo de Exceção é o primeiro portão** da avaliação. Quem está nele retorna elegível
para os dois trilhos imediatamente, sem que Prevenção STAR, Penhora/Fumaça, Fraudes ou
Crédito sejam consultados. Os campos de elegibilidade vêm preenchidos com `1`, mas isso não
é resultado de avaliação — é o valor que o atalho grava.

> Para a população que passa pela Exceção, a decisão de risco **nunca é gerada**.
> Não existe log de override — existe ausência de dado.

Não é lacuna de visibilidade. É **ponto cego estrutural**. E o mecanismo que ignora os
modelos de crédito e fraude é acionado por **análise humana via e-mail ou Teams**, sem
critério registrado, sem reason code e sem trilha de auditoria.

## 2. As seis perguntas que definem sucesso

| | Pergunta | O que exige |
|---|---|---|
| **P1** | Qual o volume que entra pelo atalho da Exceção? | Funil com o bypass explícito |
| **P2** | O que a Exceção faz com quem passa por ela? | Desenho pré-pós sobre janelas encerradas |
| **P3** | A que custo real? | Taxa de expulsão pós-expiração; outcome financeiro quando existir |
| **P4** | E se eu mexer nas regras? | Simulador What-If |
| **P5** | Onde a base está inconsistente? | Anomalia `{tcd0:1, tcd1:0}`, com origem rastreável |
| **P6** | O produto responde de forma estável? | Volatilidade decomposta por causa |

Responder P1 é relatório. **P2**, **P5** e **P6** entregam números que hoje não existem em
lugar nenhum.

---

# Parte II — O produto e os dados

## 3. O produto TC — "Vendeu, Tá na Conta"

Antecipação automática e recorrente dos recebíveis de venda. O lojista recebe **no mesmo
dia** ou **no dia seguinte**, de forma contínua, inclusive em finais de semana e feriados.
Vale para débito, crédito à vista e parcelado.

### 3.1. As duas modalidades

| Trilho | Modalidade no site | Promessa |
|--------|-------------------|----------|
| **TCD0** | *Vendeu, Tá na Conta* — **Hoje!** | Receba no mesmo dia |
| **TCD1** | *Vendeu, Tá na Conta* — **Amanhã!** | Receba em 1 dia |

São **modalidades comerciais distintas do mesmo produto**, não estágios de um funil — por
isso a elegibilidade é emitida em par.

**TCD0 é o trilho mais restritivo**, por razão econômica: antecipa mais valor e mais cedo,
logo expõe mais a Cielo.

Disso decorre a monotonicidade esperada: `tcd0 = 1` deveria implicar `tcd1 = 1`.

| Estado | Leitura |
|--------|---------|
| `{tcd0:0, tcd1:1}` | **Caso comum** — recebe no dia seguinte, não no mesmo dia |
| `{tcd0:1, tcd1:1}` | Elegível aos dois |
| `{tcd0:0, tcd1:0}` | Inelegível |
| `{tcd0:1, tcd1:0}` | ⚠ **Anômalo** — passou no restritivo e falhou no permissivo |

A anomalia ocorre em produção e compõe **menos de 10% da base**.

### 3.2. Condições operacionais

- **TCD0** vale para transações até **18h59**
- Ambas sujeitas a análise de elegibilidade — é o que este projeto mede
- **Prazos menores exigem conta vinculada a chave Pix** — plausivelmente o TCD0, a
  confirmar; seria variável explicativa ausente do payload
- O lojista pode ter mais de um domicílio bancário

### 3.3. Produto vizinho: Antecipação Avulsa

Antecipação **sob demanda** de saldos já vendidos, aprovada até 15h45 para o mesmo dia.
Diferença que importa: **TC é recorrente e automático; a Avulsa é pontual e solicitada.**
Se as bases de elegibilidade forem compartilhadas, precisam ser separadas antes de agregar.

### 3.4. Canais

Site, App Cielo Gestão, Gerente de Negócio ou telefone. **A concessão de exceção não passa
por nenhum deles** — é pedida por e-mail ou Teams e analisada manualmente.

## 4. O fluxo de elegibilidade

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
  duas dimensões
- **Gate 4 é paralelo e por trilho**
- **Combinação é AND por trilho** — qualquer `0` numa dimensão zera o trilho. Verificado
  contra todos os exemplos fornecidos
- **Invariante do modelo:** sem `ec` resolvido e chegando ao gate 4, o cliente é sempre
  avaliado por `M1` nas duas dimensões. A recíproca não vale

## 5. Os dados

### 5.1. Output — o payload de decisão

```jsonc
{
  "id": "9189ARC9891",                        // CPF/CNPJ alfanumérico — PII, obrigatório
  "ec": 1234567890,                           // 10 posições — PODE SER NULL
  "elegibilidadeFraudes": { "tcd0": 1, "tcd1": 1 },
  "elegibilidadeCredito": { "tcd0": 1, "tcd1": 0 },
  "modeloFraudes": "M1",                      // modelo OU gate terminal
  "modeloCredito": "M2",                      // modelo OU gate terminal
  "elegibilidade":  { "tcd0": 1, "tcd1": 0 }  // AND por trilho
  // + data de consulta (datetime, coluna adicional)
}
```

### 5.2. Input — os nove campos

| Campo | Tipo | Papel na análise |
|-------|------|------------------|
| `id` | CPF/CNPJ | **PII** — só ele. Não sobe da infraestrutura |
| `ec` | 10 dígitos, nullable | Chave do estabelecimento |
| `mcc` | código de atividade | Setor. Cardinalidade alta — agrupar em famílias |
| `canalFiliacao` | categórico | Como o cliente foi adquirido |
| `segmento` | varejo \| grandes contas | Binário, alto poder explicativo |
| `cep3` | 3 primeiros dígitos | Região **já anonimizada na origem** |
| `tipoPessoa` | PF \| PJ \| MEI | Perfil de risco distinto por tipo |
| `dataFiliacao` | data | Tempo de casa — e a chave da §5.5a |
| `faturamento` | numérico | Porte. Bucketizar |

Tratamento:

- **`cep3` já vem anonimizado** — três dígitos dão região sem chegar perto de endereço
- **`faturamento` é sensível comercialmente**, ainda que não seja PII: o que vai ao LLM é
  **faixa**, nunca valor; o valor exato aparece na interface, que não passa pelo modelo
- **`mcc` vai agrupado** em famílias no filtro, com o código cru no drill-down

### 5.3. Os campos `modelo*` são polimórficos

Achado central da modelagem. Carregam **duas semânticas** no mesmo campo:

| Valor | Significado | `exitGate` derivado |
|-------|-------------|---------------------|
| `EXCECAO` | Gate 1 encerrou — nenhum modelo rodou | `EXCEPTION` |
| `PREVENCAO` | Gate 2 encerrou | `STAR` |
| `PENHORAEFUMACA` | Gate 3 encerrou | `LIEN` |
| `M1` / `M2` / `M3` | Gate 4 avaliou, com este modelo | `RISK` |

**Consequência:** o gate de saída e o marcador de passagem pela Exceção são **deriváveis do
payload atual**. Não é preciso alterar instrumentação de produção — é trabalho de tradução
na camada de infraestrutura.

Duas armadilhas embutidas:

**a) `M1` de fraude ≠ `M1` de crédito.** Os conjuntos se sobrepõem nos nomes mas são
espaços distintos. Um enum único permitiria agregações sem sentido do tipo "taxa de
aprovação do M1" somando as duas dimensões. No domínio serão **branded types separados**,
impedindo a mistura em tempo de compilação.

**b) O modelo é proxy de maturidade do cliente.** Modelos mais fracos atendem clientes
novos ou recém-credenciados. Isso o torna dimensão de segmentação imediata, mas também
significa que comparar taxa entre modelos é **viés de seleção**.

### 5.4. `ec` nulo não significa "não é cliente Cielo"

O cruzamento é feito **apenas contra a base de clientes ativos**, por decisão de engenharia
para reduzir volume. Logo `ec = null` significa **"não resolvido na base ativa"**, e agrupa:

1. **Cliente novo** — quer contratar o TC no ato da filiação
2. **Cliente vigente inativo** — já é cliente, mas está fora da base de cruzamento

O nome `isCredenciado` seria semanticamente falso; o modelo usa `hasResolvedEc`.

Existe um **viés de amostragem estrutural**: clientes inativos são tratados como novos e
recebem sempre o modelo mais fraco.

### 5.5. O que o input destrava

**a) A ambiguidade do `ec` nulo se resolve.** Com `dataFiliacao`:

| `ec` | `dataFiliacao` | Leitura |
|------|----------------|---------|
| nulo | recente ou ausente | **Cliente novo** |
| nulo | antiga | **Vigente inativo** |
| presente | qualquer | Estabelecimento ativo |

**b) "O modelo é proxy de maturidade" vira testável.** Com `dataFiliacao`, `faturamento`,
`segmento` e `tipoPessoa` dá para **inferir o critério de roteamento dos dados**, em vez de
esperar documentação.

**c) O viés de seleção deixa de ser aviso.** A comparação entre modelos passa a ser válida
**dentro do mesmo estrato**. Comparação estratificada é resposta; aviso é ressalva.

### 5.6. Titular e estabelecimento

> Um **CPF/CNPJ** pode ter **N ECs**. Um **EC nunca muda** de titular. **Cada EC tem
> elegibilidade própria.**

`merchantRef` é hash do `id`, portanto vive no nível do **titular**. Contar por ele
colapsaria N estabelecimentos com decisões distintas.

**Unidade adotada:** o sujeito da decisão é o par `(merchantRef, ec)` — o estabelecimento —
e `(merchantRef, null)` quando o EC não foi resolvido. O titular é nível de agregação
**acima**, oferecido só com rótulo explícito, nunca como default.

Busca por CNPJ devolve vários estabelecimentos; por EC, um só.

### 5.7. Granularidade: consulta ≠ cliente

Um mesmo cliente pode ser consultado **um número indefinido de vezes por dia**. É a decisão
de modelagem mais arriscada do projeto.

**O risco:** se a unidade for a consulta, um cliente integrado que consulta 500 vezes por
dia pesa 500× mais. O funil deixaria de descrever a base e passaria a descrever o padrão de
tráfego de quem integrou — parecendo correto o tempo todo.

**A solução:** duas métricas explicitamente distintas.

| Unidade | Chave | Pergunta que responde |
|---------|-------|----------------------|
| **Consulta** | linha | Carga operacional (capacidade, custo, SLA) |
| **Estabelecimento-período** | `(merchantRef, ec)` | Como está a base? *(padrão)* |
| **Estabelecimento-dia** | `(merchantRef, ec), dia` | Evolução sem distorção de tráfego |
| **Estabelecimento-regime** | `(merchantRef, ec), regime` | O que muda quando o contexto muda |
| **Titular** | `merchantRef` | Agregação acima — nunca o default |

Onde **regime** é a tripla `(exitGate, fraudModel, creditModel)`.

**Modo de agregação** (a escolha é editorial, e muda o número):

| Modo | Definição | Uso |
|------|-----------|-----|
| `LAST` | Última consulta do período | **Padrão** — estado corrente |
| `FIRST` | Primeira consulta | Estado de entrada |
| `ANY_ELIGIBLE` | Elegível ao menos uma vez | Visão de acesso |
| `ALWAYS_ELIGIBLE` | Elegível em todas | Visão conservadora |

**O gap entre `ANY` e `ALWAYS` é a volatilidade.** Não são métricas concorrentes — a
distância entre elas é o diagnóstico, e comunica melhor a um PO que qualquer taxa.

### 5.8. A tabela de log tem entrada e saída

Todas as solicitações são registradas com **input e output**. Dois desdobramentos:

**a) O input é a fonte das variáveis explicativas** (§5.2).

**b) O teste de flip intra-regime deixa de ser inferência.** Antes definido como "mesmo
portão, mesmo modelo, decisão diferente", sempre com a ressalva *"talvez algo a montante
tenha mudado"*. Com o input registrado, vira comparação direta:

> **Input idêntico, output diferente.**

Resta a ressalva menor de que os modelos consultam dados externos ausentes do input — mas o
espaço de explicação encolhe de "qualquer coisa mudou" para duas hipóteses investigáveis.

### 5.9. Regra de integridade na ingestão

Nos gates terminais, `modeloFraudes` e `modeloCredito` carregam sempre o mesmo valor.
Divergência entre eles é registro corrompido. Junto com a invariante `ec` nulo → `M1`,
alimenta um contador de qualidade de dados na UI.

## 6. A Exceção é uma janela, não um estado

A vigência tem **data de início e fim, geralmente curta**, e existe **tabela de vigência
consultável**.

A consequência vale mais que qualquer painel: se a janela é curta e as consultas são
frequentes, o mesmo cliente é avaliado pelos modelos **fora** da janela. A decisão que a
Exceção suprimiu não é inobservável — está em outra linha da tabela.

```
  RISK    RISK   │ EXCEPTION  EXCEPTION  EXCEPTION │   RISK      RISK
  {0,0}   {0,0}  │  {1,1}      {1,1}      {1,1}    │  {0,0}     {0,1}
 ───────────────┼──────────────────────────────────┼──────────────────►
      antes      │        janela de exceção         │      depois
   (contrafactual observado)                        (contrafactual observado)
```

Isso transforma o contrafactual de **estimativa** em **medição direta**.

### 6.1. Auditoria de aplicação

Ter a vigência declarada **e** o comportamento observado permite confrontar os dois:

| Divergência | Condição | Gravidade |
|-------------|----------|-----------|
| **Exceção não aplicada** | Vigência ativa, consulta retornou `RISK` | Benefício concedido e não entregue |
| **Exceção indevida** | Sem vigência, consulta retornou `EXCEPTION` | Bypass dos modelos sem autorização registrada |

O segundo é achado de conformidade. Mesmo volume zero vale reportar — é prova de que o
controle funciona.

### 6.2. Exceções concedidas e não utilizadas

População antes invisível: clientes que receberam janela e **não foram consultados durante
ela**. A concessão custou análise humana e não produziu efeito. Métricas: taxa de não
utilização, latência entre concessão e primeira consulta, duração aproveitada versus
concedida.

### 6.3. Efeito de composição temporal

Como a proporção de clientes em janela ativa varia sozinha, **a taxa de elegibilidade
global oscila por composição**. Um pico pode ser só uma safra de exceções concedidas na
semana anterior. Por isso a detecção de anomalia opera sobre a série **fora de exceção**.

## 7. A anomalia TCD0/TCD1 — prova estrutural

Duas propriedades reduzem o espaço de investigação antes de qualquer consulta.

**A anomalia é sempre herdada, nunca emergente.** Como a combinação é AND por trilho,
`elegibilidade.tcd0 = 1` exige que *ambas* as dimensões tenham `tcd0 = 1`; e
`elegibilidade.tcd1 = 0` exige que *ao menos uma* tenha `tcd1 = 0`. Essa dimensão passa
então a ter `tcd0 = 1` e `tcd1 = 0` — já está anômala por si só.

Não existe caso em que o estado inválido surja da composição de duas dimensões válidas.
**Sempre há um modelo identificável na origem:**

| Origem | Condição |
|--------|----------|
| `FRAUD` | `elegibilidadeFraudes` = `{tcd0:1, tcd1:0}` |
| `CREDIT` | `elegibilidadeCredito` = `{tcd0:1, tcd1:0}` |
| `BOTH` | ambas |

**Toda anomalia nasce no gate 4.** Nos gates terminais as duas dimensões recebem valores
idênticos (`{1,1}` na Exceção, `{0,0}` em STAR e Penhora), nenhum dos quais viola a
monotonicidade. Logo `exitGate = RISK` é condição necessária.

## 8. Taxonomia do flip

Uma taxa agregada engana: boa parte dos flips é esperada.

| Tipo | Condição | Interpretação |
|------|----------|---------------|
| **Por janela de exceção** | `exitGate` entrou ou saiu de `EXCEPTION` | Esperado |
| **Por mudança de modelo** | `fraudModel` ou `creditModel` mudou | Esperado |
| **Por mudança de gate** | Passou a cair em `STAR` ou `LIEN` | Esperado |
| **Intra-regime** | Mesmo gate, mesmos modelos, decisão diferente | **Inexplicável** — é aqui que mora o problema |

Dimensões complementares: **direção** (perda de acesso pesa mais que ganho), **trilho**, e
**padrão temporal** — flip único é provável mudança real; **oscilação** (A→B→A) é quase
sempre patológico e é o indicador de defeito mais forte do painel.

Toda métrica de flip declara sua base, porque só existe para clientes com duas ou mais
consultas — subpopulação enviesada para os mais integrados.

## 9. O desenho pré-pós

Com decisão de modelo antes e depois da janela, **o cliente é seu próprio controle**. Sem
viés de seleção: não se compara quem entrou na Exceção com quem não entrou, e sim o mesmo
cliente em dois regimes.

| Quadrante | Leitura | Ação |
|-----------|---------|------|
| **Reprovado → Reprovado** | A Exceção foi furo temporário — não mudou o risco, adiou | Maior alvo de restrição |
| **Reprovado → Aprovado** | Funcionou como rampa. **É a tese do produto, e se sustenta** | Justificativa para manter e calibrar |
| **Aprovado → Aprovado** | Era desnecessária | **Ganho puro** — sai sem mudar decisão nenhuma |
| **Aprovado → Reprovado** | Deteriorou durante a janela | Coorte de maior risco |

O quadrante *Aprovado → Aprovado* é o mais acionável: volume que sai da Exceção **sem
impacto na base**. Como toda concessão passa por análise humana, é também trabalho que
deixa de ser gasto.

**Cobertura sempre declarada.** A reconstrução só enxerga o que foi consultado; apresentar
o resultado de 57% da população como se valesse para 100% destruiria a credibilidade.

### 9.1. Taxa de expulsão — proxy de outcome

Enquanto não se confirma inadimplência ou fraude realizada:

> Dos clientes que entraram pela Exceção, quantos **perderam elegibilidade assim que a
> janela expirou**?

Não é custo financeiro — é custo de decisão e de relacionamento. Está inteiramente no dado
atual. Quando o outcome financeiro aparecer, encaixa como coluna adicional.

---

# Parte III — Arquitetura

## 10. Princípios inegociáveis

### 10.1. O LLM nunca calcula um número

Ele **escolhe ferramentas** e **narra resultados**. Todo número exibido vem de use case
determinístico, versionado e testado. Em meios de pagamento, é a fronteira entre protótipo
e código que pode ir para produção.

### 10.2. O LLM nunca vê identificador de pessoa

O `id` é CPF/CNPJ, obrigatório e sempre presente. O `ec` pode vir nulo. Não existe no
payload um identificador simultaneamente não-PII e sempre presente.

A infraestrutura deriva **`merchantRef`** — hash determinístico do `id` — única referência
a cliente exposta acima dela. Sempre presente, estável no tempo, opaco e não reversível.

**Consultar um cliente específico continua possível.** O princípio muda de formulação:
*o identificador entra pela porta da frente, não pelo modelo* (§14).

### 10.3. Uma regra de negócio, três superfícies

Painel, chatbot e servidor MCP chamam **o mesmo use case**. Nenhuma regra escrita duas
vezes.

### 10.4. Um schema, três usos

Cada contrato é definido uma vez em Zod e vira DTO validado no Nest, tipo estático no React
e schema da tool do agente.

### 10.5. IA entra sobre fundação pronta

Fases 0→2 são inteiramente determinísticas: os números existem, são testados e estão na
tela antes de qualquer LLM tocar neles.

## 11. Monorepo

```
apl-smart-flow/
├── .claude/skills/            nove skills versionadas
├── docs/
│   ├── design/                tokens
│   └── prototipos/
├── apps/
│   ├── api/                   NestJS
│   └── web/                   React + Vite
├── packages/
│   ├── contracts/             schemas Zod — fonte única de verdade
│   └── mcp-server/            servidor MCP
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── eslint.config.js
```

`contracts` é folha. `api`, `web` e `mcp-server` dependem dele e nunca um do outro — o
`mcp-server` fala com a `api` por HTTP, não por import.

### 11.1. `packages/contracts`

```
src/
├── primitives/
│   ├── merchant-ref.ts        MerchantRef (branded)
│   ├── eligibility.ts         EligibilityPair { tcd0, tcd1 }
│   ├── track.ts               Track = 'TCD0' | 'TCD1'
│   └── models.ts              FraudModel e CreditModel (branded, separados)
├── decision/
│   ├── raw-payload.ts         o que produção emite
│   └── decision-record.ts     o modelo derivado
├── queries/                   entrada e saída de cada use case
├── agent/tools.ts             schemas das tools
└── index.ts
```

`raw-payload` e `decision-record` são **separados de propósito** — a ACL é a única coisa
autorizada a converter um no outro.

### 11.2. `apps/api`

```
src/
├── domain/                     ← puro. Sem Nest, sem Sequelize, sem I/O.
│   ├── decision/               entidade, eligibility (AND, monotonicidade), gate
│   ├── rules/                  rule-engine, scenario
│   └── errors/
├── application/                ← use cases. Orquestram, não conhecem SQL.
│   ├── ports/                  interfaces implementadas pela infra
│   ├── funnel/ overview/ merchant/ inconsistency/
│   ├── volatility/ exception/ simulation/ explain/
├── infrastructure/
│   ├── persistence/
│   │   ├── models/             Sequelize
│   │   ├── acl/                decision.mapper · gate.mapper · merchant-ref
│   │   │                       merchant-index · integrity
│   │   ├── queries/            SQL analítico, um arquivo por use case
│   │   └── repositories/
│   ├── llm/providers/          anthropic.ts
│   └── config/
├── agent/                      ← só wrappers. Sem banco, sem SQL, sem PII.
│   ├── tools/
│   ├── pii/                    tokenizer · detector
│   └── prompts/
└── http/                       controllers · pipes · filters

migrations/                     SQL bruto: GIN, matviews
seeds/generator/                gerador sintético
test/fixtures/real-payloads.ts  os 6 exemplos do time
```

### 11.3. Regra de dependência — reforçada por lint

```
   http ─┐
         ├─→ application ──→ domain
  agent ─┘         ↑
                   │ implementa as ports
           infrastructure

   contracts ← todos (folha)
```

Três proibições que `eslint-plugin-boundaries` transforma em erro de build:

1. `domain/` não importa Nest, Sequelize, `pg`, nem `infrastructure/`
2. `application/` não importa `infrastructure/` — só as `ports/`
3. `agent/` não importa `infrastructure/` nem `domain/` — só use cases

**A terceira sustenta o princípio 10.1:** se o agente não alcança o repositório, não tem
como inventar consulta. Convenção documentada apodrece; lint não.

### 11.4. Onde o SQL mora

`infrastructure/persistence/queries/` — um arquivo por use case, executado com
`sequelize.query()` + `replacements`. Nunca concatenação de string.

Os models do Sequelize cobrem escrita, migrations e leitura transacional. As agregações
(window functions, JSONB, matviews) são SQL escrito à mão, porque o query builder produz
código pior.

### 11.5. `apps/web`

```
src/
├── app/                        router · providers · layout
├── features/                   ← por domínio, não por tipo
│   ├── overview/               nível 1 — funil + matriz
│   ├── inconsistency/          P5
│   ├── volatility/             P6
│   ├── exception/              P1, P2, P3
│   ├── merchant/               busca e linha do tempo
│   ├── simulation/             P4
│   └── agent/                  chat, generative UI
├── components/
│   ├── ui/                     Button, Chip, Badge, Card
│   └── viz/                    Funnel, StageBar, Meter, EmphasisBar
├── lib/                        api-client · format · labels
└── styles/tokens.css
```

`components/viz/` não usa biblioteca de gráfico: o protótipo validado é **HTML e CSS puro**.

## 12. Stack e pacotes

| Camada | Ferramenta |
|--------|-----------|
| Runtime | Node.js |
| API | NestJS |
| ORM | Sequelize |
| Contratos | Zod |
| Front | React + **Tailwind v4** (+ Vite) |
| Banco | PostgreSQL (JSONB) |
| LLM | **Anthropic** via Vercel AI SDK |

**Sequelize e as agregações.** O ORM cobre modelos, migrations e acesso transacional. As
consultas analíticas são SQL parametrizado. Não é contornar o ORM — é usá-lo para o que
resolve e deixar o Postgres agregar.

**Sequelize e Zod não competem.** Um modela a linha persistida, o outro o contrato de
fronteira. A ACL é onde um vira o outro.

### 12.1. Pacotes por fase

**Raiz — Fase 0:** `typescript` · `turbo` · `eslint` + `typescript-eslint` ·
**`eslint-plugin-boundaries`** · `prettier` · `husky` + `lint-staged` (opcional)

**`contracts`:** `zod`

**`api` Fase 0:** `@nestjs/common` `@nestjs/core` `@nestjs/platform-express` ·
`reflect-metadata` `rxjs` · `@nestjs/config` · `sequelize` `sequelize-typescript`
`@nestjs/sequelize` · `pg` `pg-hstore` · `sequelize-cli` · `date-fns` · `vitest` ·
`@faker-js/faker`

**`api` Fases 1–2:** `nestjs-pino` `pino` · `helmet` · `@nestjs/throttler` · `supertest` ·
`@testcontainers/postgresql` (opcional)

**`api` Fase 3:** `ai` · `@ai-sdk/anthropic`

**`api` Fase 5:** `@opentelemetry/sdk-node`

**`mcp-server` Fase 3:** `@modelcontextprotocol/sdk` · `zod`

**`web` Fase 1:** `react` `react-dom` · `vite` `@vitejs/plugin-react` · `tailwindcss` (v4) ·
`react-router` · `@tanstack/react-query` · `lucide-react` · `vitest`
`@testing-library/react` · `@playwright/test`

**`web` Fase 3:** `@ai-sdk/react`

**`web` Fase 4:** `react-hook-form` + `@hookform/resolvers`

### 12.2. O que deliberadamente não entra

| Descartado | Por quê |
|-----------|---------|
| Prisma, TypeORM | O time usa Sequelize |
| LangChain.js | Abstrações competem com o container do Nest |
| Redux, Zustand | React Query cobre estado de servidor |
| Recharts, Nivo, visx | O protótipo validado não usa nenhuma |
| Storybook | Custo alto para o escopo |
| `class-validator` | Zod já é a fronteira |
| Lovable | Descartado — React escrito à mão |
| AWS Bedrock | Descartado — Anthropic direto |

---

# Parte IV — Camada de IA

## 13. Agentes — e onde não usar agente

| Peça | É agente? | Por quê |
|------|-----------|---------|
| **Analista** (chatbot) | **Sim** | Escolhe entre 9 tools, encadeia chamadas, decide quando parar |
| **Copiloto de Concessão** | **Sim** | Outro prompt, outras tools, outra política |
| **Narrador** (resumo) | **Não** | Uma chamada com saída estruturada sobre deltas já calculados |
| **Detector de anomalia** | **Não** | Estatística determinística; o LLM prioriza e redige |

Chamar o narrador de agente seria inflação de vocabulário.

**Multiagente com fan-out** foi considerado e descartado: adiciona falha parcial e custo sem
ganho de tempo perceptível no volume atual.

| | Analista | Copiloto |
|---|---|---|
| Usuário | Product Owner | Analista de risco |
| Escopo | Agregados | Um cliente por vez |
| Tools | 9, **todas leitura** | 4 leitura + 1 escrita |
| Guardrail crítico | não inventar número | não decidir sozinho |
| Fase | 3 | 6 |

## 14. As tools

```
getModelOverview(period, segment?)            panorama dimensão × modelo
getFunnel(track, period, unit, segment?)      composição do funil
getEligibilityHistory(merchantRef, period?)   tudo sobre UM cliente no período
getInconsistencyReport(period, groupBy?)      anomalia {tcd0:1, tcd1:0} e origem
getVolatilityReport(period, groupBy?)         flips, decompostos por causa
getExceptionCounterfactual(period, segment?)  pré-pós das janelas encerradas
getExceptionAudit(period)                     vigência declarada × comportamento
explainDecision(merchantRef, consultedAt?)    por que ESTA decisão saiu assim
compareCohorts(cohortA, cohortB)              perfil e outcome comparados
```

Quatro regras de desenho que importam mais que a lista:

**a) Nenhuma tool aceita expressão livre.** Não existe parâmetro `sql`, `filter` ou `query`.
O agente escolhe *qual* tool e *quais valores*, nunca *como consultar*.

**b) `unit` é obrigatório** onde se conta cliente — mitigação da armadilha da §5.7.

**c) Nenhuma tool recebe ou devolve `id`.** Os demais atributos do input podem circular;
`faturamento` vai em faixa.

**d) Toda tool devolve dado + como renderizar:**

```jsonc
{
  "data":  { /* números */ },
  "render": { "component": "FunnelChart", "props": { "track": "TCD0" } },
  "basis": { "unit": "clientes", "n": 118700, "coverage": 1.0 }
}
```

O `basis` viaja junto de propósito — é o que permite dizer *"57% das janelas encerradas"*
em vez de apresentar um recorte como se fosse o total.

### 14.1. Consulta por cliente sem entregar PII

**Caminho primário — resolução na interface.** Campo de busca fora do chat. O PO digita
CPF, CNPJ ou EC; a API resolve para `merchantRef`; a conversa recebe chip de contexto. O
identificador nunca esteve numa mensagem.

**Rede de segurança — proxy de tokenização.** Se digitar no chat:

```
"histórico do cliente 9189ARC9891 em julho"
        ↓  detecção + resolução (determinística, sem LLM)
"histórico do cliente [cliente#a3f9c2] em julho"   ← o modelo recebe isto
        ↓  agente chama getEligibilityHistory({ merchantRef })
        ↓  navegador re-hidrata só na exibição
"histórico do cliente 9189ARC9891 em julho: …"     ← o PO lê isto
```

- **A detecção não é trivial** — o `id` é alfanumérico, regex de CPF não pega
- **Não resolveu, não passa** — vira placeholder e o agente pede o campo de busca
- **Log e trace guardam o token**, nunca o identificador
- **`resolveMerchant` não é tool do agente** — se fosse, o argumento seria o CPF, que teria
  passado pelo modelo para chegar até ela

### 14.2. `getEligibilityHistory` — tudo sobre um cliente

As duas perguntas de exemplo do PO — *"histórico do cliente X no período Y"* e *"dispersão
de elegibilidade no período"* — são **a mesma feature**. Uma tool, `period` opcional.

| Bloco | Conteúdo |
|-------|----------|
| **Consultas** | `consultedAt`, `ec`, `exitGate`, modelos, as três duplas de elegibilidade |
| **Janelas de exceção** | vigências que cruzam o período, e se foram utilizadas |
| **Flips** | classificados por causa |
| **Estados anômalos** | consultas em `{tcd0:1, tcd1:0}` |
| **Contrafactual** | se alguma janela encerrou, decisão antes e depois |
| **Resumo** | total, distribuição entre os quatro estados, primeira e última decisão |

A distribuição entre os estados **daquele cliente** é o que responde a dispersão. Renderiza
como faixa temporal — consulta é marca, vigência é bloco sombreado, flip é transição.

É onde o contrafactual **deixa de ser estatística e vira caso concreto**.

## 15. Generative UI

O AI SDK entrega os `toolResults` junto do stream. O front mantém um mapa
`component → React` e renderiza **enquanto o texto ainda chega**. O gráfico aparece antes da
frase terminar — e é o **mesmo componente** que o painel usa.

## 16. MCP

### 16.1. Onde não entra

Usar MCP como transporte entre o agente do NestJS e os próprios use cases seria um salto de
protocolo dentro de um único processo. **O agente do painel chama use case direto.**

### 16.2. Onde entra

O valor é **interoperabilidade**:

| Cliente | Uso |
|---------|-----|
| Chatbot do painel | in-process — não precisa de MCP |
| **Claude Code / Desktop** | investigar sem abrir o dashboard |
| **Outros agentes internos** | consumir elegibilidade sem integrar na mão |
| **Copiloto de Concessão** | pode viver fora do painel |

O servidor MCP é **cliente HTTP da API** — não importa a camada de aplicação. Mantém a
regra de que apps não dependem uns dos outros e garante que a API segue sendo o único lugar
onde a regra existe.

### 16.3. As três primitivas — usar todas

**Tools** — os nove use cases, mesmos schemas Zod.

**Resources** — contexto lido sem gastar tool call:

| Resource | Conteúdo |
|----------|----------|
| `tc://produto` | o que é o produto, TCD0 × TCD1, monotonicidade |
| `tc://dicionario` | cada campo, incluindo o `modelo*` polimórfico |
| `tc://glossario` | STAR, Penhora, Exceção, flip intra-regime |

Sem isso o agente traduz "TCD1" como jargão ou inventa o significado.

**Prompts** — perguntas douradas reutilizáveis:

```
/panorama-mensal        composição por gate + matriz de modelos
/investigar-drift       um modelo caiu — decompõe e compara períodos
/auditar-excecao        pré-pós + vigência declarada × aplicada
/anomalia-trilhos       volume e origem de {tcd0:1, tcd1:0}
/historico-cliente      tudo sobre um cliente já resolvido
```

O mesmo conjunto alimenta os evals e os botões de sugestão. Escrito uma vez.

> **A resolução de identificador não é exposta por MCP por padrão** — um cliente fora do
> painel receberia o CPF digitado. Habilitar é decisão de autorização explícita.

### 16.4. MCP de desenvolvimento — outra coisa

Filesystem MCP e Postgres MCP aceleram a escrita do código. São ferramentas **de
construção**, ficam na configuração local e não vão para o repositório da aplicação. Vale a
distinção porque *"usamos MCP"* pode significar duas coisas — e as duas são verdade aqui.

## 17. Guardrails

| Guardrail | Como |
|-----------|------|
| **Allowlist por agente** | A tool de escrita não está no registro do Analista — é ausência, não bloqueio |
| **Sem expressão livre** | Nenhum parâmetro aceita SQL, filtro ou código |
| **Argumentos validados** | Zod na entrada; erro volta legível para o modelo corrigir, nunca como 500 |
| **Limite de passos** | `maxSteps` fecha o loop; excedeu, responde o que tem e diz que parou |
| **Timeout por tool** | Consulta lenta não trava o stream |
| **Filtro de PII na saída** | Rede de segurança. Se disparar, é bug de ACL |
| **Escrita human-in-the-loop** | Nenhuma tool concede exceção — decisão automatizada sobre crédito tem implicação regulatória |

## 18. Evals

Eval de texto não serve. Três checagens objetivas:

**1. Seleção de tool.** Dada a pergunta, chamou a tool certa com os argumentos certos?

**2. Fidelidade numérica — a que mais importa.** Todo número na resposta precisa aparecer
em algum `toolResult` daquela conversa. Verificável por regex.

> É a tradução executável do princípio 10.1. Deixa de ser promessa de arquitetura e passa a
> quebrar o build.

**3. Ressalva presente.** Resposta que usa recorte com cobertura parcial precisa mencioná-la.
Verificável contra o campo `basis`.

## 19. Copiloto de Concessão (Fase 6)

Toda a camada acima **analisa** o que já aconteceu. O gargalo real é outro: a Exceção é
concedida por análise humana, a partir de pedidos por e-mail ou Teams, sem critério
registrado.

**O que faz.** Monta dossiê chamando os mesmos use cases: o que os modelos dizem hoje,
histórico de flips, se já teve exceção e qual o desfecho, como terminaram clientes
semelhantes. O analista recebe evidência e recomendação; **decide**; a decisão é registrada
de forma estruturada.

**O que não faz.** Não concede. Decisão automatizada sobre acesso a crédito tem implicação
regulatória, incluindo o direito à revisão na LGPD. Nenhuma tool escreve na vigência.

**A triagem que se paga.** Para o quadrante *Aprovado → Aprovado*, a solicitação pode ser
respondida **sem consumir análise humana** — não é a IA decidindo risco, é a IA informando
que a pergunta era desnecessária.

**Efeito de segunda ordem.** Cada decisão registrada é dado que hoje não existe. O motivo
sai do texto livre e vira variável. **O copiloto produz a instrumentação que falta.**

---

# Parte V — Interface

## 20. Arquitetura de informação — três níveis

A ordem de leitura segue o **volume**, não o interesse analítico. A maior parte da base é
decidida no gate 4; Exceção, STAR e Penhora são caminhos de borda. Abrir pela Exceção faria
uma borda parecer o produto.

| Nível | Conteúdo | Pergunta do PO |
|-------|----------|----------------|
| **1 · Panorama** | Composição por gate + matriz dimensão × modelo | "Como a base está sendo decidida?" |
| **2 · Detalhe** | Por modelo: drift, inconsistência, volatilidade | "O que mudou, e onde?" |
| **3 · Caminhos especiais** | Exceção, STAR, Penhora | "E os casos que fogem?" |

**O agente é o mecanismo de descida.** O panorama é a única tela fixa; a passagem para os
níveis 2 e 3 acontece por pergunta, não por vinte telas de drill-down. Isso resolve
estruturalmente o problema do chatbot órfão, em vez de mitigar.

Para a apresentação, também é melhor dramaturgia: base → detalhe → anomalia. Chega-se à
Exceção tendo estabelecido a proporção.

## 21. Os painéis

### 21.1. Funil de elegibilidade

Começa com todos os clientes e estreita a cada portão, com cada saída nomeada pela causa e
pelo destino:

```
118.700  todos os clientes
  G1 → Fluxo de Exceção        12.400  → ELEGÍVEL   ← destacado
106.300
  G2 → Prevenção STAR           6.900  → inelegível
 99.400
  G3 → Penhora e Fumaça         4.200  → inelegível
 95.200  chegam aos modelos
  G4 → Reprovado em crédito    14.200  → inelegível
       Reprovado em fraude      5.900  → inelegível
       Reprovado nos dois       3.700  → inelegível
 71.400  aprovados
```

Fecha em dois desfechos. A saída do G1 tem tratamento próprio por ser **a única que aprova
em vez de reprovar**.

### 21.2. Panorama por modelo (nível 1)

**A armadilha:** ranquear M1, M2 e M3 por taxa de aprovação convida a *"M3 aprova mais,
logo é melhor"*. São populações diferentes.

**A estrutura que impede:** matriz **dimensão × modelo**, não lista de três — porque fraude
e crédito usam os mesmos rótulos para modelos distintos.

```
                    M1                M2                M3
  Fraude        volume · share    volume · share         —
                taxa por trilho   taxa por trilho
                tendência 30d     tendência 30d

  Crédito       volume · share    volume · share    volume · share
                taxa por trilho   taxa por trilho   taxa por trilho
                tendência 30d     tendência 30d     tendência 30d
```

Cada célula declara a **população antes da taxa**. A tendência é a comparação que vale:
**do mesmo modelo ao longo do tempo**.

### 21.3. Sankey por trilho

Sankey representa mal paralelismo, e o gate 4 é isso. Um por trilho, com o gate 4
decomposto por causa — revela **qual modelo é o gargalo dominante**.

### 21.4. Matriz TCD0 × TCD1

|              | TCD1 = 1 | TCD1 = 0 |
|--------------|----------|----------|
| **TCD0 = 1** | ambos    | ⚠ **anômalo** |
| **TCD0 = 0** | só dia seguinte — *caso comum* | nenhum |

### 21.5. Painel de Inconsistência (P5)

Volume e taxa de violações com evolução temporal, distribuição por origem (`FRAUD` /
`CREDIT` / `BOTH`), concentração por modelo e segmento, e lista drill-down exportável.

> **Atenção ao sentido:** `{tcd0:0, tcd1:1}` é o caso comum e legítimo. Inverter o
> predicado faria o painel apontar para a população normal.

### 21.6. Painel de Volatilidade (P6)

```
Elegíveis em ao menos uma consulta:   68.400   (ANY_ELIGIBLE)
Elegíveis em todas as consultas:      52.100   (ALWAYS_ELIGIBLE)
──────────────────────────────────────────────
Clientes com resposta inconsistente:  16.300   (24% dos elegíveis)

Taxa de flip           18,4%
  ├─ janela de exceção  11,2 pp   esperado
  ├─ mudança de modelo   4,1 pp   esperado
  ├─ mudança de gate     1,9 pp   esperado
  └─ intra-regime        1,2 pp   ⚠ investigar
      dos quais oscilação 0,4 pp  ⚠⚠
```

**O Sankey não representa volatilidade e não deve tentar** — um cliente que muda de decisão
ocuparia dois nós terminais; somar infla, escolher esconde.

### 21.7. Painel da Exceção — pré-pós (P2)

Os quatro quadrantes da §9, com cobertura declarada.

### 21.8. Painel What-If (P4)

Controles para ligar/desligar e parametrizar regras, com recorte por segmento. Estado atual
versus simulado lado a lado.

### 21.9. Auditoria do motor

Com dados sintéticos não é possível provar fidelidade contra produção. O que se entrega é o
**mecanismo**, validado pelas divergências plantadas: `ValidateEngine` compara decisão
gravada × recalculada, e a UI exibe `Fidelidade do simulador: 99,2%`.

> *"O simulador não pede fé — ele se audita."*

## 22. Design

### 22.1. Paleta

> Valores **lidos visualmente de capturas do site**, não extraídos do CSS. O ambiente
> bloqueia `cielo.com.br` por política de rede. A troca está isolada em `tokens.css`.

| Papel | Hex | Onde |
|-------|-----|------|
| `blue` | `#0a6aea` | Botões, links, hero |
| `cyan` | `#00aeef` | Anéis, ícones de linha |
| `navy` | `#12263f` | Todos os títulos |
| `lime` | `#c8d400` | Faixas de destaque |

Validado por script:

```
#0b5fd5 ↔ #00aeef    CVD ΔE 19.7 (deutan) · normal 21.2    PASS
```

Duas cores frias que passam com folga — servem para Fraude × Crédito sem muleta.

**Regra que evita o problema de daltonismo:** preenchimentos grandes usam **uma cor só**;
as semânticas aparecem apenas em **marcas pequenas com rótulo**. Verde e cinza em blocos
grandes falham para deuteranopia (ΔE 5.5 medido).

Duas cores da marca ficam abaixo de 3:1 sobre branco — ciano (2.53) e lime (1.63). Mudam de
papel: ciano só em preenchimento com rótulo ao lado; lime só como faixa com texto navy por
cima, que é como o próprio site usa.

### 22.2. Tipografia

Sans geométrica humanista de terminais arredondados. Sem o nome confirmado, pilha de
sistema como substituta.

**A assinatura: peso misto na mesma linha.** O padrão mais característico do site não é a
fonte, é como ela é usada — trechos em peso alto alternando com regular dentro da mesma
headline. Reproduzível com qualquer face.

| Nível | Tamanho | Peso |
|-------|---------|------|
| Display | `clamp(30px, 4.4vw, 46px)` | 700 |
| H2 | `clamp(21px, 2.6vw, 30px)` | 700 |
| H3 | 17px | 600 |
| Corpo | 16px | 400 |

### 22.3. Forma

Adotar a marca significou reescrever a linguagem de forma, não só trocar hex: o protótipo
anterior era instrumento de precisão — cantos vivos, denso, sem sombra — e a Cielo é o
oposto.

```
sm: 8px       inputs, chips
md: 12px      células de dado
lg: 16px      cartões
full: 9999px  botões
sombra: 0 2px 14px rgba(18,38,63,.07)
```

### 22.4. Tailwind v4

Tokens em `docs/design/tokens.css`, formato CSS-first. Não existe `tailwind.config.js`.

Usa **`@theme inline`**, não `@theme`: sem `inline` o Tailwind resolve o valor em build e as
utilities carregam o hex fixo, o que faria o tema parar de trocar em runtime.

O tema troca por custom property em `:root`, cobrindo preferência do sistema e alternador do
usuário, com o alternador vencendo nos dois sentidos.

---

# Parte VI — Execução

## 23. O gerador sintético é o roteiro da demo

Com massa sintética, o gerador é peça central. Dataset uniforme produz apresentação sem
clímax. Precisa produzir:

- **Múltiplas consultas por cliente**, cauda longa — sem isso a §5.7 não tem o que medir
- **Flips de decisão**, incluindo entradas e saídas de janela
- **Distribuições realistas**, respeitando a invariante `ec` nulo → `M1`
- **As duas subpopulações de `ec` nulo**, com perfis distintos
- **Decisão sombra para a Exceção**, oculta do payload
- **Outcome correlacionado** com o perfil
- **Anomalias plantadas** nas três origens, em ~5–8% da base
- **Seed determinístico** — a mesma massa em qualquer máquina

### 23.1. Cenários plantados

| Cenário | O que o PO descobre |
|---------|--------------------|
| Subgrupo da Exceção que inadimple 3× mais | A Exceção tem custo concentrado |
| Cliente que oscila no mesmo dia | O produto responde de forma instável |
| Funil muito diferente por consulta vs. cliente | A métrica errada conta história errada |
| Anomalia crescendo, originada num modelo | O painel aponta o responsável |
| Vigentes inativos escondidos entre "novos" | O ponto cego de segmentação tem custo |
| Divergências entre gravado e recalculado | O `ValidateEngine` acha regra não documentada |

## 24. Fases

### Fase 0 — Fundação
Monorepo, lint, CI · ACL de tradução testada contra os 6 payloads reais · gerador sintético
· `packages/contracts`

**Pronto quando:** `pnpm dev` sobe tudo e o banco tem massa reproduzível.

### Fase 1 — Panorama (nível 1)
Repositories JSONB, índices GIN, matviews · `GetModelOverview` · `GetFunnel` · Sankey +
matriz

**Pronto quando:** o PO responde "como a base está sendo decidida" e **P1**.

### Fase 2 — Detalhe dos cenários (nível 2)
`GetInconsistencyReport` · `GetVolatilityReport` · drift por modelo

**Pronto quando:** o PO responde **P5** e **P6**.

### Fase 3 — Agente como navegação
`LlmProvider` · agente com as tools · narrativa automática · chat com streaming e
generative UI · servidor MCP

**Pronto quando:** uma pergunta desce do panorama ao detalhe com o gráfico correto.

*Entra aqui, e não depois, porque a partir de dois níveis o agente substitui telas de
drill-down em vez de decorá-las.*

### Fase 4 — Caminhos especiais (nível 3)
Motor de regras · `GetExceptionCounterfactual` · auditoria de vigência ·
`SimulateScenario` · `ValidateEngine` · What-If

**Pronto quando:** o PO responde **P2**, **P3** e **P4**.

> **Trade-off assumido.** Esta fase concentra o resultado mais forte e agora vem depois do
> agente. Se o tempo apertar, é ela que precisa ser protegida.

### Fase 5 — Maturidade
Evals em CI · tracing · guardrails · performance · roteiro de demo

### Fase 6 — Copiloto de Concessão *(opcional, alto impacto)*
Dossiê · triagem automática · registro estruturado

## 25. Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Unidade de análise por consulta | **Crítico** — descreveria tráfego, não a base | Métrica dupla, `unit` obrigatório |
| Não existe outcome financeiro | **Crítico** — P3 sem resposta | Proxy de expulsão pós-expiração |
| Predicado da anomalia invertido | **Crítico** — apontaria para a população normal | Sentido documentado, teste contra os payloads reais |
| `ec` nulo lido como "cliente novo" | Alto | Resolvido pela `dataFiliacao` |
| Mistura de `M1` fraude/crédito | Alto | Branded types — erro em compilação |
| Motor diverge do sistema real | Alto | `ValidateEngine` + indicador de fidelidade |
| Agente alucina números | Alto | Princípio 10.1 + eval de fidelidade + guardrails |
| PII para o LLM | Alto | `merchantRef` + proxy de tokenização |
| Comparação entre modelos lida como performance | Médio | Estratificação (§5.5c) + aviso |
| Agregação lenta | Médio | Postgres, GIN, matviews |

## 26. Decisões

### Fechadas

| Tema | Decisão |
|------|---------|
| Provider LLM | **Anthropic direto** — Bedrock descartado |
| Front | **React + Tailwind v4** — Lovable descartado |
| Dados | Sintéticos, com adapter para trocar por reais |
| Repositório | Monorepo, quatro pacotes |
| Unidade de análise | Estabelecimento `(merchantRef, ec)` |
| ORM | Sequelize + SQL parametrizado para agregações |
| Agente | Vercel AI SDK — LangChain descartado |
| Bibliotecas de gráfico | Nenhuma na Fase 1 |

### Em aberto

1. **Existe outcome financeiro?** Decide se P3 vai além do proxy
2. **Campos da tabela de vigência**, e se solicitações negadas são registradas — sem as
   negadas há viés de sobrevivência e o Copiloto perde metade do valor
3. **Hex oficiais da marca** e nome da família tipográfica
4. Vitest ou Jest · Express ou Fastify · `sequelize-cli` ou `umzug` · Turborepo · Husky

---

## 27. Correções ao longo da definição

Registro do que mudou, porque a evolução do entendimento é parte do resultado.

| O que eu tinha | O que é | Como apareceu |
|----------------|---------|---------------|
| Exceção como **resgate a jusante** dos reprovados | É o **primeiro portão**, um atalho a montante | Descrição da sequência real dos gates |
| Faltava `exitGate` no payload | Já existe, codificado no campo `modelo*` polimórfico | Os seis payloads de exemplo |
| `ec` serviria como identificador não-PII | Pode ser nulo — daí o `merchantRef` | Exemplos com `ec: null` |
| `M1` = fraude, `M2`/`M3` = crédito | Existem nas duas dimensões, espaços distintos | Exemplos com `modeloCredito: "M1"` |
| **TCD1** era o trilho mais restritivo | **TCD0** é o mais restritivo | Correção direta do time |
| `inconsistencySource` incluía `COMBINATION` | Valor inalcançável — a anomalia é sempre herdada | Prova derivada do AND por trilho |
| Contrafactual por **matching estatístico** | **Medição direta** pelo pré-pós | Exceção ter vigência curta |
| `getEligibilityDispersion` como tool separada | Dispersão e histórico são a mesma feature | Esclarecimento do pedido |
| Layout genérico de dashboard | Linguagem de forma da Cielo | Crítica direta ao protótipo |
| Shadow validation contra produção | Auditoria de mecanismo com divergências plantadas | Escolha por dados sintéticos |

Três coisas nunca mudaram, e são as que sustentam a entrega: **o LLM nunca calcula um
número**, **uma regra de negócio com um só lugar de implementação**, e **nenhum
identificador de pessoa chega ao modelo**.
