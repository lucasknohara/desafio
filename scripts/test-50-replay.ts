const walletId = "9d1556ba-4b40-4fad-8fa5-5e3c6dd3ba4b";

const payload = {
  providerId: "provider-a",
  externalTransactionId: "external-stress-50-same-bet-001",
  playerId: "player-lucas-001",
  walletId,
  roundId: "round-stress-50-same-bet-001",
  type: "BET",
  amount: "5.00",
  currency: "BRL",
};

const headers = {
  "Content-Type": "application/json",
  "Idempotency-Key": "stress-50-same-bet-001",
};

const results = await Promise.all(
  Array.from({ length: 50 }, async () => {
    try {
      const response = await fetch(
        "http://localhost:3000/wagering/transactions",
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
      );

      return {
        httpStatus: response.status,
        data: await response.json(),
      };
    } catch (error) {
      return {
        httpStatus: 0,
        data: { error: String(error) },
      };
    }
  }),
);

const uniqueIds = new Set(
  results.map((r) => r.data.transactionId).filter(Boolean),
);

console.log(JSON.stringify({
  totalRequests: results.length,
  httpStatuses: results.reduce((acc, r) => {
    acc[r.httpStatus] = (acc[r.httpStatus] ?? 0) + 1;
    return acc;
  }, {}),
  processed: results.filter((r) => r.data.status === "PROCESSED").length,
  rejected: results.filter((r) => r.data.status === "REJECTED").length,
  originalExecutions: results.filter((r) => r.data.idempotentReplay === false).length,
  replays: results.filter((r) => r.data.idempotentReplay === true).length,
  distinctTransactionIds: uniqueIds.size,
  errors: results.filter((r) => !r.data.transactionId),
}, null, 2));
