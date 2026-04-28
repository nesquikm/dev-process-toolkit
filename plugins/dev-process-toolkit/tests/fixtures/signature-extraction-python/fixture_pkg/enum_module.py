"""Enum-module fixture."""

from enum import Enum


class Light(Enum):
    """Traffic-light states."""

    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"
