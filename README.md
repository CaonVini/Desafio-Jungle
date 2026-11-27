# Desafio Jungle: Distributed Wagering Processor
 
API que processa apostas e movimenta o saldo das carteiras dos jogadores sem erro, mesmo com várias instâncias rodando e com mensagens repetidas ou atrasadas. Projeto feito para o desafio técnico de backend da Jungle Gaming.
 
As decisões técnicas, o que foi feito, o que ficou de fora e o porquê de cada escolha estão no [ARCHITECTURE.md](./ARCHITECTURE.md).
 
## Stack
 
![NestJS, Bun, TypeScript, PostgreSQL, AWS SQS, Docker e Nginx](https://skillicons.dev/icons?i=nestjs,bun,ts,postgres,aws,docker,nginx&perline=7)
 
- **NestJS e TypeScript** estruturam a API, com `strict` ligado.
- **Bun** roda a aplicação, as migrations e os testes.
- **PostgreSQL com TypeORM** guarda carteiras, transações e ledger, e é quem coordena a concorrência.
- **SQS (LocalStack)** recebe as transações pela fila e entrega os eventos publicados pelo outbox.
- **Docker Compose e Nginx** sobem tudo junto, com 3 réplicas da API atrás de um balanceador.
## Como rodar
 
Precisa de Docker e Docker Compose.
 
```bash
git clone https://github.com/CaonVini/Desafio-Jungle.git
cd Desafio-Jungle
cp .env.example .env
docker compose --profile app up -d --build
curl http://localhost:3000/health/ready
```
 
Isso sobe o PostgreSQL, o LocalStack (que cria as filas), 3 réplicas da API e um Nginx em `http://localhost:3000`. As migrations rodam sozinhas, no serviço `migrate`, antes de a API subir, porque sem elas as tabelas não existem e a API não funciona.
 
Se a API não subir, veja se as migrations rodaram com `docker compose --profile app logs migrate`. Se não rodaram, rode `docker compose --profile app run --rm migrate` e depois `docker compose --profile app up -d`.
 
No cmd do Windows, troque o `cp` por `copy`. Pra desligar, use `docker compose --profile app down`. Pra apagar também os dados, use `docker compose --profile app down -v`.
 
## Fazendo a primeira aposta
 
Uma transação pode chegar por HTTP ou pela fila SQS, e o resultado é o mesmo. Primeiro crie uma carteira com 100,00. Os exemplos com `curl` funcionam no Git Bash ou no WSL.
 
```bash
curl -X POST http://localhost:3000/wallets \
  -H 'content-type: application/json' \
  -d '{"playerId":"0198cccc-bbbb-7ccc-8ddd-000000000001","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```
 
Guarde o `id` da resposta e use no lugar de `WALLET_ID` nos dois exemplos abaixo.
 
### Por HTTP
 
Aposte 25,00 com este comando.
 
```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: bet-1' \
  -d '{
    "providerId": "provider-a",
    "externalTransactionId": "bet-1",
    "walletId": "WALLET_ID",
    "playerId": "0198cccc-bbbb-7ccc-8ddd-000000000001",
    "roundId": "round-1",
    "gameId": "game-1",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }'
```
 
A resposta traz `transactionId`, `status`, `balance` (75.00) e `idempotentReplay: false`. Rode o mesmo comando de novo e volta o mesmo resultado com `idempotentReplay: true`, e o saldo continua 75.00.
 
### Pela fila SQS
 
O consumidor lê a fila `wager-transactions.fifo`. Como ela não usa deduplicação por conteúdo, o envio precisa do `--message-group-id` e do `--message-deduplication-id`.
 
```bash
docker exec wagering-localstack awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
  --message-group-id WALLET_ID \
  --message-deduplication-id msg-001 \
  --message-body '{
    "messageId": "msg-001",
    "type": "WagerTransactionRequested",
    "occurredAt": "2026-11-26T12:00:00.000Z",
    "data": {
      "providerId": "provider-a",
      "externalTransactionId": "bet-sqs-1",
      "walletId": "WALLET_ID",
      "playerId": "0198cccc-bbbb-7ccc-8ddd-000000000001",
      "roundId": "round-1",
      "gameId": "game-1",
      "kind": "BET",
      "money": { "amount": "10.00", "currency": "BRL" }
    }
  }'
```
 
Mensagem de fila não tem header. Se o `data` não trouxer um `idempotencyKey`, o consumidor usa `providerId:externalTransactionId` como chave. Depois de alguns segundos, consulte a carteira em `GET /wallets/WALLET_ID` e o saldo deve ter caído mais 10,00.
 
## O que o projeto garante
 
- O saldo nunca fica negativo, e toda mudança de saldo tem uma linha no ledger, que não pode ser alterada nem apagada.
- A mesma aposta enviada duas vezes, ou 50 vezes ao mesmo tempo, debita uma vez só.
- Se duas apostas disputam o mesmo saldo, uma passa e a outra é rejeitada por saldo insuficiente.
- Tudo isso vale com várias instâncias da API, porque quem coordena é o banco.
- Se um processo morrer no meio de uma aposta, nada se perde e nada se duplica.
- As transações podem chegar por HTTP ou pela fila SQS, com o mesmo resultado.
## Endpoints
 
| Rota | O que faz |
|---|---|
| `POST /wallets` | Cria uma carteira |
| `GET /wallets/:walletId` | Consulta a carteira |
| `GET /wallets/:walletId/ledger?cursor=&limit=` | Lista o ledger, do mais recente pro mais antigo |
| `POST /wallets/:walletId/reconciliation` | Compara o saldo da carteira com o ledger |
| `POST /wagering/transactions` | Processa uma transação (exige o header `Idempotency-Key`) |
| `GET /wagering/transactions/:transactionId` | Consulta pelo id interno |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta pelo id do provedor |
| `GET /health/live` | Processo vivo |
| `GET /health/ready` | PostgreSQL e SQS acessíveis |
| `GET /metrics` | Métricas no formato Prometheus |
 
Se a API responder `503` com `DATABASE_BUSY`, a carteira estava ocupada, então é só repetir a mesma chamada, com a mesma `Idempotency-Key`.
 
## Estrutura do projeto
 
Cada módulo dentro de `src/` segue a mesma divisão em camadas. O `wagering` está aberto abaixo como exemplo, e o mesmo desenho vale para `wallet`, `outbox` e `inbox`, cada um só com as pastas de que precisa. A regra é que o `domain` não depende de framework nem de banco, e quem fala com o TypeORM e com o SQS é o `infra`.
 
```
.
├── src/
│   ├── wagering/                processa as transações
│   │   ├── domain/              entidade, regras e interfaces
│   │   ├── application/         casos de uso
│   │   ├── infra/               repositórios com TypeORM
│   │   ├── http/                controllers, a porta de entrada da API
│   │   ├── messaging/           consumidor e worker da fila SQS
│   │   ├── events/              eventos publicados
│   │   └── wagering.module.ts
│   ├── wallet/                  carteira, ledger e reconciliação
│   ├── outbox/                  publicação dos eventos no SQS
│   ├── inbox/                   registro de mensagens já recebidas
│   ├── shared/                  Money, erros, migrations, logs e guard
│   ├── health/                  /health/live e /health/ready
│   └── metrics/                 /metrics no formato Prometheus
├── test/                        integração, concorrência e queda de processo
├── docker/                      configuração do Nginx
└── localstack/                  script que cria as filas
```
 
O controller é a porta de entrada HTTP e não tem regra de negócio. No `wagering`, o `WageringController` recebe o corpo e o header `Idempotency-Key`, valida a entrada, chama o caso de uso `ProcessWagerTransactionUseCase` e converte o resultado em status HTTP, que é 200 para transação processada, 202 para referência pendente e 422 para rejeitada, como no caso de saldo insuficiente. Os erros de domínio, como carteira inexistente ou conflito de idempotência, são convertidos em resposta pelo filtro de exceções que fica em `shared/http`. A fila SQS entra pelo `messaging` e chega no mesmo caso de uso, por isso HTTP e fila têm o mesmo resultado.
 
## Testes
 
Precisa de Bun 1.x e de `bun install` na raiz do projeto. Os testes de integração usam PostgreSQL e SQS de verdade, então o `docker compose up -d` precisa estar rodando. O banco de teste (`wagering_test`) é criado e migrado sozinho, e as filas são criadas a cada execução.
 
| Comando | O que roda |
|---|---|
| `bun test` | Tudo |
| `bun run test:unit` | Só os testes de `src/`, sem precisar de Docker |
| `bun run test:integration` | Só os testes de `test/`, com PostgreSQL e SQS |
| `bun run test:process` | Sobe 3 processos reais da API e mata os processos no meio do tráfego (uns 40 segundos) |
| `SKIP_SQS_TESTS=1 bun test` | Tudo, menos os que usam o LocalStack (inclui os de matar processo) |
| `bun run lint` | Lint com oxlint |
 
Não implementei o teste de carga (`test:load`).
 
## Variáveis de ambiente
 
Os valores padrão já estão no `.env.example`, então não precisa mudar nada pra rodar.
 
| Variável | Pra que serve |
|---|---|
| `PORT` | Porta da API (padrão 3000) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexão com o PostgreSQL |
| `SQS_ENDPOINT` | Endereço do SQS (o LocalStack, no ambiente local) |
| `SQS_TRANSACTIONS_QUEUE_URL`, `SQS_TRANSACTIONS_DLQ_URL` | Fila de transações e a DLQ dela |
| `SQS_EVENTS_QUEUE_URL` | Fila onde o outbox publica os eventos |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credenciais (valores fictícios no LocalStack) |
| `OUTBOX_WORKER_ENABLED`, `OUTBOX_POLL_INTERVAL_MS` | Liga o worker que publica o outbox e define o intervalo |
| `SQS_CONSUMER_ENABLED`, `SQS_RETRY_BASE_SECONDS` | Liga o consumidor da fila e define a base do backoff |
| `PENDING_REFERENCE_WORKER_ENABLED`, `PENDING_REFERENCE_POLL_INTERVAL_MS` | Liga o worker das transações com referência pendente e define o intervalo |
| `DB_LOCK_TIMEOUT_MS` | Quanto uma consulta espera por um lock antes de desistir (padrão 5000) |
| `DB_STATEMENT_TIMEOUT_MS` | Tempo máximo de uma consulta (padrão 15000) |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | Derruba conexão parada dentro de uma transação (padrão 30000) |
| `APP_REPLICAS` | Número de réplicas da API no Docker Compose (padrão 3) |

## Medição do teste de carga

O `bun run test:load` cria carteiras, dispara 500 apostas de 1,00 em paralelo, reenvia 10% delas com a mesma chave para conferir o replay e, no fim, compara o saldo de cada carteira com o esperado e roda a reconciliação do ledger.

Os números abaixo vieram de uma execução com 3 instâncias da API, PostgreSQL real e SQS simulado, todos na mesma máquina e sem passar pelo Nginx. Eles mostram a ordem de grandeza e não devem ser lidos como capacidade máxima.

| Cenário | Tempo | Vazão | p50 | p95 | p99 | Máx. |
|---|---|---|---|---|---|---|
| 10 carteiras com saldo 40, concorrência 50 | 2,17 s | 230 apostas/s | 181 ms | 440 ms | 571 ms | 986 ms |
| 1 carteira com saldo 100, concorrência 100 | 3,18 s | 157 apostas/s | 522 ms | 1099 ms | 1256 ms | 1478 ms |

No primeiro cenário, 400 apostas foram aceitas (`200`) e 100 rejeitadas por saldo insuficiente (`422`), exatamente o esperado. No segundo, que concentra tudo numa carteira só, foram 100 aceitas e 400 rejeitadas. Em ambos não houve `503`, as 50 repetições devolveram o resultado original e todas as carteiras fecharam com saldo igual ao esperado e ledger consistente.

A carteira única é mais lenta porque as apostas da mesma carteira andam uma por vez, por causa do lock. Isso é esperado e é o que garante que o saldo nunca fique negativo.
