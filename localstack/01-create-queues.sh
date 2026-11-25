#!/bin/sh
set -eu

DLQ_URL=$(awslocal sqs create-queue --queue-name wagering-events-dlq --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

cat > /tmp/main-queue-attributes.json <<JSON
{
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"
}
JSON

awslocal sqs create-queue --queue-name wagering-events \
  --attributes file:///tmp/main-queue-attributes.json

echo "Filas prontas: wagering-events (principal) e wagering-events-dlq (DLQ)"