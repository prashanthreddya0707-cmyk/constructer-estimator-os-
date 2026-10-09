"""Unit conversions. The application stores everything in metres / square metres."""
from __future__ import annotations

M_PER_FT = 0.3048
SQM_PER_SQFT = M_PER_FT**2  # 0.09290304
MM_PER_M = 1000.0


def m_to_ft(m: float) -> float:
    return m / M_PER_FT


def ft_to_m(ft: float) -> float:
    return ft * M_PER_FT


def sqm_to_sqft(a: float) -> float:
    return a / SQM_PER_SQFT


def sqft_to_sqm(a: float) -> float:
    return a * SQM_PER_SQFT


def mm_to_m(mm: float) -> float:
    return mm / MM_PER_M


def m_to_mm(m: float) -> float:
    return m * MM_PER_M
