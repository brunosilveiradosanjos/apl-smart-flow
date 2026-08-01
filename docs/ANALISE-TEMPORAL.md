# Análise Temporal: Granularidade, Flip e a Janela de Exceção

> Aprofundamento dos temas de unidade de análise e volatilidade de decisão.
> Complementa `PLANO-ENTREGA.md`, que permanece o documento principal.

Três fatos do domínio sustentam tudo o que segue:

1. O campo de consulta é **datetime** — há ordenação intradiária
2. Um cliente pode ser consultado **um número indefinido de vezes por dia**
3. O Fluxo de Exceção tem **data de início e fim, geralmente curta**

O terceiro fato é o mais consequente, e é o que transforma a entrega.

---

## 1. A Exceção é uma janela, não um estado

O plano original tratava a Exceção como atributo do cliente: *"este cliente está no fluxo
de exceção"*. Com vigência delimitada e curta, a modelagem correta é outra:

> Este cliente **esteve** na Exceção entre `t₁` e `t₂`.

A consequência é direta e vale mais que qualquer painel: se a janela é curta e as
consultas são frequentes, o mesmo cliente é avaliado pelos modelos **fora** da janela. A
decisão que a Exceção suprimiu não é inobservável — ela existe em outra linha da tabela.

```
Linha do tempo de um cliente (cada marca é uma consulta)

  RISK    RISK   │ EXCEPTION  EXCEPTION  EXCEPTION │   RISK      RISK
  {0,0}   {0,0}  │  {1,1}      {1,1}      {1,1}    │  {0,0}     {1,0}
 ───────────────┼──────────────────────────────────┼──────────────────►
      antes      │        janela de exceção         │      depois
   (contrafactual observado)                        (contrafactual observado)
```

O que eu havia proposto como estimativa por coorte comparável, ou como recomendação de
*shadow run* em produção, passa a ser **medição direta sobre o dado que já existe**.

### 1.1. Reconstrução das janelas

As janelas são recuperáveis das próprias consultas por *gaps and islands*: ordenar por
`(merchantRef, consultedAt)`, marcar `exitGate = EXCEPTION`, e agrupar sequências
contíguas usando a diferença entre dois `row_number()`. Cada ilha é uma janela observada;
as consultas de borda dão o "antes" e o "depois".

É trabalho que o Postgres faz nativamente com window functions, o que reforça a decisão de
agregar no banco em vez de no Node.

**Ressalva de cobertura:** a reconstrução só enxerga o que foi consultado. Um cliente com
poucas consultas pode ter a janela inteira invisível, ou não ter borda de um dos lados.
Toda métrica derivada carrega, portanto, um indicador de cobertura:

```
População com passagem por Exceção no período:        12.400
  com decisão de modelo observável antes:              8.900  (72%)
  com decisão de modelo observável depois:             9.600  (77%)
  com ambas (elegíveis ao desenho pré-pós):            7.100  (57%)
```

Sem esse indicador, o resultado seria apresentado como se valesse para toda a população —
e não vale.

---

## 2. O desenho pré-pós: testando a tese da Exceção

Com decisão de modelo antes e depois da janela, o cliente **é seu próprio controle**. Não
há viés de seleção: não se está comparando quem entrou na Exceção com quem não entrou, e
sim o mesmo cliente em dois regimes.

A tabela resultante responde a pergunta que justifica o produto:

```
Clientes com janela de exceção encerrada e decisão de modelo dos dois lados (n=7.100)

  Reprovado antes  →  Reprovado depois      62%    a Exceção foi um furo temporário
  Reprovado antes  →  Aprovado depois       23%    a Exceção funcionou como rampa
  Aprovado antes   →  Aprovado depois       12%    a Exceção era desnecessária
  Aprovado antes   →  Reprovado depois       3%    o cliente piorou durante a janela
```

Cada quadrante é acionável, e por motivos diferentes:

| Quadrante | Leitura | Ação possível |
|-----------|---------|---------------|
| **Reprovado → Reprovado** | O cliente entrou no produto sem nunca ser aprovável. A Exceção não mudou o risco, só o adiou. | Maior alvo de restrição de escopo |
| **Reprovado → Aprovado** | A Exceção deu tempo para o cliente construir histórico. **É a tese do produto, e ela se sustenta.** | Justificativa para manter — e para dimensionar melhor a janela |
| **Aprovado → Aprovado** | O cliente passaria pelos modelos de qualquer forma. A Exceção não fez nada. | **Ganho puro:** desligar a Exceção aqui não muda decisão nenhuma |
| **Aprovado → Reprovado** | Deterioração durante a janela. Pequeno, mas é a coorte de maior risco. | Investigar individualmente |

O quadrante *Aprovado → Aprovado* é o mais imediatamente útil: é volume que pode sair da
Exceção **sem nenhum impacto sobre a base**, reduzindo a exposição do mecanismo sem custo
de negócio. É o tipo de recomendação que um PO leva para a diretoria.

E o quadrante *Reprovado → Aprovado* é o que impede a leitura ingênua de que a Exceção é
apenas um furo. Se ele for grande, a Exceção tem função real de produto e o dashboard
passa a informar como **calibrá-la**, não como desligá-la.

### 2.1. Taxa de expulsão — proxy de outcome disponível hoje

Enquanto não se confirma a existência de inadimplência ou fraude confirmada, o desenho
pré-pós entrega um substituto honesto:

> Dos clientes que entraram no produto pela Exceção, quantos **perderam elegibilidade
> assim que a janela expirou**?

É a coorte *Reprovado depois*, e mede o custo em experiência: o cliente entrou, usou o
produto e foi desligado. Não é custo financeiro — é custo de decisão e de relacionamento,
e está inteiramente disponível no dado atual.

Quando o outcome financeiro aparecer, ele encaixa como coluna adicional na mesma tabela,
sem redesenho.

---

## 3. Granularidade: a taxonomia completa

"Deduplicado versus duplicado" é uma simplificação. Existem unidades distintas, cada uma
respondendo a uma pergunta diferente.

| Unidade | Chave | Pergunta que responde |
|---------|-------|----------------------|
| **Consulta** | linha | Qual a carga operacional? (capacidade, custo, SLA) |
| **Cliente-período** | `merchantRef` | Como está a base? *(padrão do dashboard)* |
| **Cliente-dia** | `merchantRef, dia` | Como a base evolui no tempo, sem distorção de tráfego |
| **Cliente-regime** | `merchantRef, regime` | O que muda quando o contexto de avaliação muda |

Onde **regime** é a tripla `(exitGate, fraudModel, creditModel)` — o contexto que
caracteriza *como* aquela decisão foi tomada. É a unidade que torna a análise de flip
interpretável (§4).

### 3.1. Modo de agregação

Ao reduzir várias consultas a um cliente, é preciso escolher qual decisão representa. A
escolha não é técnica, é editorial — e muda o número:

| Modo | Definição | Uso |
|------|-----------|-----|
| `LAST` | Última consulta do período | **Padrão.** Estado corrente, sem ambiguidade |
| `FIRST` | Primeira consulta | Estado de entrada; primeira impressão do cliente |
| `ANY_ELIGIBLE` | Elegível em ao menos uma | Visão de acesso: "teve o produto disponível" |
| `ALWAYS_ELIGIBLE` | Elegível em todas | Visão conservadora: "teve acesso estável" |

### 3.2. O gap entre ANY e ALWAYS é a volatilidade

Esta é a formulação mais útil que encontrei para apresentar instabilidade a um PO. Não
como estatística abstrata, mas como população:

```
Elegíveis em ao menos uma consulta:   68.400   (ANY_ELIGIBLE)
Elegíveis em todas as consultas:      52.100   (ALWAYS_ELIGIBLE)
──────────────────────────────────────────────
Clientes com resposta inconsistente:  16.300   (24% dos elegíveis)
```

As duas métricas não são alternativas concorrentes: **a distância entre elas é o
diagnóstico**. Um PO entende "16.300 clientes receberam respostas diferentes" mais
rapidamente do que entende uma taxa de flip.

### 3.3. O Sankey não representa volatilidade — e não deve tentar

Um cliente que muda de decisão ocuparia dois nós terminais ao mesmo tempo. Não existe
solução visual honesta para isso dentro de um diagrama de fluxo: somar em ambos infla o
total, escolher um esconde o fenômeno.

Decisão: **o Sankey usa `LAST`**, exibe explicitamente a unidade e o modo em uso, e a
volatilidade tem painel próprio. Ferramenta certa para cada pergunta, em vez de uma
sobrecarregada.

### 3.4. Concentração de tráfego como alerta

O risco de contar por consulta é mensurável, e vale exibir:

```
1% dos clientes concentra 47% das consultas
Taxa de elegibilidade por consulta:          71,2%
Taxa de elegibilidade por cliente distinto:  58,4%
                                    desvio:  12,8 pp
```

Quando o desvio é grande, qualquer número por consulta está descrevendo o padrão de
integração de poucos clientes, não a base. O dashboard mostra o desvio em vez de escolher
silenciosamente por você.

---

## 4. Flip: taxonomia por causa

Uma taxa de flip agregada é um número enganoso. Boa parte dos flips é **esperada** — o
cliente entrou ou saiu de uma janela de exceção, ganhou EC, mudou de modelo. Apresentar
"30% de flip" sem decompor levaria o PO a investigar um problema que não existe, ou a
ignorar um que existe.

A decomposição por causa é o que torna o painel acionável:

| Tipo | Condição | Interpretação |
|------|----------|---------------|
| **Por janela de exceção** | `exitGate` entrou ou saiu de `EXCEPTION` | Esperado. É o mecanismo funcionando |
| **Por mudança de modelo** | `fraudModel` ou `creditModel` mudou | Esperado. O cliente maturou, ganhou EC, virou ativo |
| **Por mudança de gate** | Passou a cair em `STAR` ou `LIEN` | Esperado. Evento real no cliente |
| **Intra-regime** | Mesmo `exitGate`, mesmos modelos, decisão diferente | **Inexplicável pelo dado.** É aqui que mora o problema |

O flip **intra-regime** é o alvo. Mesmo gate, mesmo modelo, mesma janela — e resposta
diferente. As explicações possíveis são todas ruins: dado de entrada mudou sem que se
saiba qual, o modelo não é determinístico, ou há defeito. Qualquer uma delas é algo que o
PO precisa levar ao time responsável.

### 4.1. Dimensões complementares

**Direção.** Negativo→positivo é ganho de acesso; positivo→negativo é perda. O segundo
pesa mais na percepção do cliente e merece destaque separado.

**Trilho.** Flip só em TCD0, só em TCD1, ou em ambos. Combinado com a monotonicidade
esperada (`tcd1=1 → tcd0=1`), um flip que cria estado inconsistente conecta este painel ao
de inconsistência (P5).

**Padrão temporal.** A distinção mais diagnóstica:

- **Flip único** (A→B) — provável mudança real de estado do cliente
- **Oscilação** (A→B→A) — quase sempre patológico. Não é evolução, é ruído

Oscilação intra-regime é o indicador mais forte de defeito que este dashboard consegue
produzir. Merece contador dedicado e alerta.

### 4.2. Janela de observação

Flip só existe para clientes com duas ou mais consultas no período. Isso cria um viés: a
taxa de flip é calculada sobre a subpopulação mais consultada, que é justamente a mais
integrada. Toda métrica de flip declara sua base:

```
Clientes com ≥2 consultas no período:  41.200  (de 118.700 · 35%)
Taxa de flip nessa população:            18,4%
  ├─ por janela de exceção:              11,2 pp   esperado
  ├─ por mudança de modelo:               4,1 pp   esperado
  ├─ por mudança de gate:                 1,9 pp   esperado
  └─ intra-regime:                        1,2 pp   ⚠ investigar
      dos quais oscilação:                0,4 pp   ⚠⚠
```

Assim apresentado, o PO sabe onde olhar em cinco segundos.

---

## 5. Efeito de composição temporal

Se as janelas de exceção são curtas, a proporção de clientes em janela ativa varia ao
longo do tempo. Isso significa que **a taxa de elegibilidade global oscila por composição,
não por mudança de comportamento da base**.

Um pico de aprovação pode ser apenas uma safra de exceções concedidas na semana anterior.
Sem controlar por isso, o PO celebra ou se preocupa com o artefato errado.

Mitigação: toda série temporal de elegibilidade oferece a decomposição

```
taxa observada  =  taxa da população fora de exceção  +  contribuição da exceção ativa
```

e a detecção de anomalia (P6 / `DetectAnomalies`) opera sobre a série **fora de exceção**,
que é a que reflete comportamento real dos modelos.

---

## 6. Impacto no gerador sintético

Para que nada disso seja teatro, o gerador precisa produzir:

1. **Cauda longa de consultas por cliente** — poucos com centenas, muitos com uma só, de
   modo que o desvio entre as métricas por consulta e por cliente seja real
2. **Janelas de exceção com início e fim**, de duração curta e variável, com consultas
   antes, durante e depois
3. **Os quatro quadrantes do pré-pós** em proporções distintas e deliberadas — inclusive
   um bloco relevante de *Aprovado → Aprovado*, que é a recomendação de maior valor
4. **Cobertura incompleta**, com parte da população sem borda observável dos dois lados,
   para que o indicador de cobertura tenha o que reportar
5. **Flips das quatro causas**, com o intra-regime raro e concentrado num modelo
   específico — é o que o painel precisa encontrar
6. **Oscilações** em pequena quantidade, para o alerta disparar
7. **Concentração de tráfego** desigual, para o alerta da §3.4 ter substância

---

## 7. Consequências para o plano

| Item | Antes | Agora |
|------|-------|-------|
| **P2 (contrafactual)** | Estimativa por coorte comparável, com shadow run como evolução | **Medição direta** pelo desenho pré-pós, com cobertura declarada |
| **P3 (custo)** | Bloqueado sem outcome financeiro | Proxy disponível hoje: taxa de expulsão pós-expiração |
| **P6 (volatilidade)** | Taxa de flip agregada | Decomposta por causa; o alvo é o flip intra-regime |
| **Exceção** | Atributo do cliente | Janela temporal, com reconstrução por *gaps and islands* |
| **Sankey** | Contagem de clientes | `LAST` explícito, com unidade e modo visíveis |
| **Anomalia** | Sobre a série global | Sobre a série fora de exceção, controlando composição |

---

## 8. Dúvidas que este documento levanta

1. **Existe uma tabela de vigência da Exceção**, com início e fim explícitos e acessível
   para consulta? Se sim, as janelas deixam de ser inferidas e passam a ser fato — e a
   cobertura da §1.1 deixa de ser limitação. É a diferença entre um resultado bom e um
   resultado inatacável.
2. **Qual a duração típica da janela?** Define o horizonte da análise pré-pós: se a janela
   dura dias, o "depois" é rápido; se dura meses, boa parte das janelas ainda estará
   aberta no período analisado.
3. **Qual o critério de concessão da Exceção?** Campanha comercial, negociação individual,
   regra automática? Não bloqueia nada, mas muda completamente a leitura do quadrante
   *Aprovado → Aprovado*: se a concessão é manual, esse volume é esforço humano gasto sem
   efeito.
4. **A reavaliação após a expiração é automática ou depende de nova solicitação?** Muda a
   interpretação da taxa de expulsão: desligamento ativo do cliente, ou simplesmente
   ausência de nova consulta.
