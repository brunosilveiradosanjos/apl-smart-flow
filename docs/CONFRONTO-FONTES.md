# Confronto com os repositórios de origem

> Roteiro para confrontar a documentação deste projeto com o código que realmente produz e
> serve os dados de elegibilidade.
>
> **Repositórios de origem** (GitHub corporativo, fora do alcance desta sessão):
> - `aura_app_library-elegibilidade`
> - `aura_app_apl-api-produtos-elegibilidade`
> - `aura_app_apl-api-produtos-elegibilidade-tc`
>
> Toda a documentação foi construída a partir de conversa e de seis payloads de exemplo.
> Cada item abaixo é uma **afirmação nossa que o código pode confirmar ou derrubar** — e
> várias delas sustentam painéis inteiros.

Como usar: rodar o Claude Code local apontando para `C:\projects\aura\` com este
repositório clonado ao lado, ou verificar manualmente e trazer as respostas.

---

## 1. `library-elegibilidade` — a biblioteca compartilhada

Onde provavelmente moram os tipos e as regras. É o repositório de maior valor para o
confronto.

### 1.1. Os valores reais dos campos `modelo*`

**Nossa afirmação** (`CONSOLIDADO.md` §5.3): os campos são polimórficos e assumem
`EXCECAO`, `PREVENCAO`, `PENHORAEFUMACA`, `M1`, `M2`, `M3`.

**O que procurar:** enums, constantes ou union types desses campos.

**O que derrubaria:** qualquer valor adicional que não conhecemos. Um sétimo valor
significa um portão a mais no funil, ou um estado que o mapeamento de `exitGate` não
cobre — e o funil é a tela principal.

### 1.2. A regra de combinação

**Nossa afirmação:** `elegibilidade` é o **AND por trilho** de `elegibilidadeFraudes` e
`elegibilidadeCredito`.

**O que procurar:** a função que produz `elegibilidade` a partir das duas dimensões.

**O que derrubaria:** precedência entre dimensões, peso, ou qualquer regra que não seja AND
puro. Isso mudaria a prova da anomalia herdada (§7 do consolidado), que é a base do painel
de inconsistência.

### 1.3. A ordem dos portões

**Nossa afirmação:** Exceção → STAR → Penhora/Fumaça → avaliação de risco, com os três
primeiros terminais.

**O que procurar:** o orquestrador da avaliação — provavelmente uma cadeia de guards ou
um `switch`.

**O que derrubaria:** ordem diferente, ou algum portão que não encerra a decisão.

### 1.4. Existem reason codes?

**Nossa afirmação:** não existem — o `ExplainDecision` teria que se virar com gate e
modelo.

**O que procurar:** qualquer enum de motivo em STAR ou Penhora/Fumaça.

**Se existirem:** enriquece o `ExplainDecision` de forma significativa e vale entrar na
Fase 1, não depois.

### 1.5. Os tipos do payload

**O que procurar:** interface ou schema do objeto de resposta.

**Confrontar com:** `CONSOLIDADO.md` §5.1. Interessa especialmente se `ec` é declarado
nullable no tipo, e qual o tipo real de `id`.

---

## 2. `apl-api-produtos-elegibilidade` — a API genérica

### 2.1. A tabela de log

**Nossa afirmação** (§5.8): todas as solicitações são registradas com **input e output**.

**O que procurar:** o model Sequelize e a migration dessa tabela.

**O que preciso saber, em ordem de importância:**

| | Item | Por que importa |
|---|------|-----------------|
| 1 | **Nome real da tabela e das colunas** | Todo o SQL analítico é escrito contra elas |
| 2 | **Input e output são JSONB ou colunas planas?** | Define índices GIN versus B-tree, e reescreve as consultas |
| 3 | **Nome e tipo do campo de data** | `timestamp` ou `date` — se for `date`, a §5.7 e o painel de volatilidade encolhem |
| 4 | **Existe chave primária ou id de linha?** | Necessário para deduplicar e para o drill-down |
| 5 | **Há retenção ou particionamento?** | Define se "período" pode ser arbitrário ou tem teto |
| 6 | **Volume aproximado de linhas** | Decide se matview é opcional ou obrigatória |

### 2.2. Convenções do time

Nossa proposta de arquitetura (`ARQUITETURA.md`) foi desenhada do zero. **Se o time já tem
convenção, ela ganha** — e este documento vira o mapeamento, não a regra.

**O que procurar:**

- Estrutura de pastas dos módulos NestJS
- `sequelize-typescript` com decorators, ou Sequelize puro?
- Migrations com `sequelize-cli` ou outra ferramenta?
- Validação com Zod, `class-validator`, ou nenhuma?
- Padrão de repositório — existe camada, ou o service fala com o model direto?
- Como as consultas analíticas são feitas hoje, se existirem

### 2.3. Como a API é servida

**O que procurar:** se existe endpoint que já expõe consulta de elegibilidade.

**Por que importa:** se já existe, o painel pode consumir a API existente em vez de ler a
tabela direto — o que muda a camada de infraestrutura inteira e provavelmente é melhor.

---

## 3. `apl-api-produtos-elegibilidade-tc` — o específico do TC

### 3.1. A tabela de vigência da Exceção

**Nossa afirmação** (§6): existe, com início e fim consultáveis.

**O que procurar:** o model e a migration.

**O que preciso saber:**

| | Item | Por que importa |
|---|------|-----------------|
| 1 | **Colunas: solicitante, aprovador, motivo, canal?** | Cada uma destrava uma dimensão de análise do processo de concessão |
| 2 | **Solicitações negadas ficam registradas?** | Sem elas há viés de sobrevivência, e o Copiloto (Fase 6) perde metade do valor |
| 3 | **A chave é `id`, `ec`, ou o par?** | Define se a vigência vale para o titular ou para o estabelecimento |
| 4 | **Prazo pedido versus concedido são campos separados?** | Permite medir se a análise humana ajusta ou carimba |

### 3.2. Como o `ec` nulo é tratado

**Nossa afirmação** (§5.4): `ec` nulo significa "não resolvido na base ativa", porque o
cruzamento usa só clientes ativos.

**O que procurar:** o ponto onde o `ec` é resolvido, e o filtro de base ativa.

**O que derrubaria:** se o `ec` nulo tiver outra causa — erro de integração, timeout, ou
qualquer coisa que não seja estado de negócio. Isso mudaria a §5.5a, que é como
desambiguamos cliente novo de vigente inativo.

### 3.3. A invariante do M1

**Nossa afirmação:** sem `ec` resolvido e chegando ao gate 4, o cliente é sempre avaliado
por `M1` nas duas dimensões.

**O que procurar:** a lógica de seleção de modelo.

**Bônus grande:** se o critério de roteamento entre M1, M2 e M3 estiver no código, resolve
uma pendência sem precisar inferir dos dados (§5.5b).

### 3.4. Os campos de input

**Nossa afirmação** (§5.2): nove campos — id, ec, MCC, canal de filiação, segmento, CEP3,
tipo de pessoa, data de filiação, faturamento.

**O que procurar:** o DTO ou tipo da requisição.

**O que derrubaria:** campos a mais (mais variáveis explicativas — bom), ou campos que
existem no tipo mas chegam vazios na prática (pior, e só o dado real revela).

---

## 4. Perguntas que o código provavelmente não responde

Ficam para o time, independentemente do confronto:

1. **Existe outcome financeiro** — inadimplência, fraude confirmada, churn — em alguma
   base? Decide se **P3** vai além do proxy de expulsão
2. **A elegibilidade é recalculada automaticamente** quando a vigência da exceção expira,
   ou depende de nova consulta? Muda a interpretação da taxa de expulsão
3. **Qual o volume mensal de solicitações de exceção?** Decide se o Copiloto se paga

---

## 5. O que fazer com o resultado

Cada item confirmado vira nota de rodapé no documento correspondente. Cada item **derrubado**
vira correção — e a §27 do `CONSOLIDADO.md` já existe para registrar isso, porque a evolução
do entendimento é parte do resultado.

Prioridade, se o tempo for curto:

1. **Os valores reais dos campos `modelo*`** (§1.1) — um valor desconhecido reescreve o funil
2. **O schema da tabela de log** (§2.1) — todo o SQL depende dele
3. **A regra de combinação** (§1.2) — sustenta a prova da anomalia
4. **Se já existe endpoint de consulta** (§2.3) — pode mudar a camada de infraestrutura
5. **As colunas da tabela de vigência** (§3.1) — destrava a análise do processo de concessão
