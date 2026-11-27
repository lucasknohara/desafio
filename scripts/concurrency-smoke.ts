import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

interface WalletResponse {
  id: string;
  playerId: string;
  balance: string;
  version: number;
}

interface WagerResponse {
  transactionId: string;
  status: string;
  balance: string;
  idempotentReplay: boolean;
}

interface ReconciliationResponse {
  consistent: boolean;
  difference: string;
  checkedEntries: number;
}

async function request<T>(
  url: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${url}${path}`, init);
  const body = (await response.json()) as T & { message?: string };

  if (!response.ok && response.status !== 422) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function createWallet(label: string): Promise<WalletResponse> {
  const playerId = `${label}-${randomUUID()}`;

  return request<WalletResponse>(baseUrl, '/wallets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId,
      currency: 'BRL',
      openingBalance: '100.00',
    }),
  });
}

function createWager(
  wallet: WalletResponse,
  externalTransactionId: string,
  amount: string,
) {
  return {
    providerId: 'smoke-provider',
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'smoke-round',
    type: 'BET',
    amount,
    currency: 'BRL',
  };
}

async function submitWager(
  wallet: WalletResponse,
  payload: ReturnType<typeof createWager>,
  idempotencyKey: string,
): Promise<WagerResponse> {
  return request<WagerResponse>(baseUrl, '/wagering/transactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
}

async function main(): Promise<void> {
  const replayWallet = await createWallet('replay');
  const replayPayload = createWager(
    replayWallet,
    `same-bet-${randomUUID()}`,
    '10.00',
  );
  const replayKey = `same-key-${randomUUID()}`;
  const replayResults = await Promise.all(
    Array.from({ length: 50 }, () =>
      submitWager(replayWallet, replayPayload, replayKey),
    ),
  );
  const replayIds = new Set(
    replayResults.map((result) => result.transactionId),
  );
  const replayBalance = await request<WalletResponse>(
    baseUrl,
    `/wallets/${replayWallet.id}`,
  );

  if (
    replayIds.size !== 1 ||
    replayResults.filter((result) => !result.idempotentReplay).length !== 1 ||
    replayBalance.balance !== '90.00'
  ) {
    throw new Error('Idempotency test failed');
  }

  const concurrencyWallet = await createWallet('concurrency');
  const distinctResults = await Promise.all(
    Array.from({ length: 50 }, (_, index) => {
      const sequence = String(index + 1).padStart(3, '0');
      return submitWager(
        concurrencyWallet,
        createWager(
          concurrencyWallet,
          `distinct-bet-${sequence}-${randomUUID()}`,
          '1.00',
        ),
        `distinct-key-${sequence}-${randomUUID()}`,
      );
    }),
  );
  const concurrencyBalance = await request<WalletResponse>(
    baseUrl,
    `/wallets/${concurrencyWallet.id}`,
  );
  const reconciliation = await request<ReconciliationResponse>(
    baseUrl,
    `/wallets/${concurrencyWallet.id}/reconciliation`,
    { method: 'POST' },
  );

  if (
    distinctResults.some((result) => result.status !== 'PROCESSED') ||
    new Set(distinctResults.map((result) => result.transactionId)).size !==
      50 ||
    concurrencyBalance.balance !== '50.00' ||
    concurrencyBalance.version !== 51 ||
    !reconciliation.consistent ||
    reconciliation.difference !== '0.00' ||
    reconciliation.checkedEntries !== 51
  ) {
    throw new Error('Concurrent wallet test failed');
  }

  const raceWallet = await createWallet('race');
  const raceResults = await Promise.all(
    [0, 1].map((index) =>
      submitWager(
        raceWallet,
        createWager(raceWallet, `race-bet-${index}-${randomUUID()}`, '80.00'),
        `race-key-${index}-${randomUUID()}`,
      ),
    ),
  );
  const raceBalance = await request<WalletResponse>(
    baseUrl,
    `/wallets/${raceWallet.id}`,
  );
  const raceStatuses = raceResults.map((result) => result.status).sort();

  if (
    raceStatuses.join(',') !== 'PROCESSED,REJECTED' ||
    raceBalance.balance !== '20.00'
  ) {
    throw new Error('Insufficient funds race test failed');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        api: baseUrl,
        idempotency: {
          requests: replayResults.length,
          distinctTransactionIds: replayIds.size,
          originalExecutions: replayResults.filter(
            (result) => !result.idempotentReplay,
          ).length,
          replays: replayResults.filter((result) => result.idempotentReplay)
            .length,
          balance: replayBalance.balance,
        },
        concurrentBets: {
          requests: distinctResults.length,
          processed: distinctResults.filter(
            (result) => result.status === 'PROCESSED',
          ).length,
          rejected: distinctResults.filter(
            (result) => result.status === 'REJECTED',
          ).length,
          balance: concurrencyBalance.balance,
          version: concurrencyBalance.version,
          reconciliation,
        },
        insufficientFundsRace: {
          statuses: raceStatuses,
          balance: raceBalance.balance,
        },
      },
      null,
      2,
    )}\n`,
  );
}

await main();
