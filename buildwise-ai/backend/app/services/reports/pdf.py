"""PDF report generation with ReportLab (platypus: automatic page breaks, repeated table headers, page numbers)."""
from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

NAVY = colors.HexColor("#0B1F3A")
ORANGE = colors.HexColor("#F97316")
GREY = colors.HexColor("#F1F5F9")
LINE = colors.HexColor("#CBD5E1")

DISCLAIMER = (
    "These figures are preliminary planning estimates produced by rule-based calculations from the inputs and "
    "assumptions listed in this report. They must be verified by a qualified engineer before procurement or construction. "
    "Prices marked SAMPLE are placeholders, not market quotes."
)


def _money(v, cur):
    return "—" if v is None else f"{cur} {v:,.2f}"


def _num(v, d=2):
    return f"{v:,.{d}f}"


def build_report_pdf(data: dict) -> bytes:
    """`data` holds: project, rooms, estimate (summary, items, geometry, warnings), recommendations, generated_at, user_name."""
    p, rooms, est = data["project"], data["rooms"], data["estimate"]
    cur = p["currency"]
    summary = est["summary"]
    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=body, fontSize=7.5, leading=9.5)
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=20, textColor=NAVY, alignment=0, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, textColor=NAVY, spaceBefore=12, spaceAfter=5)
    cell = ParagraphStyle("cell", parent=body, fontSize=8, leading=10)
    cellb = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")

    def tbl(rows, widths, header=True, align_right_from=None, zebra=True):
        t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
        st = [
            ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.25, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        if header:
            st += [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                   ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]
        if zebra:
            for i in range(1, len(rows)):
                if i % 2 == 0:
                    st.append(("BACKGROUND", (0, i), (-1, i), GREY))
        if align_right_from is not None:
            st.append(("ALIGN", (align_right_from, 0), (-1, -1), "RIGHT"))
        t.setStyle(TableStyle(st))
        return t

    def kv(rows):
        t = Table([[Paragraph(f"<b>{k}</b>", cell), Paragraph(str(v), cell)] for k, v in rows], colWidths=[48 * mm, 122 * mm])
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, LINE), ("BACKGROUND", (0, 0), (0, -1), GREY),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        return t

    story = []
    story.append(Paragraph("Construction Material Estimation Report", h1))
    story.append(Paragraph(f"<b>{_esc(p['name'])}</b> &nbsp;|&nbsp; Generated {data['generated_at']}", body))
    story.append(Spacer(1, 4))
    banner = Table([[Paragraph(f"<b>Total estimated material cost:</b> {_money(summary['material_total'], cur)}"
                               + ("" if summary["complete"] else " <font color='#B91C1C'>(incomplete: some prices missing)</font>"), body)]],
                   colWidths=[170 * mm])
    banner.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF3E8")),
                                ("LINEBEFORE", (0, 0), (0, -1), 3, ORANGE), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(banner)

    story.append(Paragraph("1. Project details", h2))
    story.append(kv([
        ("Project", _esc(p["name"])), ("Description", _esc(p["description"] or "—")), ("Owner / client", _esc(p["owner_name"] or "—")),
        ("Prepared by", _esc(data.get("user_name", "—"))), ("Building type", p["building_type"].title()),
        ("Location", _esc(p["location"] or "—")), ("Currency", cur), ("Project budget", _money(p["budget"], cur) if p["budget"] else "Not set"),
    ]))

    g = est["geometry"]
    story.append(Paragraph("2. Building dimensions", h2))
    story.append(kv([
        ("Length × Width", f"{p['length']:g} m × {p['width']:g} m"), ("Floors", p["floors"]),
        ("Floor-to-ceiling height", f"{p['height']:g} m"), ("External wall thickness", f"{p['wall_thickness']:g} m"),
        ("Slab thickness", f"{p['slab_thickness']:g} m"),
        ("Floor area (per floor)", f"{_num(g['floor_area'])} m²" + (" (manual override)" if p.get("built_up_area") else " (L × W)")),
        ("Total built-up area", f"{_num(g['total_built_up_area'])} m² ({_num(g['total_built_up_area'] / 0.09290304, 0)} sq ft)"),
        ("Openings deducted", f"{g.get('door_count', 0)} door(s), {g.get('window_count', 0)} window(s) – {g.get('openings_source', 'n/a')}"),
    ]))

    story.append(Paragraph("3. Floors and rooms", h2))
    if rooms:
        rows = [["Floor", "Room", "Type", "L (m)", "W (m)", "H (m)", "Area (m²)", "Doors", "Win."]]
        for r in rooms:
            rows.append([r["floor_number"], Paragraph(_esc(r["name"]), cell), r["room_type"], _num(r["length"]), _num(r["width"]),
                         _num(r["height"]), _num(r["area"]), r["doors"], r["windows"]])
        story.append(tbl(rows, [12 * mm, 42 * mm, 24 * mm, 17 * mm, 17 * mm, 17 * mm, 20 * mm, 11 * mm, 10 * mm], align_right_from=3))
    else:
        story.append(Paragraph("No rooms were configured for this project.", body))

    story.append(Paragraph("4. Material quantities, unit prices and costs", h2))
    rows = [["Material", "Net qty", "Waste %", "Qty incl. waste", "Unit", f"Unit price", f"Cost ({cur})"]]
    for it in est["items"]:
        name = it["name"] + (f"<br/><font size=6.5 color='#64748B'>{_esc(it.get('material_label') or '')}</font>" if it.get("material_label") and it["counts_toward_cost"] else "")
        price = "—" if it.get("unit_price") is None else _num(it["unit_price"]) + (" S" if it.get("price_is_sample") else "")
        cost = ("qty only" if not it["counts_toward_cost"] else ("missing" if it["cost"] is None else _num(it["cost"])))
        rows.append([Paragraph(name, cell), _num(it["net_quantity"]), f"{it['wastage_pct']:g}", _num(it["gross_quantity"]),
                     Paragraph(it["unit"], cell), price, cost])
    rows.append([Paragraph("<b>Total material cost</b>", cell), "", "", "", "", "", Paragraph(f"<b>{_num(summary['material_total'])}</b>", cell)])
    t = tbl(rows, [46 * mm, 20 * mm, 14 * mm, 25 * mm, 20 * mm, 22 * mm, 23 * mm], align_right_from=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), colors.HexColor("#FFF3E8")), ("ALIGN", (4, 0), (4, -1), "LEFT")]))
    story.append(t)
    story.append(Paragraph("S = sample placeholder price. 'qty only' lines are priced through their constituent materials (or ready-mix) and are not added again.", small))

    story.append(Paragraph("5. Cost breakdown", h2))
    rows = [["Category", f"Cost ({cur})", "Share"]]
    tot = summary["material_total"] or 1
    for c in summary["by_category"]:
        rows.append([c["category"], _num(c["cost"]), f"{c['cost'] / tot * 100:.1f} %"])
    story.append(tbl(rows, [90 * mm, 45 * mm, 35 * mm], align_right_from=1))
    story.append(Spacer(1, 4))
    kvr = [("Material cost per m²", _money(summary["cost_per_sqm"], cur) if summary["cost_per_sqm"] else "—"),
           ("Material cost per sq ft", _money(summary["cost_per_sqft"], cur) if summary["cost_per_sqft"] else "—")]
    story.append(kv(kvr))

    story.append(Paragraph("6. Optional additional costs", h2))
    inc = [e for e in summary["extras"] if e["included"]]
    if inc:
        rows = [["Category", "Basis", f"Amount ({cur})"]]
        for e in inc:
            rows.append([e["key"].title(), f"{e['value']:g} %" if e["mode"] == "percent" else "Fixed", _num(e["amount"])])
        rows.append([Paragraph("<b>Total including additional costs</b>", cell), "", Paragraph(f"<b>{_num(summary['project_total'])}</b>", cell)])
        story.append(tbl(rows, [90 * mm, 40 * mm, 40 * mm], align_right_from=2))
    else:
        story.append(Paragraph("No additional costs (labour, transportation, contingency, other) were enabled. The total above is material cost only.", body))
    if p["budget"]:
        v = summary["budget_variance"]
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"Budget {_money(p['budget'], cur)} vs estimate {_money(summary['project_total'], cur)}: "
                               + (f"under budget by {_money(v, cur)}." if v is not None and v >= 0 else f"over budget by {_money(-v, cur)}."), body))

    story.append(Paragraph("7. Optimisation recommendations", h2))
    recs = data["recommendations"]
    if recs:
        for r in recs:
            block = [Paragraph(f"<b>{_esc(r['title'])}</b> <font size=7 color='#64748B'>[{r['severity']}]</font>", body),
                     Paragraph(_esc(r["explanation"]), small),
                     Paragraph(f"<b>Reason:</b> {_esc(r['reason'])}<br/><b>Suggested action:</b> {_esc(r['suggested_action'])}<br/>"
                               f"<b>Potential benefit:</b> {_esc(r['potential_benefit'])}", small), Spacer(1, 5)]
            story.append(KeepTogether(block))
    else:
        story.append(Paragraph("No recommendations were generated for the current data.", body))

    story.append(Paragraph("8. Calculation assumptions", h2))
    a = est["assumptions"]
    story.append(kv([
        ("Concrete mix (C:S:A)", ":".join(f"{x:g}" for x in a["concrete_mix"])), ("Concrete supply", a["concrete_supply"].replace("_", " ")),
        ("Steel intensity", f"{a['steel_kg_per_m3']:g} kg/m³"), ("Mortar mix (cement:sand)", f"1:{a['mortar_sand_ratio']:g}"),
        ("Plaster", f"1:{a['plaster_sand_ratio']:g}, {a['plaster_thickness'] * 1000:g} mm"),
        ("Masonry units", f"External: {a['external_masonry']}; internal: {a['internal_masonry']}; joint {a['mortar_joint'] * 1000:g} mm"),
        ("Internal wall thickness", f"{a['internal_wall_thickness']:g} m"),
        ("Door / window size", f"{a['door_w']:g}×{a['door_h']:g} m / {a['window_w']:g}×{a['window_h']:g} m"),
        ("Tile size", f"{a['tile_l']:g}×{a['tile_w']:g} m"), ("Paint", f"{a['paint_coats']} coats, {a['paint_coverage']:g} m²/L"),
    ]))
    story.append(Spacer(1, 6))
    for it in est["items"]:
        story.append(KeepTogether([
            Paragraph(f"<b>{_esc(it['name'])}</b>: {_esc(it['formula'])}", small),
            Paragraph("; ".join(_esc(x) for x in it["assumptions"]) + (f" — {_esc(it['note'])}" if it["note"] else ""), small),
            Spacer(1, 3)]))
    if est["warnings"]:
        story.append(Paragraph("<b>Input warnings:</b> " + "; ".join(_esc(w) for w in est["warnings"]), small))

    story.append(Paragraph("9. Disclaimer", h2))
    story.append(Paragraph(DISCLAIMER, body))

    buf = io.BytesIO()
    title = f"BuildWise AI - {p['name']}"

    def deco(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(NAVY)
        canvas.rect(0, h - 14 * mm, w, 14 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 12)
        canvas.drawString(20 * mm, h - 9 * mm, "BuildWise AI")
        canvas.setFillColor(ORANGE)
        canvas.rect(0, h - 15 * mm, w, 1 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(w - 20 * mm, h - 9 * mm, "Plan Smarter. Build Better.")
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(20 * mm, 10 * mm, "Preliminary estimate - verify with a qualified engineer before procurement or construction.")
        canvas.drawRightString(w - 20 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = BaseDocTemplate(buf, pagesize=A4, title=title, author="BuildWise AI", leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=22 * mm, bottomMargin=18 * mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=deco)])
    doc.build(story)
    return buf.getvalue()


def _esc(s) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
