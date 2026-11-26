#!/bin/sh
set -eu

DLQ_URL=$(awslocal sqs create-queue --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

cat > /tmp/transactions-queue-attributes.json <<JSON
{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "false",
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"
}
JSON

awslocal sqs create-queue --queue-name wager-transactions.fifo \
  --attributes file:///tmp/transactions-queue-attributes.json

awslocal sqs create-queue --queue-name wagering-events

echo "Filas prontas: wager-transactions.fifo, wager-transactions-dlq.fifo e wagering-events"
