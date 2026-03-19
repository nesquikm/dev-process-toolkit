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

```json
{
  "permissions": {
    "allow": [
      "Bash(python *)",
      "Bash(pytest *)",
      "Bash(mypy *)",
      "Bash(ruff *)",
      "Bash(pip *)",
      "Bash(uv *)",
      "Bash(git *)",
      "Bash(gh *)"
    ]
  }
}
```
