import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const client = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

async function createQueue(
  name: string,
  attributes: Record<string, string>,
): Promise<string> {
  const result = await client.send(
    new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
  );
  if (!result.QueueUrl) {
    throw new Error(`SQS did not return a QueueUrl for ${name}`);
  }
  console.log(`Queue ready: ${name} -> ${result.QueueUrl}`);
  return result.QueueUrl;
}

async function main(): Promise<void> {
  const fifoAttributes = {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'false',
  };

  const dlqUrl = await createQueue(
    'wager-transactions-dlq.fifo',
    fifoAttributes,
  );
  const dlqAttributes = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const dlqArn = dlqAttributes.Attributes?.QueueArn;
  if (!dlqArn) throw new Error('Could not resolve the SQS DLQ ARN');

  await createQueue('wager-transactions.fifo', {
    ...fifoAttributes,
    VisibilityTimeout: '45',
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: dlqArn,
      maxReceiveCount: '5',
    }),
  });

  await createQueue('wager-events.fifo', fifoAttributes);
  console.log('All SQS FIFO queues are ready.');
}

main()
  .catch((error: unknown) => {
    console.error('Could not create SQS queues:', error);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
