import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

const client = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

const queues = [
  'wager-transactions.fifo',
  'wager-events.fifo',
  'wager-transactions-dlq.fifo',
];

async function main(): Promise<void> {
  for (const name of queues) {
    const { QueueUrl } = await client.send(
      new GetQueueUrlCommand({ QueueName: name }),
    );

    if (!QueueUrl) {
      throw new Error(`Queue URL not found: ${name}`);
    }

    const result = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl,
        AttributeNames: [
          'QueueArn',
          'FifoQueue',
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      }),
    );

    const attributes = result.Attributes ?? {};

    console.log(`\nQueue: ${name}`);
    console.log({
      arn: attributes.QueueArn,
      fifo: attributes.FifoQueue,
      available: attributes.ApproximateNumberOfMessages,
      inFlight: attributes.ApproximateNumberOfMessagesNotVisible,
      delayed: attributes.ApproximateNumberOfMessagesDelayed,
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error('Could not inspect SQS queues:', error);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
