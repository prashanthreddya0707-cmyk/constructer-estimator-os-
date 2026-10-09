import math

import pytest

from app.services.estimation import calculators as c
from app.services.estimation import units
from app.services.estimation.models import EstimationError


def test_floor_area():
    assert c.floor_area(10, 8) == 80
    assert c.floor_area(3.5, 2) == pytest.approx(7.0)


def test_concrete_volume():
    assert c.concrete_volume(10, 8, 0.15) == pytest.approx(12.0)


def test_tile_count_ceiling():
    # 20 m2 / 0.36 m2 = 55.55 -> 56
    assert c.tile_count(20, 0.6, 0.6) == 56
    # exact multiples must not round up due to float noise
    assert c.tile_count(36, 0.6, 0.6) == 100
    assert c.tile_count(0, 0.6, 0.6) == 0


def test_paint_quantity():
    assert c.paint_quantity(100, 2, 10) == pytest.approx(20)


def test_brick_count_with_mortar_joint():
    eff = c.effective_unit_volume(0.19, 0.09, 0.09, 0.01)
    assert eff == pytest.approx(0.20 * 0.10 * 0.10)
    # 1 m3 of masonry => 1/0.002 = 500 bricks
    assert c.masonry_unit_count(1.0, 0.19, 0.09, 0.09, 0.01) == 500


def test_mortar_volume_nonnegative():
    n = c.masonry_unit_count(1.0, 0.19, 0.09, 0.09, 0.01)
    v = c.mortar_wet_volume(1.0, n, 0.19, 0.09, 0.09)
    assert v == pytest.approx(1.0 - 500 * 0.19 * 0.09 * 0.09)
    assert c.mortar_wet_volume(0.0, 100, 0.19, 0.09, 0.09) == 0.0


def test_material_cost():
    assert c.material_cost(12.5, 400) == 5000


def test_wastage():
    assert c.apply_wastage(100, 5) == pytest.approx(105)
    assert c.apply_wastage(100, 0) == 100
    with pytest.raises(EstimationError):
        c.apply_wastage(100, -1)
    with pytest.raises(EstimationError):
        c.apply_wastage(100, 150)


@pytest.mark.parametrize("bad", [0, -1, None, float("nan")])
def test_invalid_dimensions(bad):
    with pytest.raises(EstimationError):
        c.floor_area(bad, 5)
    with pytest.raises(EstimationError):
        c.concrete_volume(5, 5, bad)


def test_negative_price_or_quantity_rejected():
    with pytest.raises(EstimationError):
        c.material_cost(-1, 10)
    with pytest.raises(EstimationError):
        c.material_cost(1, -10)
    with pytest.raises(EstimationError):
        c.paint_quantity(10, 0, 10)
    with pytest.raises(EstimationError):
        c.tile_count(10, 0, 0.6)


def test_binder_split():
    bags, (sand, agg) = c.binder_split(5.5, (1, 1.5, 3), 1440, 50)
    assert bags == pytest.approx(1.0 * 1440 / 50)
    assert sand == pytest.approx(1.5)
    assert agg == pytest.approx(3.0)


def test_unit_conversions():
    assert units.m_to_ft(0.3048) == pytest.approx(1.0)
    assert units.ft_to_m(10) == pytest.approx(3.048)
    assert units.sqm_to_sqft(1) == pytest.approx(10.7639, rel=1e-4)
    assert units.sqft_to_sqm(units.sqm_to_sqft(37.5)) == pytest.approx(37.5)
    assert units.mm_to_m(230) == pytest.approx(0.23)
    assert units.m_to_mm(0.012) == pytest.approx(12)
