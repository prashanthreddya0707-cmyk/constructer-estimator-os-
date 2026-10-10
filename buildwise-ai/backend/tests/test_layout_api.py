import copy
import io
import sqlite3

from PIL import Image, ImageDraw

from app.services.estimation.layout import plan_signature
from tests.conftest import PROJECT, make_user


def create(client, auth, **over):
    body = copy.deepcopy(PROJECT)
    body.update(over)
    r = client.post("/api/projects", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


class _P:  # minimal stand-ins for the signature helper
    def __init__(self, d):
        self.__dict__.update(d)


def sig_for(project_json):
    rooms = [_P(r) for r in project_json["rooms"]]
    return plan_signature(_P(project_json), rooms)


def test_bulk_replace_rooms(client, auth):
    p = create(client, auth)
    new = [{"name": "A", "room_type": "living", "length": 5, "width": 4, "floor_number": 1, "doors": 1, "windows": 1, "pos_x": 0, "pos_y": 0},
           {"name": "B", "room_type": "bedroom", "length": 5, "width": 4, "floor_number": 2, "doors": 1, "windows": 1, "pos_x": 0, "pos_y": 0}]
    r = client.put(f"/api/projects/{p['id']}/rooms", json={"rooms": new}, headers=auth)
    assert r.status_code == 200 and [x["name"] for x in r.json()] == ["A", "B"]
    got = client.get(f"/api/projects/{p['id']}", headers=auth).json()
    assert len(got["rooms"]) == 2 and got["layout"] is None
    bad = [{**new[0], "floor_number": 9}]
    assert client.put(f"/api/projects/{p['id']}/rooms", json={"rooms": bad}, headers=auth).status_code == 422
    assert len(client.get(f"/api/projects/{p['id']}", headers=auth).json()["rooms"]) == 2  # failed replace changed nothing
    other = make_user(client)
    assert client.put(f"/api/projects/{p['id']}/rooms", json={"rooms": new}, headers=other).status_code == 404


def layout_body(project_json, doors, windows):
    return {
        "version": 1, "signature": sig_for(project_json), "settings": {"autoFurnish": True},
        "openings": None, "furniture": {"items": [{"id": "f1", "room_id": "r", "type": "sofa", "cx": 1, "cz": 1, "w": 2, "d": 0.9, "facing": "N"}], "room_sigs": {"r": "x"}},
        "summary": {"doors": doors, "windows": windows},
    }


def test_layout_saved_reloaded_and_used_by_estimate(client, auth):
    p = create(client, auth)
    base = client.post(f"/api/projects/{p['id']}/estimate", json={}, headers=auth).json()
    assert base["geometry"]["openings_source"].startswith("estimated")
    est_bricks = next(i for i in base["items"] if i["key"] == "bricks")["net_quantity"]
    # a layout with no openings at all must raise the masonry quantity
    r = client.put(f"/api/projects/{p['id']}/layout", json=layout_body(p, [], []), headers=auth)
    assert r.status_code == 200 and r.json()["layout"]["furniture"]["items"][0]["type"] == "sofa"  # persisted & restored
    again = client.get(f"/api/projects/{p['id']}", headers=auth).json()
    assert again["layout"]["settings"]["autoFurnish"] is True
    e2 = client.post(f"/api/projects/{p['id']}/estimate", json={}, headers=auth).json()
    assert e2["geometry"]["openings_source"] == "saved 3D layout"
    assert next(i for i in e2["items"] if i["key"] == "bricks")["net_quantity"] > est_bricks
    # big openings reduce masonry; exterior ones come off the external walls
    big = layout_body(p, [{"w": 1.0, "h": 2.1, "exterior": True}] * 3, [{"w": 1.2, "h": 1.2}] * 6)
    client.put(f"/api/projects/{p['id']}/layout", json=big, headers=auth)
    e3 = client.post(f"/api/projects/{p['id']}/estimate", json={}, headers=auth).json()
    assert next(i for i in e3["items"] if i["key"] == "bricks")["net_quantity"] < next(i for i in e2["items"] if i["key"] == "bricks")["net_quantity"]
    assert e3["geometry"]["door_count"] == 3 and e3["geometry"]["window_count"] == 6


def test_stale_layout_is_ignored_by_estimate(client, auth):
    p = create(client, auth)
    client.put(f"/api/projects/{p['id']}/layout", json=layout_body(p, [], []), headers=auth)
    rid = p["rooms"][0]["id"]
    room = {k: v for k, v in p["rooms"][0].items() if k not in ("id", "project_id", "area")}
    room["length"] = room["length"] + 1  # edit a room after the layout was saved
    client.put(f"/api/projects/{p['id']}/rooms/{rid}", json=room, headers=auth)
    e = client.post(f"/api/projects/{p['id']}/estimate", json={}, headers=auth).json()
    assert e["geometry"]["openings_source"].startswith("estimated")


def test_layout_validation_and_reset_and_ownership(client, auth):
    p = create(client, auth)
    bad = layout_body(p, [], [])
    bad["openings"] = [{"id": "o", "kind": "door", "floor": 1, "orientation": "q", "line": 0, "center": 0, "width": 0.9, "height": 2.1, "sill": 0, "room_id": "r"}]
    assert client.put(f"/api/projects/{p['id']}/layout", json=bad, headers=auth).status_code == 422
    huge = layout_body(p, [], [])
    huge["furniture"]["items"] = [huge["furniture"]["items"][0]] * 1600
    assert client.put(f"/api/projects/{p['id']}/layout", json=huge, headers=auth).status_code == 422
    other = make_user(client)
    assert client.put(f"/api/projects/{p['id']}/layout", json=layout_body(p, [], []), headers=other).status_code == 404
    client.put(f"/api/projects/{p['id']}/layout", json=layout_body(p, [], []), headers=auth)
    assert client.delete(f"/api/projects/{p['id']}/layout", headers=auth).json()["layout"] is None


def test_old_database_gets_layout_column(tmp_path, monkeypatch):
    """A database created before the `layout` column existed is upgraded in place, keeping its data."""
    import importlib
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE projects (id VARCHAR(36) PRIMARY KEY, name VARCHAR(160))")
    con.execute("INSERT INTO projects VALUES ('p1', 'Old project')")
    con.commit(); con.close()
    from sqlalchemy import create_engine, inspect
    import app.core.db as dbmod
    monkeypatch.setattr(dbmod, "engine", create_engine(f"sqlite:///{db}"))
    dbmod._ensure_columns()
    dbmod._ensure_columns()  # idempotent
    cols = {c["name"] for c in inspect(dbmod.engine).get_columns("projects")}
    assert "layout" in cols
    with dbmod.engine.connect() as c:
        assert c.exec_driver_sql("SELECT name FROM projects").scalar() == "Old project"
    importlib.reload(dbmod) if False else None


def test_signature_matches_between_languages():
    """Golden value shared with the frontend test (layoutStore.test.ts)."""
    room = _P({"id": "a", "pos_x": 1.0625, "pos_y": None, "length": 4.0, "width": 3.5, "floor_number": 1, "doors": 1, "windows": 2, "room_type": "bedroom"})
    proj = _P({"length": 10, "width": 8, "floors": 1, "height": 3, "wall_thickness": 0.23})
    assert plan_signature(proj, [room]) == "10000|8000|1|3000|230|a:1063:na:4000:3500:1:1:2:bedroom"


def plan_png(with_text=True):
    im = Image.new("RGB", (800, 600), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([60, 60, 740, 540], outline="black", width=8)
    d.rectangle([396, 64, 404, 250], fill="black"); d.rectangle([396, 300, 404, 536], fill="black")  # vertical wall, door gap 250-300
    d.rectangle([64, 296, 250, 304], fill="black"); d.rectangle([300, 296, 400, 304], fill="black")  # horizontal wall, door gap 250-300
    if with_text:
        d.text((150, 150), "LIVING ROOM 5.0 x 4.0", fill="black")
        d.text((500, 300), "BEDROOM", fill="black")
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


def test_detect_rooms_on_synthetic_plan(client, auth):
    p = create(client, auth)
    fp = client.post(f"/api/projects/{p['id']}/floorplans", files={"file": ("plan.png", plan_png(), "image/png")}, headers=auth).json()
    r = client.post(f"/api/floorplans/{fp['id']}/detect-rooms", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    rooms = body["rooms"]
    assert len(rooms) == 3, rooms
    assert "disclaimer" in body and body["overlay_png_base64"]
    boxes = sorted((x["x"], x["y"], x["w"], x["h"]) for x in rooms)
    expected = sorted([(60, 60, 340, 240), (60, 300, 340, 240), (400, 60, 340, 480)])
    for got, exp in zip(boxes, expected):
        assert all(abs(g - e) <= 30 for g, e in zip(got, exp)), (got, exp)
    assert all(x["rectangular"] for x in rooms)
    other = make_user(client)
    assert client.post(f"/api/floorplans/{fp['id']}/detect-rooms", headers=other).status_code == 404
    blank = Image.new("RGB", (300, 300), "white"); b = io.BytesIO(); blank.save(b, "PNG")
    fp2 = client.post(f"/api/projects/{p['id']}/floorplans", files={"file": ("blank.png", b.getvalue(), "image/png")}, headers=auth).json()
    none = client.post(f"/api/floorplans/{fp2['id']}/detect-rooms", headers=auth).json()
    assert none["rooms"] == [] and none["warnings"]
    pdf = client.post(f"/api/projects/{p['id']}/floorplans", files={"file": ("p.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")}, headers=auth).json()
    assert client.post(f"/api/floorplans/{pdf['id']}/detect-rooms", headers=auth).status_code == 422


def test_layout_accepts_realistic_ids(client, auth):
    """Ids the Studio really generates: room UUID + ':' + type + ':' + n (longer than 48 characters)."""
    p = create(client, auth)
    rid = p["rooms"][0]["id"]
    body = layout_body(p, [{"w": 0.9, "h": 2.1, "exterior": False}], [{"w": 1.2, "h": 1.2}])
    body["furniture"] = {"items": [{"id": f"{rid}:bed_double:1", "room_id": rid, "type": "bed_double", "cx": 2.0, "cz": 1.5, "w": 1.55, "d": 2.0, "facing": "W"}], "room_sigs": {rid: "0:0:4000:3000:1:bedroom"}}
    body["furniture"]["items"].append({"id": f"{rid}:mirror:1", "room_id": rid, "type": "mirror", "cx": 1.0, "cz": 0.1, "w": 0.6, "d": 0.04, "facing": "N"})
    body["openings"] = [{"id": "n9fk3x2ab", "kind": "window", "floor": 1, "orientation": "x", "line": 0.0, "center": 2.0, "width": 1.2, "height": 1.2, "sill": 0.9, "room_id": rid, "into": 1, "entrance": False}]
    r = client.put(f"/api/projects/{p['id']}/layout", json=body, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["layout"]["furniture"]["items"][0]["id"].endswith(":bed_double:1")
