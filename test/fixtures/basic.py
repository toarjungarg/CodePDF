"""A small weather log, in plain Python.

This docstring spans several lines and has a # that is not a comment.
"""

import re
from dataclasses import dataclass

MAX_READINGS = 1_000
MASK = 0xFF
SCALE = 3.14e-2
HALF = .5
PATTERN = re.compile(r"^(\w+):\s*(-?\d+\.\d+)$")  # raw string, then a comment


@dataclass
class Reading:
    city: str
    celsius: float

    @property
    def is_cold(self) -> bool:
        return self.celsius < 0.0

    @staticmethod
    def parse(line: str) -> "Reading | None":
        match = PATTERN.match(line)  # "match" is just a name here
        if match is None:
            return None
        return Reading(match.group(1), float(match.group(2)))


def describe(reading: Reading) -> str:
    match reading.city:
        case "Waterloo" | 'Toronto':
            where = "Ontario"
        case _:
            where = "elsewhere"
    label = f"{reading.city!r} ({where}): {reading.celsius:.1f} C"
    return label + f" {{cold}}" if reading.is_cold else label


def summary(readings: list[Reading]) -> dict[str, float]:
    total = sum(r.celsius for r in readings)
    lookup = {"count": len(readings), "mean": total / max(len(readings), 1)}
    print(f"mean is {lookup['mean']:>8.2f} over {len(readings)} reading(s)")
    return lookup


if __name__ == "__main__":
    lines = ["Waterloo: -3.25", 'Ottawa: 21.5', b"bytes".decode(), "bad line"]
    parsed = [r for r in map(Reading.parse, lines) if r is not None]
    for reading in parsed:
        print(describe(reading))
    type = "weather"  # "type" is just a name here
    matrix = [[1, 2], [3, 4]]
    summary(parsed)
