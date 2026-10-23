"""BuildWise AI load test: realistic user journeys (not one endpoint hammered).

Each virtual user logs in once (with a pre-created TEST account), then repeatedly does what a real user does:
look at the dashboard, open projects and estimates, browse the catalogue, recalculate an estimate, save a layout,
create/delete a project, and now and then generate a PDF report. Think time is 1-3 s between actions.

Run through run_load_tests.py (it starts the server, creates the test accounts and records CPU/memory/DB connections).
"""
from __future__ import annotations

import itertools
import json
import os
import random
from pathlib import Path

from locust import HttpUser, between, task

USERS = json.loads((Path(__file__).parent / "results" / "users.json").read_text())
_next = itertools.count()
THINK_MIN = float(os.environ.get("THINK_MIN", "1"))
THINK_MAX = float(os.environ.get("THINK_MAX", "3"))

NEW_PROJECT = {
    "name": "Load test house", "description": "", "owner_name": "LT", "building_type": "residential", "location": "Pune",
    "floors": 1, "currency": "INR", "budget": 2000000, "length": 10, "width": 8, "height": 3, "wall_thickness": 0.23, "slab_thickness": 0.15,
    "rooms": [
        {"name": "Living", "room_type": "living", "length": 5, "width": 4, "height": 3, "floor_number": 1, "doors": 1, "windows": 1, "pos_x": 0, "pos_y": 0},
        {"name": "Bed", "room_type": "bedroom", "length": 5, "width": 4, "height": 3, "floor_number": 1, "doors": 1, "windows": 1, "pos_x": 5, "pos_y": 0},
    ],
}


class BuildWiseUser(HttpUser):
    wait_time = between(THINK_MIN, THINK_MAX)

    def on_start(self):
        cred = USERS[next(_next) % len(USERS)]
        with self.client.post("/api/auth/login", json=cred, name="POST /auth/login", catch_response=True) as r:
            if r.status_code != 200:
                r.failure(f"login failed {r.status_code}")
                self.project_ids = []
                return
        self.project_ids = [p["id"] for p in self.client.get("/api/projects", name="GET /projects").json()]

    def _pid(self):
        return random.choice(self.project_ids) if self.project_ids else None

    @task(5)
    def dashboard(self):
        self.client.get("/api/dashboard", name="GET /dashboard")

    @task(5)
    def list_projects(self):
        self.client.get("/api/projects", name="GET /projects")

    @task(6)
    def open_project(self):
        pid = self._pid()
        if pid:
            self.client.get(f"/api/projects/{pid}", name="GET /projects/{id}")

    @task(6)
    def view_estimate(self):
        pid = self._pid()
        if pid:
            self.client.get(f"/api/projects/{pid}/estimate", name="GET /projects/{id}/estimate")

    @task(3)
    def catalogue(self):
        self.client.get("/api/materials", name="GET /materials")
        self.client.get("/api/prices", name="GET /prices")

    @task(2)
    def recalculate(self):
        pid = self._pid()
        if pid:
            self.client.post(f"/api/projects/{pid}/estimate", json={}, name="POST /projects/{id}/estimate (recalc)")

    @task(2)
    def reports(self):
        self.client.get("/api/reports", name="GET /reports")

    @task(1)
    def me(self):
        self.client.get("/api/auth/me", name="GET /auth/me")

    @task(1)
    def create_and_delete_project(self):
        with self.client.post("/api/projects", json=NEW_PROJECT, name="POST /projects (create)", catch_response=True) as r:
            if r.status_code != 201:
                r.failure(f"create failed {r.status_code}")
                return
            pid = r.json()["id"]
        self.client.delete(f"/api/projects/{pid}", name="DELETE /projects/{id}")

    @task(1)
    def generate_report(self):
        pid = self._pid()
        if pid:
            self.client.post(f"/api/projects/{pid}/report", name="POST /projects/{id}/report (PDF)")
