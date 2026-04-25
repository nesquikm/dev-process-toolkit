"""Protocol + type-alias fixture (PEP 544 + PEP 695 surface)."""

from typing import Protocol, TypeAlias

UserId: TypeAlias = int
"""Module-level type alias for a user id."""


class Greeter(Protocol):
    """Anything that can greet."""

    def greet(self, name: str) -> str:
        ...
