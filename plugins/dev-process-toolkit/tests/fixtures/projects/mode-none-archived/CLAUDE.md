# Archive-Heavy Fixture

Real-shape `mode: none` project with substantial archive content.
This file intentionally omits any `## Task Tracking` section — absence
is the canonical form for `mode: none` (FR-29 AC-29.5).

## Tech Stack

- **Language:** Python 3.12
- **Framework:** FastAPI
- **Build:** uv
- **Testing:** pytest

## Architecture

```
src/
├── api/
│   └── routes.py
└── core/
    └── service.py
tests/
└── test_routes.py
```

## Key Commands

```bash
uv run ruff check
uv run pytest
```

**Gating rule:** `uv run ruff check && uv run pytest`

## DO NOT

- Do not commit without user approval
- Do not add features not in the spec
