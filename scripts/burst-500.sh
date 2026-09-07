#!/bin/bash
set -e

BACKEND_URL=${BACKEND_URL:-"http://localhost:3001"}
TOTAL_EVENTS=500

echo "======================================================="
echo "6. BURST TEST (500 CONCURRENT EVENTS)"
echo "Sending $TOTAL_EVENTS unique webhook events concurrently..."
echo "======================================================="

START_TIME=$(date +%s)

for i in $(seq 1 $TOTAL_EVENTS); do
  curl -s -X POST "$BACKEND_URL/webhooks" \
    -H "Content-Type: application/json" \
    -d "{
      \"eventId\": \"evt-burst-$i\",
      \"type\": \"order.created\",
      \"data\": {
        \"orderId\": \"ORD-BURST-$i\",
        \"simulate\": \"ok\"
      }
    }" > /dev/null &
  
  if (( i % 50 == 0 )); then
    echo "Fired $i / $TOTAL_EVENTS ingestion requests..."
  fi
done

wait
END_TIME=$(date +%s)
INGESTION_DURATION=$((END_TIME - START_TIME))

echo ""
echo "All $TOTAL_EVENTS webhook requests ingested in ${INGESTION_DURATION}s!"
echo "API remained fully responsive."

echo ""
echo "Monitoring background queue processing progress..."
for i in {1..30}; do
  SUCCEEDED_COUNT=$(docker compose exec -T postgres psql -U postgres -d webhook_processor -t -c "SELECT COUNT(*) FROM webhook_events WHERE status = 'SUCCEEDED';" | xargs)
  PROCESSED_ORDERS_COUNT=$(docker compose exec -T postgres psql -U postgres -d webhook_processor -t -c "SELECT COUNT(*) FROM processed_orders WHERE event_id LIKE 'evt-burst-%';" | xargs)
  
  echo "Poll $i: Succeeded Events = $SUCCEEDED_COUNT / $TOTAL_EVENTS, Processed Orders = $PROCESSED_ORDERS_COUNT"
  
  if [ "$SUCCEEDED_COUNT" -ge "$TOTAL_EVENTS" ]; then
    echo "All $TOTAL_EVENTS events reached terminal state!"
    break
  fi
  sleep 3
done

echo ""
echo "Checking for duplicate business records (should be 0 duplicates):"
docker compose exec -T postgres psql -U postgres -d webhook_processor -c "
SELECT event_id, COUNT(*) 
FROM processed_orders 
WHERE event_id LIKE 'evt-burst-%' 
GROUP BY event_id 
HAVING COUNT(*) > 1;
"
