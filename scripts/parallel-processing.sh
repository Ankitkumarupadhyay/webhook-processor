#!/bin/bash
set -e

BACKEND_URL=${BACKEND_URL:-"http://localhost:3001"}

echo "======================================================="
echo "4. PARALLEL PROCESSING TEST"
echo "Submitting 2 slow:10 events simultaneously"
echo "======================================================="

curl -s -X POST "$BACKEND_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"evt-parallel-A","type":"order.created","data":{"orderId":"ORD-PAR-A","simulate":"slow:10"}}' | jq . &

curl -s -X POST "$BACKEND_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"evt-parallel-B","type":"order.created","data":{"orderId":"ORD-PAR-B","simulate":"slow:10"}}' | jq . &

wait

echo ""
echo "Waiting 3 seconds for workers to claim..."
sleep 3

echo ""
echo "Checking attempt logs for worker assignment:"
curl -s "$BACKEND_URL/events/evt-parallel-A" | jq '{eventId: .eventId, status: .status, attempts: .attempts}'
curl -s "$BACKEND_URL/events/evt-parallel-B" | jq '{eventId: .eventId, status: .status, attempts: .attempts}'
