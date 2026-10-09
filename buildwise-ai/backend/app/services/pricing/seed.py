"""Sample catalogue. These are PLACEHOLDER prices for demonstration only - not market rates."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import Material, PriceRecord

# (estimate_key, name, category, brand, grade, spec, durability, unit, sample_price)
SAMPLES = [
    ("cement", "Ordinary Portland Cement 43", "Cement & Binders", "Generic (sample)", "OPC 43", "General-purpose Portland cement, 50 kg bag.", "Common choice for general RCC and masonry work.", "bag (50 kg)", 400),
    ("cement", "Ordinary Portland Cement 53", "Cement & Binders", "Generic (sample)", "OPC 53", "Higher-strength Portland cement, 50 kg bag.", "Faster strength gain; often specified for higher-grade concrete.", "bag (50 kg)", 430),
    ("cement", "Portland Pozzolana Cement", "Cement & Binders", "Generic (sample)", "PPC", "Blended cement with pozzolanic material, 50 kg bag.", "Slower early strength; commonly used for general construction and plaster.", "bag (50 kg)", 390),
    ("sand", "River Sand", "Aggregates", "Generic (sample)", "Medium", "Natural river sand.", "Availability and extraction are regulated in many regions.", "m³", 1800),
    ("sand", "Manufactured Sand (M-Sand)", "Aggregates", "Generic (sample)", "Washed", "Crushed-rock fine aggregate.", "Consistent grading when sourced from a quality crusher.", "m³", 1500),
    ("aggregates", "20 mm Coarse Aggregate", "Aggregates", "Generic (sample)", "20 mm nominal", "Crushed stone aggregate.", "Standard size for slabs and beams.", "m³", 1400),
    ("steel", "TMT Reinforcement Bar Fe 500", "Reinforcement", "Generic (sample)", "Fe 500", "Thermo-mechanically treated rebar.", "Standard grade for RCC.", "kg", 62),
    ("steel", "TMT Reinforcement Bar Fe 500D", "Reinforcement", "Generic (sample)", "Fe 500D", "TMT rebar with higher ductility.", "Higher ductility grade; check structural drawings for the required grade.", "kg", 66),
    ("concrete", "Ready-Mix Concrete M20", "Concrete", "Generic (sample)", "M20", "Ready-mixed concrete delivered to site.", "Pumping and delivery charges may be extra.", "m³", 5500),
    ("concrete", "Ready-Mix Concrete M25", "Concrete", "Generic (sample)", "M25", "Ready-mixed concrete delivered to site.", "Higher grade; confirm with structural design.", "m³", 6000),
    ("bricks", "Burnt Clay Brick", "Masonry", "Generic (sample)", "Class 1", "Standard modular burnt clay brick.", "Widely available; water absorption varies by kiln.", "nos", 8),
    ("bricks", "Fly Ash Brick", "Masonry", "Generic (sample)", "Standard", "Brick made with fly ash.", "Uniform size can reduce mortar use.", "nos", 7),
    ("blocks", "AAC Block", "Masonry", "Generic (sample)", "600×200×100", "Autoclaved aerated concrete block.", "Lightweight; needs suitable jointing mortar/adhesive.", "nos", 55),
    ("blocks", "Solid Concrete Block", "Masonry", "Generic (sample)", "400×200×100", "Concrete masonry block.", "Heavier than AAC; good load-bearing options exist.", "nos", 42),
    ("tiles", "Ceramic Floor Tile 600×600", "Flooring", "Generic (sample)", "Standard", "Ceramic tile, per piece.", "Suitable for interior areas.", "nos", 60),
    ("tiles", "Vitrified Floor Tile 600×600", "Flooring", "Generic (sample)", "Standard", "Vitrified tile, per piece.", "Lower water absorption than ceramic.", "nos", 90),
    ("paint", "Interior Emulsion Paint", "Paint & Finishes", "Generic (sample)", "Standard", "Water-based interior emulsion.", "Washability varies by product line.", "litre", 350),
    ("paint", "Interior Distemper", "Paint & Finishes", "Generic (sample)", "Economy", "Economy interior distemper.", "Lower washability than emulsions.", "litre", 150),
]


def seed_sample_catalogue(db: Session) -> None:
    if db.query(Material).filter(Material.is_sample.is_(True)).first():
        return
    base = datetime.now(timezone.utc)
    for i, (key, name, cat, brand, grade, spec, dur, unit, price) in enumerate(SAMPLES):
        stamp = base + timedelta(milliseconds=i)  # keeps catalogue order stable
        m = Material(
            owner_id=None, estimate_key=key, name=name, category=cat, brand=brand, grade=grade,
            specification=spec, durability_notes=dur, unit=unit, is_sample=True, created_at=stamp,
        )
        m.prices.append(PriceRecord(
            owner_id=None, unit_price=float(price), currency="INR", supplier="SAMPLE - not a real quote",
            location="Sample data", is_sample=True, updated_at=stamp,
        ))
        db.add(m)
    db.commit()
