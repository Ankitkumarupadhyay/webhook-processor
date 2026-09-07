#!/bin/bash
set -e

BACKEND_URL=${BACKEND_URL:-"http://localhost:3001"}
EVENT_ID="evt-temp-failure"

echo "======================================================="
echo "2. TEMPORARY FAILURE TEST (fail_then_succeed:2)"
echo "Sending eventId: $EVENT_ID with simulate=fail_then_succeed:2"
echo "======================================================="

curl -s -X POST "$BACKEND_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{
    \"eventId\": \"$EVENT_ID\",
    \"type\": \"order.created\",
    \"data\": {
      \"orderId\": \"ORD-TEMP\",
      \"simulate\": \"fail_then_succeed:2\"
    }
  }" | jq .

echo ""
echo "Monitoring retry progression..."
for i in {1..10}; do
  STATUS=$(curl -s "$BACKEND_URL/events/$EVENT_ID" | jq -r '.status')
  ATTEMPTS=$(curl -s "$BACKEND_URL/events/$EVENT_ID" | jq -r '.attemptCount')
  echo "Poll $i: status=$STATUS, attemptCount=$ATTEMPTS"
  if [ "$STATUS" == "SUCCEEDED" ]; then
    break
  fi
  sleep 2
done

echo ""
echo "Final Event Details & Attempt History:"
curl -s "$BACKEND_URL/events/$EVENT_ID" | jq .
