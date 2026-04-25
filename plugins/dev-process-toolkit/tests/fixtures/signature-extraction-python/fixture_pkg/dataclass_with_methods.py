"""Dataclass-with-methods fixture."""

from dataclasses import dataclass


@dataclass
class Container:
    """A typed container with methods."""

    value: int

    def doubled(self) -> int:
        """Return value doubled."""
        return self.value * 2
