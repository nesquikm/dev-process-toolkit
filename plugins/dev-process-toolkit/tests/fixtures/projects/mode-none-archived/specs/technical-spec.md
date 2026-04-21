# Technical Spec

## Architecture

ASGI app with two middlewares (request-id, json-logging) and a thin
service layer. No background workers at M3.

## ADR-3: JSON logs over text

- **Context:** Downstream log aggregator parses JSON natively.
- **Decision:** All structured logs use a single JSON formatter.
- **Reconsider when:** A non-JSON consumer appears.
