import pytest

from app.services.estimation import Assumptions, BuildingInput, EstimationError, RoomInput, compute_quantities
from app.services.optimization.engine import OptimizationContext, generate_recommendations
from app.services.pricing.costing import PriceInfo, apply_prices, summarize


def building(floors=1, rooms=None, **kw):
    base = dict(length=10, width=8, height=3, floors=floors, wall_thickness=0.23, slab_thickness=0.15, rooms=rooms or [])
    base.update(kw)
    return BuildingInput(**base)


def item(items, key):
    return next(i for i in items if i.key == key)


def test_slab_concrete_and_steel():
    geo, items, _ = compute_quantities(building())
    assert geo.floor_area == 80
    conc = item(items, "concrete")
    assert conc.net_quantity == pytest.approx(80 * 0.15)
    assert item(items, "steel").net_quantity == pytest.approx(12 * 80)  # 80 kg/m3 default


def test_multi_floor_areas_not_double_counted():
    one = compute_quantities(building(floors=1))
    three = compute_quantities(building(floors=3))
    assert three[0].total_built_up_area == 240
    assert item(three[1], "concrete").net_quantity == pytest.approx(3 * item(one[1], "concrete").net_quantity)
    assert item(three[1], "bricks").net_quantity == pytest.approx(3 * item(one[1], "bricks").net_quantity)  # external walls only


def test_manual_area_override_affects_slab_not_perimeter():
    geo, items, _ = compute_quantities(building(built_up_area=70))
    assert geo.floor_area == 70
    assert item(items, "concrete").net_quantity == pytest.approx(70 * 0.15)
    assert geo.external_perimeter == 36


def test_shared_internal_walls_counted_once():
    # Two 5x8 rooms side by side fill the 10x8 floor: one shared 8 m wall.
    rooms = [RoomInput("A", "living", 5, 8, 3), RoomInput("B", "bedroom", 5, 8, 3)]
    geo, _, _ = compute_quantities(building(rooms=rooms))
    assert geo.internal_wall_length_per_floor == pytest.approx(8.0)


def test_openings_reduce_masonry():
    base = [RoomInput("A", "living", 5, 8, 3), RoomInput("B", "bedroom", 5, 8, 3)]
    with_open = [RoomInput("A", "living", 5, 8, 3, doors=2, windows=3), RoomInput("B", "bedroom", 5, 8, 3, doors=1, windows=2)]
    n0 = item(compute_quantities(building(rooms=base))[1], "bricks").net_quantity
    n1 = item(compute_quantities(building(rooms=with_open))[1], "bricks").net_quantity
    assert n1 < n0


def test_wastage_net_vs_gross_and_override():
    _, items, _ = compute_quantities(building(), wastage={"steel": 10})
    s = item(items, "steel")
    assert s.wastage_pct == 10
    assert s.gross_quantity == pytest.approx(s.net_quantity * 1.1)


def test_tiles_use_room_area():
    rooms = [RoomInput("A", "living", 6, 6, 3)]
    _, items, _ = compute_quantities(building(rooms=rooms), wastage={"tiles": 0})
    assert item(items, "tiles").gross_quantity == 100  # 36 m2 / 0.36


def test_blocks_selected_replaces_bricks():
    a = Assumptions(external_masonry="block", internal_masonry="block")
    _, items, _ = compute_quantities(building(), a)
    assert all(i.key != "bricks" for i in items)
    assert item(items, "blocks").net_quantity > 0


def test_ready_mix_removes_constituents_from_concrete():
    site = item(compute_quantities(building())[1], "aggregates").net_quantity
    rm = item(compute_quantities(building(), Assumptions(concrete_supply="ready_mix"))[1], "aggregates").net_quantity
    assert site > 0 and rm == 0


@pytest.mark.parametrize("kw", [dict(length=0), dict(width=-2), dict(height=0), dict(slab_thickness=-0.1), dict(floors=0), dict(wall_thickness=0)])
def test_invalid_building_rejected(kw):
    with pytest.raises(EstimationError):
        compute_quantities(building(**kw))


def test_room_on_invalid_floor_rejected():
    with pytest.raises(EstimationError):
        compute_quantities(building(rooms=[RoomInput("A", "living", 3, 3, 3, floor_number=2)]))


def test_missing_rooms_warns():
    _, _, warns = compute_quantities(building())
    assert any("No rooms" in w for w in warns)


def costed(prices=None, **kw):
    _, items, w = compute_quantities(building(**kw))
    lookup = {k: PriceInfo(f"id-{k}", k, v) for k, v in (prices or {}).items()}
    apply_prices(items, lookup)
    return items, w


def test_cost_is_quantity_times_price_and_missing_prices_flagged():
    items, _ = costed({"steel": 60.0})
    steel = item(items, "steel")
    assert steel.cost == pytest.approx(steel.gross_quantity * 60)
    summary = summarize(items, 80, None, None)
    assert "cement" in summary["missing_price_keys"]
    assert not summary["complete"]
    assert summary["material_total"] == pytest.approx(steel.cost)  # only priced lines


def test_quantity_only_lines_not_double_counted():
    prices = {i: 10.0 for i in ["cement", "sand", "aggregates", "steel", "concrete", "bricks", "mortar", "plaster", "tiles", "paint"]}
    items, _ = costed(prices)
    summary = summarize(items, 80, None, None)
    expected = sum(i.cost for i in items if i.key not in ("concrete", "mortar", "plaster"))
    assert summary["material_total"] == pytest.approx(expected)


def test_extras_only_when_enabled_and_populated():
    items, _ = costed({k: 10.0 for k in ["cement", "sand", "aggregates", "steel", "bricks", "tiles", "paint"]})
    base = summarize(items, 80, None, None)["material_total"]
    s = summarize(items, 80, None, {"labour": {"enabled": False, "mode": "percent", "value": 20},
                                    "contingency": {"enabled": True, "mode": "percent", "value": 0},
                                    "transportation": {"enabled": True, "mode": "fixed", "value": 5000}})
    assert s["extras_total"] == 5000
    assert s["project_total"] == pytest.approx(base + 5000)
    assert s["material_total"] == pytest.approx(base)  # materials kept separate


def test_cost_per_area_and_budget_variance():
    items, _ = costed({k: 10.0 for k in ["cement", "sand", "aggregates", "steel", "bricks", "tiles", "paint"]})
    s = summarize(items, 80, 1_000_000, None)
    assert s["cost_per_sqm"] == pytest.approx(s["material_total"] / 80)
    assert s["cost_per_sqft"] == pytest.approx(s["material_total"] / (80 / 0.09290304))
    assert s["budget_variance"] == pytest.approx(1_000_000 - s["project_total"])


def test_recommendations_are_data_driven():
    items, warns = costed({"steel": 60.0}, rooms=[])
    summary = summarize(items, 80, 10.0, None)
    from dataclasses import asdict
    ctx = OptimizationContext([asdict(i) for i in items], summary, warns, "INR", False, False, 10.0, {"steel": 3000.0}, {})
    recs = {r["id"] for r in generate_recommendations(ctx)}
    assert {"missing-rooms", "missing-prices", "over-budget", "purchase-steel", "verify-tiles"} <= recs
    for r in generate_recommendations(ctx):
        for field in ("title", "explanation", "reason", "suggested_action", "potential_benefit"):
            assert r[field]


def test_savings_only_with_prices_and_quantities():
    _, items, warns = compute_quantities(building(), wastage={"steel": 20})
    from dataclasses import asdict
    ctx = OptimizationContext([asdict(i) for i in items], summarize(items, 80, None, None), warns, "INR", False, False, None, {}, {})
    wr = next(r for r in generate_recommendations(ctx) if r["id"] == "wastage-steel")
    assert wr["potential_savings"] is None  # no price -> no invented savings
