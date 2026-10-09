import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="buildwise-test-")
os.environ["DATA_DIR"] = _tmp
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789abcdef"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


_counter = {"n": 0}


def make_user(client):
    _counter["n"] += 1
    email = f"user{_counter['n']}@example.com"
    r = client.post("/api/auth/signup", json={"email": email, "full_name": "Test User", "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def auth(client):
    return make_user(client)


PROJECT = {
    "name": "Test House", "description": "d", "owner_name": "Owner", "building_type": "residential", "location": "Pune",
    "floors": 2, "currency": "INR", "budget": 3000000, "length": 10, "width": 8, "height": 3,
    "wall_thickness": 0.23, "slab_thickness": 0.15,
    "rooms": [
        {"name": "Living", "room_type": "living", "length": 5, "width": 4, "height": 3, "floor_number": 1, "doors": 2, "windows": 2},
        {"name": "Bedroom", "room_type": "bedroom", "length": 4, "width": 3.5, "height": 3, "floor_number": 1, "doors": 1, "windows": 1},
        {"name": "Bath", "room_type": "bathroom", "length": 2, "width": 1.5, "height": 3, "floor_number": 2, "doors": 1, "windows": 1},
    ],
}
