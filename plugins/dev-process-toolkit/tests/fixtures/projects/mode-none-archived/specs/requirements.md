# Requirements

## FR-3: Health endpoint

- AC-3.1: `GET /health` returns 200 with `{"status": "ok"}`.
- AC-3.2: Response time under 50 ms locally.

## FR-4: Structured request logs

- AC-4.1: Every request emits one JSON log line with method, path, status.
- AC-4.2: Log line includes a request ID propagated via header.
