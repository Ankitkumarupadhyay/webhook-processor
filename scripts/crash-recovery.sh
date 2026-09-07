#!/bin/bash
set -e

BACKEND_URL=${BACKEND_URL:-"http://localhost:3001"}
EVENT_ID="evt-crash-test"

echo "======================================================="
echo "5. WORKER CRASH & RECOVERY TEST"
echo "Submitting slow:20 event: $EVENT_ID"
echo "======================================================="

curl -s -X POST "$BACKEND_URL/webhooks" -H "Content-Type: application/json" \
  -d "{
    \"eventId\": \"$EVENT_ID\",
    \"type\": \"order.created\",
    \"data\": {
      \"orderId\": \"ORD-CRASH-DEMO\",
      \"simulate\": \"slow:20\"
    }
  }" | jq .

echo ""
echo "Waiting 3 seconds for worker-1 to claim..."
sleep 3

echo "Event status before crash:"
curl -s "$BACKEND_URL/events/$EVENT_ID" | jq '{eventId: .eventId, status: .status, attempts: .attempts}'

echo ""
echo "Stopping worker-1 container to simulate a hard crash..."
docker compose stop worker-1

echo ""
echo "Waiting for stale processing recovery timeout (30s) + recovery check..."
for i in {1..20}; do
  STATUS=$(curl -s "$BACKEND_URL/events/$EVENT_ID" | jq -r '.status')
  echo "Poll $i: status=$STATUS"
  if [ "$STATUS" == "SUCCEEDED" ]; then
    break
  fi
  sleep 3
done

echo ""
echo "Event status after recovery by worker-2:"
curl -s "$BACKEND_URL/events/$EVENT_ID" | jq .

echo ""
echo "Restarting worker-1..."
docker compose start worker-1

echo ""
echo "Verifying processed_orders table has EXACTLY 1 row:"
docker compose exec -T postgres psql -U postgres -d webhook_processor -c "SELECT * FROM processed_orders WHERE event_id = '$EVENT_ID';"
