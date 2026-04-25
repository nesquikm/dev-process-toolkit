"""Private-helpers fixture (tests _-prefixed filter)."""


def hello() -> str:
    """Public greeting."""
    return _greet("hi")


def _greet(prefix: str) -> str:
    return f"{prefix} world"


class _PrivateThing:
    def do_nothing(self) -> None:
        pass
