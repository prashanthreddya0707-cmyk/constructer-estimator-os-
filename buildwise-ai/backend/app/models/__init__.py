"""SQLAlchemy models. IDs are UUID strings for portability (SQLite now, PostgreSQL later)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    owner_name: Mapped[str] = mapped_column(String(120), default="")
    building_type: Mapped[str] = mapped_column(String(40), default="residential")
    location: Mapped[str] = mapped_column(String(160), default="")
    floors: Mapped[int] = mapped_column(Integer, default=1)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Building dimensions (metres)
    length: Mapped[float] = mapped_column(Float)
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float, default=3.0)
    wall_thickness: Mapped[float] = mapped_column(Float, default=0.23)
    slab_thickness: Mapped[float] = mapped_column(Float, default=0.15)
    built_up_area: Mapped[float | None] = mapped_column(Float, nullable=True)  # manual override
    # Estimation configuration (kept as JSON; defaults applied by the engine)
    assumptions: Mapped[dict] = mapped_column(JSON, default=dict)
    wastage: Mapped[dict] = mapped_column(JSON, default=dict)
    material_selections: Mapped[dict] = mapped_column(JSON, default=dict)  # estimate key -> material id
    extra_costs: Mapped[dict] = mapped_column(JSON, default=dict)
    purchase_quantities: Mapped[dict] = mapped_column(JSON, default=dict)
    # Saved 3D/2D layout: custom openings, furniture arrangement, settings and a summary used by the estimator.
    layout: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    owner = relationship("User", back_populates="projects")
    rooms = relationship("Room", back_populates="project", cascade="all, delete-orphan", order_by="Room.floor_number, Room.created_at")
    floorplans = relationship("FloorPlan", back_populates="project", cascade="all, delete-orphan")
    estimates = relationship("Estimate", back_populates="project", cascade="all, delete-orphan", order_by="Estimate.created_at.desc()")
    reports = relationship("Report", back_populates="project", cascade="all, delete-orphan", order_by="Report.created_at.desc()")


class Room(Base):
    __tablename__ = "project_rooms"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    room_type: Mapped[str] = mapped_column(String(40), default="other")
    length: Mapped[float] = mapped_column(Float)
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float, default=3.0)
    floor_number: Mapped[int] = mapped_column(Integer, default=1)
    wall_thickness: Mapped[float | None] = mapped_column(Float, nullable=True)
    doors: Mapped[int] = mapped_column(Integer, default=0)
    windows: Mapped[int] = mapped_column(Integer, default=0)
    area_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    pos_x: Mapped[float | None] = mapped_column(Float, nullable=True)  # optional layout (m, from building corner)
    pos_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    project = relationship("Project", back_populates="rooms")


class FloorPlan(Base):
    __tablename__ = "floor_plan_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(255))  # file lives in storage, not in the DB
    width_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scale_m_per_px: Mapped[float | None] = mapped_column(Float, nullable=True)
    calibration: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    project = relationship("Project", back_populates="floorplans")


class Material(Base):
    """Catalogue entry. owner_id NULL = shared sample material (read-only)."""
    __tablename__ = "materials"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    estimate_key: Mapped[str] = mapped_column(String(30), index=True)  # which estimate line it can supply
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(80))
    brand: Mapped[str] = mapped_column(String(120), default="")
    grade: Mapped[str] = mapped_column(String(120), default="")
    specification: Mapped[str] = mapped_column(Text, default="")
    durability_notes: Mapped[str] = mapped_column(Text, default="")
    unit: Mapped[str] = mapped_column(String(30))
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    prices = relationship("PriceRecord", back_populates="material", cascade="all, delete-orphan", order_by="PriceRecord.updated_at.desc()")


class PriceRecord(Base):
    __tablename__ = "material_price_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    material_id: Mapped[str] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    unit_price: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    supplier: Mapped[str] = mapped_column(String(160), default="")
    location: Mapped[str] = mapped_column(String(160), default="")
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    material = relationship("Material", back_populates="prices")


class Estimate(Base):
    __tablename__ = "project_estimates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)  # cost summary
    geometry: Mapped[dict] = mapped_column(JSON, default=dict)
    assumptions: Mapped[dict] = mapped_column(JSON, default=dict)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    total_material_cost: Mapped[float] = mapped_column(Float, default=0.0)
    total_area_sqm: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    project = relationship("Project", back_populates="estimates")
    items = relationship("EstimateItemRow", back_populates="estimate", cascade="all, delete-orphan", order_by="EstimateItemRow.position")
    recommendations = relationship("Recommendation", back_populates="estimate", cascade="all, delete-orphan", order_by="Recommendation.position")


class EstimateItemRow(Base):
    __tablename__ = "estimate_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    estimate_id: Mapped[str] = mapped_column(ForeignKey("project_estimates.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[dict] = mapped_column(JSON)  # serialised EstimateItem
    estimate = relationship("Estimate", back_populates="items")


class Recommendation(Base):
    __tablename__ = "optimization_recommendations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    estimate_id: Mapped[str] = mapped_column(ForeignKey("project_estimates.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[dict] = mapped_column(JSON)
    estimate = relationship("Estimate", back_populates="recommendations")


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    estimate_id: Mapped[str | None] = mapped_column(ForeignKey("project_estimates.id", ondelete="SET NULL"), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    project = relationship("Project", back_populates="reports")
