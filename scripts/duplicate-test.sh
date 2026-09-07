#!/bin/bash
set -e

BACKEND_URL=${BACKEND_URL:-"http://localhost:3001"}
EVENT_ID="evt-duplicate-001"

echo "======================================================="
echo "1. CONCURRENT DUPLICATE TEST"
echo "Sending 10 simultaneous POST /webhooks for eventId: $EVENT_ID"
echo "======================================================="

for i in {1..10}; do
  curl -s -X POST "$BACKEND_URL/webhooks" \
    -H "Content-Type: application/json" \
    -d "{
      \"eventId\": \"$EVENT_ID\",
      \"type\": \"order.created\",
      \"data\": {
        \"orderId\": \"ORD-001\",
        \"simulate\": \"ok\"
      }
    }" > /dev/null &
done

wait
echo "All 10 requests completed."

echo ""
echo "Waiting 3 seconds for worker processing..."
sleep 3

echo ""
echo "Fetching event details..."
curl -s "$BACKEND_URL/events/$EVENT_ID" | jq .

echo ""
echo "SQL Verification Query:"
echo "docker compose exec -T postgres psql -U postgres -d webhook_processor -c \"SELECT * FROM processed_orders WHERE event_id = '$EVENT_ID';\""
docker compose exec -T postgres psql -U postgres -d webhook_processor -c "SELECT * FROM processed_orders WHERE event_id = '$EVENT_ID';"
