# Jungle Gaming — Wagering API

API para processar operações de apostas de diferentes provedores. O projeto mantém o saldo da carteira, registra cada movimentação no ledger e usa PostgreSQL como fonte de verdade para idempotência e concorrência. O SQS recebe solicitações assíncronas e transporta os eventos publicados pela Outbox.

## Tecnologias

- Bun 1.x e TypeScript em modo estrito
- NestJS 12
- PostgreSQL 17 e MikroORM 7
- AWS SDK v3 e MiniStack (SQS)
- Docker Compose

## Requisitos

- Bun 1.x
- Node.js 24.15 ou superior para as ferramentas do NestJS e do MikroORM
- Docker Desktop com Compose

## Configuração local

Copie o arquivo de ambiente de exemplo:

```powershell
Copy-Item .env.example .env
```

Instale as dependências:

```powershell
bun install
```

Suba o PostgreSQL e o MiniStack:

```powershell
docker compose up -d
docker compose ps
```

Quando os dois serviços estiverem saudáveis, crie as filas e aplique as migrations:

```powershell
bun run sqs:setup
bun run db:migrate
```

Inicie a API:

```powershell
bun run start:dev
```

A API usa a porta `3000` por padrão. Para iniciar outra instância, abra outro terminal e defina uma porta diferente antes de executar o mesmo comando:

```powershell
$env:PORT = "3001"
bun run start:dev
```

As instâncias usam o mesmo banco e as mesmas filas definidos no `.env`.

## Testes

Testes unitários:

```powershell
bun test
```

Build:

```powershell
bun run build
```

O teste de concorrência usa a API em execução, PostgreSQL e dados reais. Ele verifica 50 repetições da mesma operação, 50 apostas diferentes sobre uma carteira e duas apostas de R$ 80,00 disputando um saldo de R$ 100,00:

```powershell
bun run test:concurrency
```

Para testar várias instâncias, inicie pelo menos três APIs em portas diferentes e informe as URLs:

```powershell
$env:API_URLS = "http://localhost:3000,http://localhost:3001,http://localhost:3002"
bun run test:multi-instance
```

O script distribui requisições entre as instâncias, consulta o saldo final e executa a reconciliação. Ele não inicia os processos da API automaticamente.

Para conferir o estado das filas:

```powershell
bun run sqs:inspect
```

## Endpoints

| Método | Rota                                                                  | Descrição                                 |
| ------ | --------------------------------------------------------------------- | ----------------------------------------- |
| `POST` | `/wallets`                                                            | Cria uma carteira                         |
| `GET`  | `/wallets/:walletId`                                                  | Consulta saldo e versão                   |
| `GET`  | `/wallets/:walletId/ledger`                                           | Consulta o ledger com cursor              |
| `POST` | `/wallets/:walletId/reconciliation`                                   | Compara o saldo com o ledger              |
| `POST` | `/wagering/transactions`                                              | Processa uma operação de aposta           |
| `GET`  | `/wagering/transactions/:transactionId`                               | Consulta uma operação pelo ID interno     |
| `GET`  | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta pelo ID externo do provedor      |
| `POST` | `/queue/wagering`                                                     | Envia uma operação para a fila de entrada |
| `GET`  | `/health/live`                                                        | Verifica se o processo está ativo         |
| `GET`  | `/health/ready`                                                       | Verifica PostgreSQL e SQS                 |
| `GET`  | `/metrics`                                                            | Expõe métricas no formato Prometheus      |

### Criar carteira

```http
POST /wallets
Content-Type: application/json

{
  "playerId": "player-123",
  "currency": "BRL",
  "openingBalance": "100.00"
}
```

O saldo inicial pode ser zero. Quando é maior que zero, a criação da carteira, a transação `OPENING`, o crédito no ledger e o evento da Outbox são confirmados na mesma transação SQL.

### Processar uma operação

```http
POST /wagering/transactions
Idempotency-Key: bet-001
Content-Type: application/json

{
  "providerId": "provider-a",
  "externalTransactionId": "external-bet-001",
  "playerId": "player-123",
  "walletId": "<wallet-id>",
  "roundId": "round-001",
  "type": "BET",
  "amount": "80.00",
  "currency": "BRL"
}
```

Os tipos aceitos são `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. `OPENING` é criado apenas pelo serviço de carteiras. Os valores são enviados como strings decimais, com no máximo duas casas; entradas com escala maior são rejeitadas.

`REFUND` e `ROLLBACK` precisam informar `referenceExternalTransactionId`. A referência deve pertencer ao mesmo provedor, jogador, carteira, moeda e rodada. Cada transação de origem pode ser revertida uma única vez.

O endpoint retorna `201` para operações processadas, `202` para operações aguardando uma referência e `422` para rejeições de regra de negócio. Erros de validação retornam `400`; conflitos de idempotência ou de identificador externo retornam `409`. Falhas de infraestrutura permanecem como erros `5xx`.

### Enviar pela fila

`POST /queue/wagering` recebe o mesmo corpo de uma operação e exige o header `Idempotency-Key`. A resposta HTTP `202` com `accepted: true` confirma que a mensagem foi enviada ao SQS; o processamento acontece em segundo plano.

## Filas

O `sqs:setup` cria três filas FIFO:

- `wager-transactions.fifo`: solicitações de operações;
- `wager-transactions-dlq.fifo`: mensagens que excederam o limite de entrega;
- `wager-events.fifo`: eventos publicados pela Outbox para consumidores externos.

O projeto inclui o consumidor da fila de entrada. A fila de eventos é uma saída de integração; não há um consumidor de negócio implementado para ela neste serviço.

## Regras de consistência

- Valores monetários são representados por strings na API e `bigint` em centavos no objeto `Money`.
- A carteira é bloqueada com `SELECT ... FOR UPDATE` dentro da transação PostgreSQL.
- Saldo, transação, ledger, Inbox (quando a entrada vem do SQS) e Outbox são gravados atomicamente.
- A idempotência é persistida por provedor e chave, com hash SHA-256 de um JSON canônico.
- A mesma chave com outro payload resulta em `409 Conflict`.
- O banco impede saldo negativo, duplicidade de operação, mais de um lançamento por transação e alteração ou remoção do ledger.
- A entrega do SQS é at-least-once. A aplicação não depende apenas da deduplicação FIFO para preservar o saldo.

## Autenticação

A autenticação não foi implementada, conforme a opção prevista no desafio. `ProviderIdentityGuard` é o ponto de substituição para integrar um provedor de identidade externo. O guard atual não autentica chamadas e não deve ser usado como proteção em produção.

## Encerrar o ambiente

Para parar os containers e manter os dados do PostgreSQL:

```powershell
docker compose down
```

Para apagar também o volume do banco:

```powershell
docker compose down -v
```

O segundo comando remove os dados locais e não deve ser usado se você quiser manter as carteiras e transações já criadas.

## Esclarecimento 

Durante o desenvolvimento deste projeto, utilizei ferramentas de inteligência artificial como apoio significativo ao aprendizado, à implementação e à investigação de problemas técnicos, especialmente por ainda estar desenvolvendo experiência prática com NestJS, MikroORM e AWS SQS.

Também realizei a configuração do ambiente, execução das migrations, compilação e testes automatizados. O uso dessas ferramentas fez parte do meu processo de aprendizado, e considero importante aprofundar continuamente meu entendimento das decisões arquiteturais e dos componentes implementados.