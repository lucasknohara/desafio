# Decisões de arquitetura

## Escopo

O serviço recebe operações de apostas, atualiza carteiras e publica eventos para outros sistemas. PostgreSQL mantém o estado financeiro e as chaves de deduplicação. SQS faz o transporte das mensagens; não é a fonte da verdade.

## Modelo de domínio

`Wallet` mantém saldo e versão privados. A aplicação reidrata o agregado depois de bloquear a linha no PostgreSQL e aplica `debit` ou `credit` antes de copiar o novo estado para a entidade de persistência. `WagerTransaction` concentra as transições entre `PENDING`, `PENDING_REFERENCE` e os estados terminais. As entidades MikroORM cuidam do mapeamento e do armazenamento.

## Dinheiro

`Money` recebe strings decimais e guarda o valor em `bigint`, usando centavos como unidade mínima. Não há conversão monetária para `number`. A API rejeita valores negativos, notação científica e mais de duas casas decimais. O banco usa `NUMERIC(20,2)`.

Esta versão trabalha com escala de duas casas decimais. Embora aceite códigos de moeda de três letras, não implementa a escala variável da ISO 4217. O escopo local usa BRL.

## Carteira e concorrência

A unidade de concorrência é a carteira. Cada operação abre uma transação PostgreSQL e bloqueia somente a linha da carteira envolvida com `PESSIMISTIC_WRITE`. Assim, operações na mesma carteira são serializadas pelo banco, inclusive quando chegam a instâncias diferentes da API. Carteiras diferentes não compartilham um lock global.

A transação define `lock_timeout` de três segundos. Deadlocks, conflitos de serialização e lock timeout têm até três tentativas, cada uma com um novo `EntityManager` e uma nova transação. A constraint `CHECK (balance >= 0)` protege o saldo também no banco.

A versão da carteira começa em `1` e só aumenta quando o saldo muda. `LOSS` e transações rejeitadas não geram lançamento nem incrementam a versão.

## Idempotência

A chave é única por provedor e persistida em `wager_transactions`. O hash usa SHA-256 sobre as propriedades de negócio serializadas com as chaves ordenadas. A mesma chave e o mesmo hash retornam o snapshot original; a mesma chave com outro hash gera conflito. A API responde `201` para operações processadas, `202` para referências pendentes, `422` para rejeições de negócio, `400` para payload inválido e `409` para conflitos.

O banco também impede a reutilização do mesmo `externalTransactionId` dentro do mesmo provedor. O consumidor SQS registra `(consumerName, messageId)` na Inbox, junto ao hash do corpo recebido. Uma redelivery da mesma mensagem não aplica o efeito financeiro novamente.

## Ledger

Cada operação que altera o saldo cria um lançamento com direção, valor, saldo anterior e saldo posterior. `LOSS` e `REJECTED` não criam lançamentos. O banco verifica a aritmética do lançamento e usa uma trigger para impedir `UPDATE` e `DELETE` na tabela.

A reconciliação compara o saldo armazenado na carteira com a soma dos créditos e débitos. Ela informa a diferença, não corrige dados automaticamente. Quando encontra divergência, incrementa uma métrica e registra um log estruturado.

## Referências e reversões

`REFUND` referencia uma `BET` processada. `ROLLBACK` pode referenciar uma `BET`, `WIN` ou `REFUND` processada. A origem e a operação de reversão devem pertencer ao mesmo provedor, jogador, carteira, moeda e rodada, e os valores precisam ser iguais.

A coluna `reversed_transaction_id` tem constraint única. Referências ausentes ficam em `PENDING_REFERENCE`; o worker tenta novamente com backoff exponencial, limitado a cinco minutos. Após doze tentativas ou 24 horas, a operação é rejeitada com `REFERENCE_NOT_FOUND_TIMEOUT`.

## SQS e Inbox

`POST /queue/wagering` publica solicitações em `wager-transactions.fifo`. O grupo FIFO é o `walletId`, o que preserva a ordem por carteira no transporte. A idempotência no PostgreSQL continua sendo a proteção final.

O consumidor valida o corpo, executa o mesmo `WageringService` usado pela API HTTP e só envia `DeleteMessage` depois do commit. Rejeições de negócio são terminais. Erros de processamento deixam a mensagem na fila, com visibilidade adiada; a política de redrive encaminha mensagens que excederem cinco entregas para a DLQ.

No encerramento, o consumidor espera o lote em andamento. Mensagens ainda não iniciadas têm a visibilidade devolvida para que outra instância possa recebê-las.

## Outbox e eventos

A transação financeira grava o evento na Outbox antes do commit. O publisher seleciona lotes com `SKIP LOCKED`, marca os registros como `PROCESSING` e define um lease. Depois do envio ao SQS, marca o evento como `PUBLISHED`.

Se o processo cair depois do envio e antes da atualização do banco, o evento pode ser publicado novamente quando o lease vencer. Esse comportamento é esperado em uma entrega at-least-once; os consumidores externos devem deduplicar pelo `eventId`.

Os eventos usam um envelope com `eventId`, `eventType`, `aggregateId`, `correlationId`, `occurredAt`, `version` e `data`. Cada tipo de evento tem uma classe própria. `wager-events.fifo` é uma fila de saída para sistemas externos; o serviço não inclui um consumidor para ela.

## Observabilidade

Os logs são JSON e incluem os identificadores disponíveis no fluxo, sem registrar o corpo financeiro completo. `/metrics` expõe contadores, gauges e duração de processamento no formato Prometheus. As métricas são mantidas em memória por processo e reiniciam com a aplicação; não há agregador ou armazenamento de métricas neste projeto.

`/health/live` verifica o processo. `/health/ready` executa uma consulta no PostgreSQL e consulta os atributos da fila de entrada no SQS.

## Autenticação

A autenticação ficou fora desta entrega, conforme permitido pelo desafio. `ProviderIdentityGuard` é um guard sem autenticação para manter explícito o ponto de integração. Em um ambiente real, ele deve ser substituído por validação de identidade do provedor via OIDC ou mecanismo equivalente.

## Limitações conhecidas

- A escala monetária é fixa em duas casas, não variável por moeda.
- As métricas são locais a cada processo.
- O serviço não consome `wager-events.fifo`; o consumo pertence aos sistemas integrados.
- A recuperação de falhas de SQS e Outbox depende da redelivery, do lease e da idempotência persistente. Os cenários de queda de processo devem ser exercitados em ambiente com múltiplas instâncias antes de uma implantação real.
- O script `test:multi-instance` exercita três ou mais instâncias, mas precisa ser executado explicitamente com os processos e a infraestrutura locais em execução.
