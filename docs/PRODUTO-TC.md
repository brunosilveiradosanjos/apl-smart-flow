# O produto TC — "Vendeu, Tá na Conta"

> Contexto de negócio do produto cuja elegibilidade o painel analisa. Compilado do site
> da Cielo e de materiais fornecidos pelo time. Serve para os rótulos da interface, para
> o *system prompt* do agente e para qualquer texto que o painel exiba ao PO.

---

## 1. O que é

Antecipação automática e recorrente dos recebíveis de venda. Em vez de esperar o prazo
padrão, o lojista recebe **no mesmo dia** ou **no dia seguinte**, de forma contínua.

> *"O 'Vendeu, tá na conta' é um produto que antecipa os valores de suas vendas para o
> mesmo dia ou dia seguinte. Nessa modalidade, você pode ter fluxo de caixa contínuo e
> receber as suas vendas de forma recorrente, incluindo aos finais de semana e feriados."*

O ganho para o lojista é fluxo de caixa. O exemplo do próprio site:

> *"Maria realizou uma venda em sua loja de roupas, no valor de R$ 900,00 parcelada em 3x
> e teria que aguardar 30, 60 e 90 dias para receber o valor total. (…) ela possui a
> flexibilidade de receber este valor em até 1 dia útil realizando a antecipação de seus
> recebíveis com a Cielo."*

Vale para vendas em **débito, crédito à vista e parcelado**, e o recebimento acontece
**inclusive em finais de semana e feriados**.

## 2. As duas modalidades — o que TCD0 e TCD1 significam

Esta era uma pendência do plano, e as páginas do produto resolvem:

| Trilho | Modalidade no site | Promessa |
|--------|-------------------|----------|
| **TCD0** | *Vendeu, Tá na Conta* — **Hoje!** | "Receba suas vendas no mesmo dia" |
| **TCD1** | *Vendeu, Tá na Conta* — **Amanhã!** | "Receba suas vendas em 1 dia" |

São **modalidades comerciais distintas do mesmo produto**, não estágios de um funil. Um
cliente pode ser elegível a uma e não à outra — é exatamente por isso que a elegibilidade
é emitida em par.

**TCD1 é o trilho mais restritivo.** Isso decorre da regra de monotonicidade confirmada
pelo time (`tcd1 = 1` deveria implicar `tcd0 = 1`) e é consistente com todos os payloads
de exemplo, em que `{tcd0:1, tcd1:0}` aparece como caso comum e `{tcd0:0, tcd1:1}` nunca
aparece. Vale explicitar na interface: é contraintuitivo que "amanhã" seja mais difícil
que "hoje", e o PO pode se confundir se o painel não disser.

## 3. Condições operacionais

Restrições que aparecem em letra miúda no site e que ajudam a interpretar os dados:

- **TCD0** vale para transações realizadas **até 18h59**
- Recebimento em ambas as modalidades é **sujeito à análise de elegibilidade** — é
  literalmente o que este projeto mede
- **Prazos de recebimento menores exigem conta bancária vinculada a uma chave Pix.**
  Como TCD0 é o prazo menor, é plausível que carregue esse requisito adicional — a
  confirmar com o time, porque seria uma variável explicativa da elegibilidade que hoje
  não está no payload
- O lojista pode ter **mais de um domicílio bancário** e escolhe onde receber

## 4. Produto vizinho: Antecipação Avulsa

Não é o TC, mas divide o mesmo espaço e pode confundir na leitura dos dados:

> Antecipação **sob demanda** dos saldos de vendas já feitas no crédito à vista ou
> parcelado — o lojista escolhe quando antecipar, em vez de receber de forma recorrente.
> Solicitações aprovadas até 15h45 caem no mesmo dia. Também sujeita a análise de
> elegibilidade.

Diferença que importa: **TC é recorrente e automático; a Avulsa é pontual e solicitada.**
Se as bases de elegibilidade forem compartilhadas, é preciso separar as duas antes de
qualquer agregação.

## 5. Canais de contratação

Site Cielo, App Cielo Gestão, Gerente de Negócio ou telefone (11) 4002-5472.

Relevante para o projeto: a **concessão de exceção** não passa por nenhum desses canais —
ela é pedida por e-mail ou Teams e analisada manualmente, sem registro estruturado
(ver `PLANO-ENTREGA.md` §8.5).

## 6. Como isso alimenta o painel

| Uso | O que muda |
|-----|-----------|
| **Rótulos da UI** | "TCD0" vira *"Mesmo dia"* e "TCD1" vira *"Dia seguinte"* na superfície; o código mantém os nomes técnicos |
| **System prompt do agente** | O agente precisa deste contexto para traduzir resultado técnico em linguagem de negócio sem inventar |
| **Explicação de decisão** | "Inelegível para TCD1" é jargão; *"não pode receber no dia seguinte"* é resposta |
| **Segmentação** | Se o requisito de chave Pix se confirmar para TCD0, vira variável explicativa de primeira classe |
