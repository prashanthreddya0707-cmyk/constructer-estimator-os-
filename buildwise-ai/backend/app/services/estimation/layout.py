"""Link between the saved 3D layout and the estimator.

The frontend saves a *summary* of the resolved openings together with a signature of the plan it was computed for.
The estimator only trusts that summary while the signature still matches the current rooms and dimensions, so an
edit made anywhere else (e.g. on the project page) can never leave stale openings in the estimate.

The signature format must stay identical to `planSignature()` in frontend/src/features/building-3d/layoutStore.ts.
"""
from __future__ import annotations

import math
from typing import Optional

from .models import OpeningInput


def _mm(v: float) -> int:
    # floor(v*1000 + 0.5): same arithmetic as Math.floor(v * 1000 + 0.5) in JavaScript (no banker's rounding)
    return int(math.floor(v * 1000 + 0.5))


def plan_signature(project, rooms) -> str:
    head = "|".join([str(_mm(project.length)), str(_mm(project.width)), str(project.floors), str(_mm(project.height)), str(_mm(project.wall_thickness))])
    parts = []
    for r in sorted(rooms, key=lambda r: r.id):
        px = "na" if r.pos_x is None else str(_mm(r.pos_x))
        pz = "na" if r.pos_y is None else str(_mm(r.pos_y))
        parts.append(":".join([r.id, px, pz, str(_mm(r.length)), str(_mm(r.width)), str(r.floor_number), str(r.doors), str(r.windows), r.room_type]))
    return head + "|" + ";".join(parts)


def openings_from_layout(layout: Optional[dict], project, rooms) -> Optional[list[OpeningInput]]:
    """Real openings from the saved layout, or None when there is no layout / it is out of date."""
    if not layout or layout.get("signature") != plan_signature(project, rooms):
        return None
    summary = layout.get("summary") or {}
    out: list[OpeningInput] = []
    for d in summary.get("doors", []):
        out.append(OpeningInput("door", float(d["w"]), float(d["h"]), bool(d.get("exterior", False))))
    for w in summary.get("windows", []):
        out.append(OpeningInput("window", float(w["w"]), float(w["h"]), True))
    return out
