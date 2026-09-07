#!/bin/bash
set -e

BACKEND_URL=${BACKEND_URL:-"http://localhost:3001"}
EVENT_ID="evt-crash-demo-$(date +%s)"

echo "======================================================="
echo "5. WORKER CRASH & RECOVERY DEMO"
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
echo "Waiting 3 seconds for a worker to claim..."
sleep 3

CLAIMED_WORKER=$(curl -s "$BACKEND_URL/events/$EVENT_ID" | jq -r '.attempts[0].workerId // empty')

if [ -z "$CLAIMED_WORKER" ] || [ "$CLAIMED_WORKER" == "null" ]; then
  echo "Error: No worker claimed the event yet."
  exit 1
fi

echo "Event status before crash (Claimed by $CLAIMED_WORKER):"
curl -s "$BACKEND_URL/events/$EVENT_ID" | jq '{eventId: .eventId, status: .status, attempts: .attempts}'

echo ""
echo "Stopping container $CLAIMED_WORKER to simulate a hard crash..."
docker compose stop "$CLAIMED_WORKER"

echo ""
echo "Waiting for stale processing recovery timeout (30s) + recovery check..."
for i in {1..25}; do
  STATUS=$(curl -s "$BACKEND_URL/events/$EVENT_ID" | jq -r '.status')
  echo "Poll $i: status=$STATUS"
  if [ "$STATUS" == "SUCCEEDED" ]; then
    break
  fi
  sleep 3
done

echo ""
echo "Final Event Details & Attempt History Log (Recovered by the surviving worker):"
curl -s "$BACKEND_URL/events/$EVENT_ID" | jq .

echo ""
echo "Restarting $CLAIMED_WORKER..."
docker compose start "$CLAIMED_WORKER"

echo ""
echo "Verifying processed_orders table has EXACTLY 1 row:"
docker compose exec -T postgres psql -U postgres -d webhook_processor -c "SELECT * FROM processed_orders WHERE event_id = '$EVENT_ID';"

