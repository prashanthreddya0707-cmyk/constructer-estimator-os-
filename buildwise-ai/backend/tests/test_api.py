import copy
import io

from PIL import Image

from tests.conftest import PROJECT, make_user


def create(client, auth, **over):
    body = copy.deepcopy(PROJECT)
    body.update(over)
    r = client.post("/api/projects", json=body, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_auth_flow(client):
    r = client.post("/api/auth/signup", json={"email": "a@x.com", "full_name": "A", "password": "short"})
    assert r.status_code == 422
    r = client.post("/api/auth/signup", json={"email": "a@x.com", "full_name": "A", "password": "longenough1"})
    assert r.status_code == 201
    assert client.post("/api/auth/signup", json={"email": "A@x.com", "full_name": "A", "password": "longenough1"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "a@x.com", "password": "wrongpass1"}).status_code == 401
    ok = client.post("/api/auth/login", json={"email": "a@x.com", "password": "longenough1"}).json()
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {ok['access_token']}"})
    assert me.json()["email"] == "a@x.com"
    assert "password" not in me.text
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_project_create_retrieve_update_delete(client, auth):
    p = create(client, auth)
    assert p["room_count"] == 3 and p["floor_area"] == 80 and p["total_built_up_area"] == 160
    got = client.get(f"/api/projects/{p['id']}", headers=auth).json()
    assert len(got["rooms"]) == 3 and got["rooms"][0]["area"] > 0
    assert any(x["id"] == p["id"] for x in client.get("/api/projects", headers=auth).json())
    upd = {k: v for k, v in PROJECT.items() if k != "rooms"} | {"length": 12}
    assert client.put(f"/api/projects/{p['id']}", json=upd, headers=auth).json()["floor_area"] == 96
    assert client.delete(f"/api/projects/{p['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/projects/{p['id']}", headers=auth).status_code == 404


def test_validation_errors(client, auth):
    for bad in ({"length": 0}, {"width": -1}, {"floors": 0}, {"height": 0.5}, {"name": ""}):
        r = client.post("/api/projects", json=copy.deepcopy(PROJECT) | bad, headers=auth)
        assert r.status_code == 422, bad
        assert r.json()["error"]["code"] == "validation_error"
    rooms = copy.deepcopy(PROJECT["rooms"])
    rooms[0]["floor_number"] = 5
    assert client.post("/api/projects", json=copy.deepcopy(PROJECT) | {"rooms": rooms}, headers=auth).status_code == 422


def test_ownership_isolation(client):
    a, b = make_user(client), make_user(client)
    pid = create(client, a)["id"]
    rid = client.get(f"/api/projects/{pid}/rooms", headers=a).json()[0]["id"]
    for method, url in [("get", f"/api/projects/{pid}"), ("delete", f"/api/projects/{pid}"), ("get", f"/api/projects/{pid}/rooms"),
                        ("post", f"/api/projects/{pid}/estimate"), ("get", f"/api/projects/{pid}/estimate"),
                        ("post", f"/api/projects/{pid}/report"), ("get", f"/api/projects/{pid}/recommendations"),
                        ("delete", f"/api/projects/{pid}/rooms/{rid}")]:
        assert getattr(client, method)(url, headers=b).status_code == 404, (method, url)
    assert client.get("/api/projects", headers=b).json() == []
    assert client.get(f"/api/projects/{pid}", headers=a).status_code == 200


def test_rooms_crud(client, auth):
    pid = create(client, auth)["id"]
    r = client.post(f"/api/projects/{pid}/rooms", json={"name": "Store", "room_type": "store", "length": 2, "width": 2, "floor_number": 1}, headers=auth)
    assert r.status_code == 201
    rid = r.json()["id"]
    r = client.put(f"/api/projects/{pid}/rooms/{rid}", json={"name": "Store", "room_type": "store", "length": 3, "width": 2, "floor_number": 1}, headers=auth)
    assert r.json()["area"] == 6
    assert client.post(f"/api/projects/{pid}/rooms", json={"name": "X", "length": 2, "width": 2, "floor_number": 9}, headers=auth).status_code == 422
    assert client.delete(f"/api/projects/{pid}/rooms/{rid}", headers=auth).status_code == 204


def test_estimate_workflow_and_price_changes(client, auth):
    pid = create(client, auth)["id"]
    assert client.get(f"/api/projects/{pid}/estimate", headers=auth).status_code == 404
    est = client.post(f"/api/projects/{pid}/estimate", json={}, headers=auth).json()
    keys = {i["key"] for i in est["items"]}
    assert {"cement", "steel", "bricks", "tiles", "paint", "concrete"} <= keys
    assert est["summary"]["material_total"] > 0 and est["summary"]["complete"]
    assert est["summary"]["budget"] == 3000000
    assert any(i["price_is_sample"] for i in est["items"])
    # persisted & retrievable (workflow G)
    saved = client.get(f"/api/projects/{pid}/estimate", headers=auth).json()
    assert saved["summary"]["material_total"] == est["summary"]["material_total"]
    # change a price -> cost updates (workflow D)
    steel = next(i for i in est["items"] if i["key"] == "steel")
    r = client.post("/api/prices", json={"material_id": steel["material_id"], "unit_price": 100}, headers=auth)
    assert r.status_code == 201
    est2 = client.post(f"/api/projects/{pid}/estimate", json={}, headers=auth).json()
    steel2 = next(i for i in est2["items"] if i["key"] == "steel")
    assert steel2["unit_price"] == 100 and not steel2["price_is_sample"]
    assert est2["summary"]["material_total"] > est["summary"]["material_total"]
    # change a dimension -> quantities update (workflow C)
    upd = {k: v for k, v in PROJECT.items() if k != "rooms"} | {"length": 14}
    client.put(f"/api/projects/{pid}", json=upd, headers=auth)
    est3 = client.post(f"/api/projects/{pid}/estimate", json={}, headers=auth).json()
    assert next(i for i in est3["items"] if i["key"] == "concrete")["net_quantity"] > next(i for i in est2["items"] if i["key"] == "concrete")["net_quantity"]
    # another user's price override does not affect this user
    other = make_user(client)
    pid_o = create(client, other)["id"]
    o = client.post(f"/api/projects/{pid_o}/estimate", json={}, headers=other).json()
    assert next(i for i in o["items"] if i["key"] == "steel")["unit_price"] != 100


def test_scenario_preview_not_persisted(client, auth):
    pid = create(client, auth)["id"]
    base = client.post(f"/api/projects/{pid}/estimate", json={}, headers=auth).json()
    sc = client.post(f"/api/projects/{pid}/estimate", json={"wastage": {"steel": 50}}, headers=auth).json()
    assert sc["persisted"] is False
    assert next(i for i in sc["items"] if i["key"] == "steel")["wastage_pct"] == 50
    saved = client.get(f"/api/projects/{pid}/estimate", headers=auth).json()
    assert saved["summary"]["material_total"] == base["summary"]["material_total"]


def test_config_and_material_selection(client, auth):
    pid = create(client, auth)["id"]
    mats = client.get("/api/materials?estimate_key=cement", headers=auth).json()
    assert len(mats) >= 2 and all(m["price_is_sample"] for m in mats)
    other = [m for m in mats][1]
    r = client.put(f"/api/projects/{pid}/config", json={"material_selections": {"cement": other["id"]}, "wastage": {"tiles": 12},
                                                        "extra_costs": {"labour": {"enabled": True, "mode": "percent", "value": 25}}}, headers=auth)
    assert r.status_code == 200
    est = client.post(f"/api/projects/{pid}/estimate", json={}, headers=auth).json()
    assert next(i for i in est["items"] if i["key"] == "cement")["material_id"] == other["id"]
    assert est["summary"]["extras_total"] == est["summary"]["material_total"] * 0.25
    assert client.put(f"/api/projects/{pid}/config", json={"wastage": {"tiles": 140}}, headers=auth).status_code == 422


def test_materials_crud_and_csv(client, auth):
    r = client.post("/api/materials", json={"estimate_key": "cement", "name": "My Cement", "category": "Cement & Binders", "unit": "bag (50 kg)", "unit_price": 410, "supplier": "Local"}, headers=auth)
    assert r.status_code == 201
    m = r.json()
    assert m["editable"] and m["unit_price"] == 410 and not m["price_is_sample"]
    assert client.put(f"/api/materials/{m['id']}", json={"estimate_key": "cement", "name": "Renamed", "category": "Cement & Binders", "unit": "bag"}, headers=auth).json()["name"] == "Renamed"
    sample = client.get("/api/materials", headers=auth).json()[0]
    assert sample["is_sample"] and not sample["editable"]
    assert client.delete(f"/api/materials/{sample['id']}", headers=auth).status_code == 403
    assert client.delete(f"/api/materials/{m['id']}", headers=auth).status_code == 204
    other = make_user(client)
    assert all(x["name"] != "Renamed" for x in client.get("/api/materials", headers=other).json())
    csv = "estimate_key,name,category,brand,grade,unit,unit_price,supplier,location\ncement,Imported,Cement,B,G,bag,399,S,L\nbogus,Bad,x,,,bag,1,,\nsteel,Neg,x,,,kg,-3,,\n"
    res = client.post("/api/prices/import", files={"file": ("p.csv", csv, "text/csv")}, headers=auth).json()
    assert res["created"] == 1 and len(res["errors"]) == 2


def test_recommendations_endpoint(client, auth):
    pid = create(client, auth)["id"]
    client.put(f"/api/projects/{pid}/config", json={"wastage": {"tiles": 30}, "purchase_quantities": {"steel": 100000}}, headers=auth)
    recs = client.get(f"/api/projects/{pid}/recommendations", headers=auth).json()
    ids = {r["id"] for r in recs}
    assert "wastage-tiles" in ids and "purchase-steel" in ids and "sample-prices" in ids


def test_report_generation(client, auth):
    pid = create(client, auth)["id"]
    r = client.post(f"/api/projects/{pid}/report", headers=auth)
    assert r.status_code == 201, r.text
    rep = r.json()
    assert rep["size_bytes"] > 5000 and rep["total_cost"] > 0
    dl = client.get(f"/api/reports/{rep['id']}/download", headers=auth)
    assert dl.status_code == 200 and dl.headers["content-type"] == "application/pdf"
    assert dl.content.startswith(b"%PDF") and b"%%EOF" in dl.content[-1024:]
    assert client.get(f"/api/reports/{rep['id']}/download", headers=make_user(client)).status_code == 404
    assert any(x["id"] == rep["id"] for x in client.get("/api/reports", headers=auth).json())


def test_report_many_rooms_paginates(client, auth):
    rooms = [{"name": f"Room {i}", "room_type": "other", "length": 3, "width": 3, "floor_number": 1, "doors": 1, "windows": 1} for i in range(120)]
    pid = create(client, auth, rooms=rooms, floors=1)["id"]
    rep = client.post(f"/api/projects/{pid}/report", headers=auth).json()
    pdf = client.get(f"/api/reports/{rep['id']}/download", headers=auth).content
    assert pdf.count(b"/Type /Page\n") + pdf.count(b"/Type /Page ") >= 3 or pdf.count(b"/Type /Page") >= 4


def png_bytes(size=(200, 100)):
    buf = io.BytesIO()
    im = Image.new("RGB", size, "white")
    for x in range(20, 180):
        im.putpixel((x, 20), (0, 0, 0)); im.putpixel((x, 80), (0, 0, 0))
    im.save(buf, "PNG")
    return buf.getvalue()


def test_floorplan_upload_calibrate_analyze(client, auth):
    pid = create(client, auth)["id"]
    url = f"/api/projects/{pid}/floorplans"
    assert client.post(url, files={"file": ("x.exe", b"MZ", "application/octet-stream")}, headers=auth).status_code == 422
    assert client.post(url, files={"file": ("fake.png", b"not an image", "image/png")}, headers=auth).status_code == 422
    assert client.post(url, files={"file": ("e.png", b"", "image/png")}, headers=auth).status_code == 422
    r = client.post(url, files={"file": ("plan.png", png_bytes(), "image/png")}, headers=auth)
    assert r.status_code == 201, r.text
    fp = r.json()
    assert fp["width_px"] == 200
    assert client.get(f"/api/floorplans/{fp['id']}/file", headers=auth).content == png_bytes()
    cal = client.put(f"/api/floorplans/{fp['id']}/calibration", json={"x1": 0, "y1": 0, "x2": 100, "y2": 0, "real_length_m": 5}, headers=auth).json()
    assert abs(cal["scale_m_per_px"] - 0.05) < 1e-9
    assert client.put(f"/api/floorplans/{fp['id']}/calibration", json={"x1": 5, "y1": 5, "x2": 5, "y2": 5, "real_length_m": 5}, headers=auth).status_code == 422
    an = client.post(f"/api/floorplans/{fp['id']}/analyze", headers=auth)
    assert an.status_code == 200 and "disclaimer" in an.json()
    other = make_user(client)
    assert client.get(f"/api/floorplans/{fp['id']}/file", headers=other).status_code == 404
    assert client.get(f"/api/projects/{pid}", headers=auth).json()["floorplans"][0]["id"] == fp["id"]
    pdf = client.post(url, files={"file": ("p.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")}, headers=auth)
    assert pdf.status_code == 201
    assert client.put(f"/api/floorplans/{pdf.json()['id']}/calibration", json={"x1": 0, "y1": 0, "x2": 9, "y2": 0, "real_length_m": 1}, headers=auth).status_code == 422
    assert client.delete(f"/api/floorplans/{fp['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/floorplans/{fp['id']}/file", headers=auth).status_code == 404


def test_demo_and_dashboard(client):
    u = make_user(client)
    d = client.get("/api/dashboard", headers=u).json()
    assert d["total_projects"] == 0 and d["avg_cost_per_sqft"] is None
    client.post("/api/demo/seed", headers=u)
    d = client.get("/api/dashboard", headers=u).json()
    assert d["total_projects"] == 1 and d["has_demo_data"] and d["saved_estimates"] == 1
    assert d["total_estimated_cost"] > 0 and d["cost_distribution"] and d["material_quantities"]
