# Python Gate Commands

## Gate Check Commands

```bash
mypy .               # Type checking (or pyright)
ruff check .         # Lint (with --fix for auto-fix)
ruff format --check . # Format check
pytest               # Run all tests
```

## TDD Patterns

- **Test runner:** pytest
- **Mocking:** unittest.mock / pytest-mock
- **Fixtures:** pytest fixtures (conftest.py)
- **Test location:** `tests/` mirroring `src/` structure
- **File naming:** `test_*.py` or `*_test.py`
- **Coverage:** pytest-cov (`pytest --cov=src`)

## Key Conventions

- Use virtual environment (venv, poetry, uv)
- Type hints on all public functions
- Pydantic for data validation (similar role to Zod)
- `pyproject.toml` for project config

## Settings Example

> Cross-reference: the canonical-shape probe at `adapters/_shared/src/setup_permissions_shape.ts` empirically rejects glob-form `Bash(<cmd> *)` rules; the canonical allowlist lives in `templates/permissions.json` — both are the source of truth for the block below.

```json
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git log)",
      "Bash(git show)",
      "Bash(git rev-parse)",
      "Bash(git ls-files)",
      "Bash(git branch)",
      "Bash(git blame)",
      "Bash(gh pr list)",
      "Bash(gh pr view)",
      "Bash(gh issue list)",
      "Bash(gh issue view)",
      "Bash(gh repo view)",
      "Bash(gh api)",
      "Bash(ls)",
      "Bash(mkdir)",
      "Bash(uv sync)",
      "Bash(uv run)",
      "Bash(uv --version)",
      "Bash(python)",
      "Bash(python3)",
      "Bash(pytest)"
    ]
  }
}
```
