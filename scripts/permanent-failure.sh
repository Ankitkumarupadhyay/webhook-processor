#!/bin/bash
set -e

BACKEND_URL=${BACKEND_URL:-"http://localhost:3001"}
EVENT_ID="evt-permanent-failure"

echo "======================================================="
echo "3. PERMANENT FAILURE TEST (always_fail)"
echo "Sending eventId: $EVENT_ID with simulate=always_fail"
echo "======================================================="

curl -s -X POST "$BACKEND_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{
    \"eventId\": \"$EVENT_ID\",
    \"type\": \"order.created\",
    \"data\": {
      \"orderId\": \"ORD-FAIL\",
      \"simulate\": \"always_fail\"
    }
  }" | jq .

echo ""
echo "Monitoring until MAX_ATTEMPTS reached..."
for i in {1..15}; do
  STATUS=$(curl -s "$BACKEND_URL/events/$EVENT_ID" | jq -r '.status')
  ATTEMPTS=$(curl -s "$BACKEND_URL/events/$EVENT_ID" | jq -r '.attemptCount')
  echo "Poll $i: status=$STATUS, attemptCount=$ATTEMPTS"
  if [ "$STATUS" == "FAILED" ]; then
    break
  fi
  sleep 2
done

echo ""
echo "Verifying 0 rows in processed_orders for failed event:"
docker compose exec -T postgres psql -U postgres -d webhook_processor -c "SELECT COUNT(*) FROM processed_orders WHERE event_id = '$EVENT_ID';"
