import { randomUUID } from 'node:crypto';

const apiUrls = (
  process.env.API_URLS ??
  'http://localhost:3000,http://localhost:3001,http://localhost:3002'
)
  .split(',')
  .map((url) => url.trim().replace(/\/$/, ''))
  .filter(Boolean);

if (apiUrls.length < 3) {
  throw new Error('Configure at least three URLs in API_URLS');
}

interface WalletResponse {
  id: string;
  balance: string;
  version: number;
}

interface WagerResponse {
  transactionId: string;
  status: string;
  idempotentReplay: boolean;
}

interface ReconciliationResponse {
  consistent: boolean;
  difference: string;
  checkedEntries: number;
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(`${baseUrl} ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function main(): Promise<void> {
  const playerId = `multi-instance-${randomUUID()}`;
  const wallet = await request<WalletResponse>(apiUrls[0]!, '/wallets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId,
      currency: 'BRL',
      openingBalance: '100.00',
    }),
  });

  const duplicatePayload = {
    providerId: 'multi-instance-provider',
    externalTransactionId: `duplicate-${randomUUID()}`,
    playerId,
    walletId: wallet.id,
    roundId: 'multi-instance-round',
    type: 'BET',
    amount: '10.00',
    currency: 'BRL',
  };
  const duplicateKey = `duplicate-key-${randomUUID()}`;
  const requestCounts: Record<string, number> = Object.fromEntries(
    apiUrls.map((url) => [url, 0]),
  );
  const duplicateResults = await Promise.all(
    Array.from({ length: 50 }, (_, index) => {
      const baseUrl = apiUrls[index % apiUrls.length]!;
      requestCounts[baseUrl] = (requestCounts[baseUrl] ?? 0) + 1;
      return request<WagerResponse>(baseUrl, '/wagering/transactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': duplicateKey,
        },
        body: JSON.stringify(duplicatePayload),
      });
    }),
  );

  const duplicateIds = new Set(
    duplicateResults.map((result) => result.transactionId),
  );
  const duplicateBalance = await request<WalletResponse>(
    apiUrls[0]!,
    `/wallets/${wallet.id}`,
  );

  if (
    duplicateIds.size !== 1 ||
    duplicateResults.filter((result) => !result.idempotentReplay).length !==
      1 ||
    duplicateBalance.balance !== '90.00'
  ) {
    throw new Error('Cross-instance idempotency test failed');
  }

  const uniqueResults = await Promise.all(
    Array.from({ length: 50 }, (_, index) => {
      const sequence = String(index + 1).padStart(3, '0');
      const baseUrl = apiUrls[index % apiUrls.length]!;
      requestCounts[baseUrl] = (requestCounts[baseUrl] ?? 0) + 1;
      const payload = {
        providerId: 'multi-instance-provider',
        externalTransactionId: `unique-${sequence}-${randomUUID()}`,
        playerId,
        walletId: wallet.id,
        roundId: 'multi-instance-round',
        type: 'BET',
        amount: '1.00',
        currency: 'BRL',
      };

      return request<WagerResponse>(baseUrl, '/wagering/transactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `unique-key-${sequence}-${randomUUID()}`,
        },
        body: JSON.stringify(payload),
      });
    }),
  );

  const finalWallet = await request<WalletResponse>(
    apiUrls[0]!,
    `/wallets/${wallet.id}`,
  );
  const reconciliation = await request<ReconciliationResponse>(
    apiUrls[0]!,
    `/wallets/${wallet.id}/reconciliation`,
    { method: 'POST' },
  );

  if (
    uniqueResults.some((result) => result.status !== 'PROCESSED') ||
    new Set(uniqueResults.map((result) => result.transactionId)).size !== 50 ||
    finalWallet.balance !== '40.00' ||
    finalWallet.version !== 52 ||
    !reconciliation.consistent ||
    reconciliation.difference !== '0.00' ||
    reconciliation.checkedEntries !== 52
  ) {
    throw new Error('Cross-instance concurrency test failed');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        instances: apiUrls,
        requestsPerInstance: requestCounts,
        duplicateRequests: duplicateResults.length,
        duplicateTransactionIds: duplicateIds.size,
        idempotentReplays: duplicateResults.filter(
          (result) => result.idempotentReplay,
        ).length,
        uniqueRequests: uniqueResults.length,
        processed: uniqueResults.filter(
          (result) => result.status === 'PROCESSED',
        ).length,
        balance: finalWallet.balance,
        version: finalWallet.version,
        reconciliation,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
