'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface WebhookEvent {
  id: string;
  eventId: string;
  type: string;
  status: 'PENDING' | 'PROCESSING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED';
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Attempt {
  id: string;
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  finishedAt: string | null;
  result: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'RETRYING' | 'CRASHED';
  error: string | null;
}

interface WebhookEventDetails extends WebhookEvent {
  data: Record<string, any>;
  attempts: Attempt[];
}

export default function Dashboard() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEventDetails | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [retryingEventId, setRetryingEventId] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/events?page=1&limit=50`);
      if (res.ok) {
        const json = await res.json();
        setEvents(json.data || []);
      }
    } catch (err) {
      console.error('Error fetching events:', err);
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  // Periodic polling every 3 seconds
  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 3000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const viewDetails = async (eventId: string) => {
    try {
      const res = await fetch(`${API_URL}/events/${eventId}`);
      if (res.ok) {
        const details = await res.json();
        setSelectedEvent(details);
        setIsModalOpen(true);
      }
    } catch (err) {
      console.error('Error fetching details:', err);
    }
  };

  const handleRetry = async (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRetryingEventId(eventId);
    try {
      const res = await fetch(`${API_URL}/events/${eventId}/retry`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchEvents();
        if (selectedEvent && selectedEvent.eventId === eventId) {
          viewDetails(eventId);
        }
      } else {
        const errorText = await res.text();
        alert(`Retry failed: ${errorText}`);
      }
    } catch (err) {
      console.error('Error initiating retry:', err);
    } finally {
      setRetryingEventId(null);
    }
  };

  return (
    <div className="container">
      <header>
        <div>
          <h1>Reliable Webhook Processor</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Live Operations Dashboard • Polling every 3s
          </p>
        </div>
        <button onClick={fetchEvents}>Refresh Now</button>
      </header>

      <main>
        {loading && events.length === 0 ? (
          <p>Loading events...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Created</th>
                <th>Last Error</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                    No webhook events recorded yet. Send a request to <code>POST /webhooks</code>.
                  </td>
                </tr>
              ) : (
                events.map((evt) => (
                  <tr key={evt.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{evt.eventId}</td>
                    <td>{evt.type}</td>
                    <td>
                      <span className={`status-badge status-${evt.status}`}>{evt.status}</span>
                    </td>
                    <td>
                      {evt.attemptCount} / {evt.maxAttempts}
                    </td>
                    <td>{new Date(evt.createdAt).toLocaleTimeString()}</td>
                    <td style={{ color: '#f87171', fontSize: '0.8rem', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {evt.lastError || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => viewDetails(evt.eventId)}>Details</button>
                        {evt.status === 'FAILED' && (
                          <button
                            className="btn-retry"
                            disabled={retryingEventId === evt.eventId}
                            onClick={(e) => handleRetry(evt.eventId, e)}
                          >
                            {retryingEventId === evt.eventId ? 'Queuing...' : 'Retry'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* Modal for Event Details & Attempt History */}
        {isModalOpen && selectedEvent && (
          <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Event: {selectedEvent.eventId}</h2>
                <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                  &times;
                </button>
              </div>

              <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <span className={`status-badge status-${selectedEvent.status}`}>{selectedEvent.status}</span>
                <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Type: {selectedEvent.type}</span>
                {selectedEvent.status === 'FAILED' && (
                  <button className="btn-retry" onClick={(e) => handleRetry(selectedEvent.eventId, e)}>
                    Manual Retry
                  </button>
                )}
              </div>

              <h3>Payload Data</h3>
              <pre>{JSON.stringify(selectedEvent.data, null, 2)}</pre>

              <h3>Attempt History</h3>
              {selectedEvent.attempts && selectedEvent.attempts.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Worker ID</th>
                      <th>Started</th>
                      <th>Finished</th>
                      <th>Result</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedEvent.attempts.map((att) => (
                      <tr key={att.id}>
                        <td>{att.attemptNumber}</td>
                        <td style={{ fontFamily: 'monospace' }}>{att.workerId}</td>
                        <td>{new Date(att.startedAt).toLocaleTimeString()}</td>
                        <td>{att.finishedAt ? new Date(att.finishedAt).toLocaleTimeString() : 'In Progress'}</td>
                        <td>
                          <span className={`status-badge status-${att.result}`}>{att.result}</span>
                        </td>
                        <td style={{ color: '#f87171', fontSize: '0.8rem' }}>{att.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.5rem' }}>No attempt history logged yet.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
