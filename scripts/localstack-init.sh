#!/bin/bash
set -euo pipefail

awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false >/dev/null

DLQ_ARN="$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

cat > /tmp/wager-main-queue-attributes.json <<EOF
{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "false",
  "VisibilityTimeout": "45",
  "RedrivePolicy": "{\\"deadLetterTargetArn\\":\\"${DLQ_ARN}\\",\\"maxReceiveCount\\":\\"5\\"}"
}
EOF

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes file:///tmp/wager-main-queue-attributes.json >/dev/null

awslocal sqs create-queue \
  --queue-name wager-events.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false >/dev/null

echo "SQS FIFO queues created: wager-transactions.fifo, wager-transactions-dlq.fifo, wager-events.fifo"
