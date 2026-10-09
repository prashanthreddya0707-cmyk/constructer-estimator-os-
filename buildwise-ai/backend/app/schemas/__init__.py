from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

ROOM_TYPES = ["living", "bedroom", "kitchen", "bathroom", "dining", "study", "store", "balcony", "corridor", "staircase", "office", "other"]
BUILDING_TYPES = ["residential", "commercial", "industrial", "institutional", "mixed-use"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------- auth ----------------
class SignupIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORM):
    id: str
    email: str
    full_name: str


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------------- rooms ----------------
class RoomBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    room_type: str = "other"
    length: float = Field(gt=0, le=100, description="metres")
    width: float = Field(gt=0, le=100, description="metres")
    height: float = Field(default=3.0, ge=2.0, le=10, description="metres")
    floor_number: int = Field(default=1, ge=1, le=100)
    wall_thickness: Optional[float] = Field(default=None, gt=0, le=1.0)
    doors: int = Field(default=0, ge=0, le=50)
    windows: int = Field(default=0, ge=0, le=50)
    area_override: Optional[float] = Field(default=None, gt=0, le=10000)
    pos_x: Optional[float] = Field(default=None, ge=0, le=1000)
    pos_y: Optional[float] = Field(default=None, ge=0, le=1000)

    @field_validator("room_type")
    @classmethod
    def _rt(cls, v: str) -> str:
        return v if v in ROOM_TYPES else "other"


class RoomIn(RoomBase):
    pass


class RoomOut(RoomBase, ORM):
    id: str
    project_id: str
    area: float = 0.0

    @model_validator(mode="after")
    def _area(self):
        self.area = self.area_override or round(self.length * self.width, 4)
        return self


# ---------------- projects ----------------
class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    owner_name: str = Field(default="", max_length=120)
    building_type: str = "residential"
    location: str = Field(default="", max_length=160)
    floors: int = Field(default=1, ge=1, le=50)
    currency: str = Field(default="INR", min_length=3, max_length=8)
    budget: Optional[float] = Field(default=None, gt=0)
    length: float = Field(gt=0, le=500)
    width: float = Field(gt=0, le=500)
    height: float = Field(default=3.0, ge=2.0, le=10)
    wall_thickness: float = Field(default=0.23, ge=0.05, le=1.0)
    slab_thickness: float = Field(default=0.15, ge=0.08, le=0.6)
    built_up_area: Optional[float] = Field(default=None, gt=0, le=250000)

    @field_validator("building_type")
    @classmethod
    def _bt(cls, v: str) -> str:
        if v not in BUILDING_TYPES:
            raise ValueError(f"must be one of {BUILDING_TYPES}")
        return v


class ProjectCreate(ProjectBase):
    rooms: list[RoomIn] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def _rooms_on_valid_floors(self):
        for r in self.rooms:
            if r.floor_number > self.floors:
                raise ValueError(f"Room '{r.name}' is on floor {r.floor_number}, but the project has {self.floors} floor(s).")
        return self


class ProjectUpdate(ProjectBase):
    pass


class ProjectConfigUpdate(BaseModel):
    assumptions: Optional[dict] = None
    wastage: Optional[dict[str, float]] = None
    material_selections: Optional[dict[str, Optional[str]]] = None
    extra_costs: Optional[dict] = None
    purchase_quantities: Optional[dict[str, Optional[float]]] = None


class ProjectOut(ProjectBase, ORM):
    id: str
    is_demo: bool
    created_at: datetime
    updated_at: datetime
    assumptions: dict = {}
    wastage: dict = {}
    material_selections: dict = {}
    extra_costs: dict = {}
    purchase_quantities: dict = {}
    room_count: int = 0
    floor_area: float = 0.0
    total_built_up_area: float = 0.0
    latest_total_cost: Optional[float] = None
    has_estimate: bool = False


class ProjectDetail(ProjectOut):
    rooms: list[RoomOut] = []
    floorplans: list["FloorPlanOut"] = []


# ---------------- floor plans ----------------
class CalibrationIn(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    real_length_m: float = Field(gt=0, le=1000)


class FloorPlanOut(ORM):
    id: str
    project_id: str
    original_name: str
    content_type: str
    size_bytes: int
    width_px: Optional[int] = None
    height_px: Optional[int] = None
    scale_m_per_px: Optional[float] = None
    calibration: Optional[dict] = None
    created_at: datetime


ProjectDetail.model_rebuild()


# ---------------- materials / prices ----------------
class MaterialBase(BaseModel):
    estimate_key: str
    name: str = Field(min_length=1, max_length=160)
    category: str = Field(min_length=1, max_length=80)
    brand: str = Field(default="", max_length=120)
    grade: str = Field(default="", max_length=120)
    specification: str = Field(default="", max_length=2000)
    durability_notes: str = Field(default="", max_length=2000)
    unit: str = Field(min_length=1, max_length=30)

    @field_validator("estimate_key")
    @classmethod
    def _k(cls, v: str) -> str:
        from app.services.estimation import ITEM_ORDER
        if v not in ITEM_ORDER:
            raise ValueError(f"must be one of {ITEM_ORDER}")
        return v


class MaterialCreate(MaterialBase):
    unit_price: Optional[float] = Field(default=None, ge=0)
    supplier: str = ""
    location: str = ""
    currency: str = "INR"


class MaterialUpdate(MaterialBase):
    pass


class MaterialOut(MaterialBase, ORM):
    id: str
    is_sample: bool
    owner_id: Optional[str] = None
    editable: bool = False
    unit_price: Optional[float] = None
    currency: Optional[str] = None
    supplier: str = ""
    location: str = ""
    price_is_sample: bool = False
    price_id: Optional[str] = None
    last_updated: Optional[datetime] = None
    created_at: datetime


class PriceCreate(BaseModel):
    material_id: str
    unit_price: float = Field(ge=0)
    currency: str = "INR"
    supplier: str = Field(default="", max_length=160)
    location: str = Field(default="", max_length=160)


class PriceUpdate(BaseModel):
    unit_price: float = Field(ge=0)
    supplier: str = Field(default="", max_length=160)
    location: str = Field(default="", max_length=160)


class PriceOut(ORM):
    id: str
    material_id: str
    unit_price: float
    currency: str
    supplier: str
    location: str
    is_sample: bool
    updated_at: datetime


# ---------------- estimates ----------------
class EstimateRequest(BaseModel):
    persist: bool = True
    # Optional scenario overrides (not saved to the project)
    assumptions: Optional[dict] = None
    wastage: Optional[dict[str, float]] = None
    material_selections: Optional[dict[str, Optional[str]]] = None
    extra_costs: Optional[dict] = None


class ReportOut(ORM):
    id: str
    project_id: str
    file_name: str
    size_bytes: int
    total_cost: float
    currency: str
    created_at: datetime
