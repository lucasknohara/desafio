const walletId = "f665682a-db22-4426-a950-926942ea2019";
const totalRequests = 50;
const baseUrl = "http://localhost:3000";

const results = await Promise.all(
  Array.from({ length: totalRequests }, async (_, index) => {
    const sequence = String(index + 1).padStart(3, "0");

    const payload = {
      providerId: "provider-stress",
      externalTransactionId: `stress-50-bet-${sequence}`,
      playerId: "player-stress-50",
      walletId,
      roundId: "round-stress-50",
      type: "BET",
      amount: "1.00",
      currency: "BRL",
    };

    try {
      const response = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `stress-50-key-${sequence}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      return {
        httpStatus: response.status,
        data,
      };
    } catch (error) {
      return {
        httpStatus: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
);

const countByHttpStatus = Object.fromEntries(
  [...new Set(results.map((result) => result.httpStatus))].map((status) => [
    status,
    results.filter((result) => result.httpStatus === status).length,
  ]),
);

const transactions = results
  .map((result) => result.data)
  .filter(Boolean);

console.log({
  totalRequests,
  httpStatuses: countByHttpStatus,
  processed: transactions.filter((item) => item.status === "PROCESSED").length,
  rejected: transactions.filter((item) => item.status === "REJECTED").length,
  pending: transactions.filter((item) => item.status === "PENDING_REFERENCE").length,
  distinctTransactionIds: new Set(
    transactions.map((item) => item.transactionId),
  ).size,
  idempotentReplays: transactions.filter(
    (item) => item.idempotentReplay === true,
  ).length,
  errors: results.filter((result) => result.error || result.httpStatus >= 400),
});
