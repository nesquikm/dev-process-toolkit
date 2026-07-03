---
name: orders-api-e2e
description: Exercise the Orders backend journey API end-to-end over real HTTP and assert the response chain (status, JSON shape, persisted totals).
disable-model-invocation: true
allowed-tools: Bash, Read
---

# orders-api-e2e — Backend HTTP e2e check

A worked example of a project-authored verification skill (a "check skill") for
a Python/FastAPI service. Copy this file to `.claude/skills/orders-api-e2e/SKILL.md`
in your project and adapt the marked spots. Modeled on a `glacy-progress-e2e`-style
skill, it walks the **Orders journey API end-to-end** over real HTTP — not
mocked, not a `pytest` unit — asserting each response and the state it leaves
behind.

> Read the authoring guide — `docs/verification-skills.md` — before adapting
> this. It explains how `verify_skill: orders-api-e2e` wires this skill into the
> `## Verification` hook so `/implement` runs it after `ruff`, `mypy`, and
> `pytest` pass, and why `disable-model-invocation: true` keeps it opt-in.

## What this checks

The real request → response → persisted-state chain of a user journey against a
running server. `ruff`, `mypy`, and `pytest` run first and always win; this
check adds the end-to-end HTTP behavior those gates cannot see:

- [ ] `POST /orders` with `{"customer": "ada"}` returns `201` and an order id.
- [ ] `POST /orders/{id}/items` with `{"sku": "widget", "qty": 3}` returns `200`.
- [ ] `POST /orders/{id}/checkout` returns `200` with `status: "paid"`.
- [ ] The final `GET /orders/{id}` reflects the accumulated total (3 × unit price)
      and `status: "paid"` — proving the write path persisted, not just echoed.

*Adapt:* replace the endpoints, payloads, and expected totals above with your
service's real journey. One representative multi-step flow beats ten shallow ones.

## How to run

1. **Start the server** and confirm it is healthy:

   ```bash
   # Adapt: your launch command + health endpoint.
   uvicorn app.main:app --port 8000 &
   BASE_URL="http://localhost:8000"
   curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health"
   ```

   If it is not `200`, wait for startup, then re-check.

2. **Walk the journey with `curl`**, capturing the id and asserting each step:

   ```bash
   ID=$(curl -s -X POST "$BASE_URL/orders" \
     -H 'Content-Type: application/json' \
     -d '{"customer": "ada"}' | jq -r .id)

   curl -s -X POST "$BASE_URL/orders/$ID/items" \
     -H 'Content-Type: application/json' \
     -d '{"sku": "widget", "qty": 3}'

   curl -s -X POST "$BASE_URL/orders/$ID/checkout"
   curl -s "$BASE_URL/orders/$ID"     # assert status=paid and total below
   ```

3. **Assert** status codes and JSON shape for each step (pipe through `jq`). A
   wrong status, missing field, or a total that does not reflect the added item
   is a FAIL — that gap is exactly what a unit test on the handler would miss.

4. **Report** a pass/fail line per journey step:
   - ✓ what passed
   - ✗ what failed (with the endpoint + expected vs. actual)

## Notes

- Keep the journey hermetic: point at a throwaway/test database and tear down any
  order the run creates so it is repeatable.
- The `disable-model-invocation: true` marker keeps this skill opt-in: it runs
  only when a workflow invokes it explicitly, never by autonomous model choice.
