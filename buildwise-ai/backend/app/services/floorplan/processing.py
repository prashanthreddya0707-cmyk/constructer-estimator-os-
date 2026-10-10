"""Floor-plan helpers: upload validation, scale calibration and optional OpenCV pre-processing.

IMPORTANT: edge/contour detection here is a *visual aid only*. It does NOT identify rooms or
exact dimensions. Users confirm or enter dimensions manually.
"""
from __future__ import annotations

import io
import math

from PIL import Image, UnidentifiedImageError

ALLOWED = {"image/jpeg": "image", "image/png": "image", "application/pdf": "pdf"}
EXT_TO_TYPE = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}
Image.MAX_IMAGE_PIXELS = 60_000_000  # decompression-bomb guard


class UploadError(ValueError):
    pass


def validate_upload(filename: str, data: bytes, max_bytes: int) -> tuple[str, int | None, int | None]:
    """Validate by extension AND content signature. Returns (content_type, width_px, height_px)."""
    if not data:
        raise UploadError("The uploaded file is empty.")
    if len(data) > max_bytes:
        raise UploadError(f"File is too large. Maximum size is {max_bytes // (1024 * 1024)} MB.")
    name = (filename or "").lower()
    ext = name[name.rfind("."):] if "." in name else ""
    ctype = EXT_TO_TYPE.get(ext)
    if not ctype:
        raise UploadError("Unsupported file type. Upload a JPG, JPEG, PNG or PDF file.")
    if ctype == "application/pdf":
        if not data.startswith(b"%PDF"):
            raise UploadError("The file does not look like a valid PDF.")
        return ctype, None, None
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            fmt = (im.format or "").upper()
            w, h = im.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise UploadError("The file is not a valid image.")
    if (ctype == "image/png") != (fmt == "PNG") or (ctype == "image/jpeg") != (fmt == "JPEG"):
        raise UploadError("The file content does not match its extension.")
    return ctype, w, h


def compute_scale(x1: float, y1: float, x2: float, y2: float, real_length_m: float) -> float:
    """Metres per pixel from a user-marked known distance."""
    px = math.hypot(x2 - x1, y2 - y1)
    if px < 2:
        raise UploadError("The two calibration points are too close together.")
    if real_length_m <= 0:
        raise UploadError("The real-world length must be positive.")
    return real_length_m / px


def opencv_available() -> bool:
    try:
        import cv2  # noqa: F401
        return True
    except Exception:
        return False


def analyze_image(data: bytes, canny_low: int = 60, canny_high: int = 160, min_contour_px: int = 400) -> dict:
    """Grayscale -> blur -> adaptive threshold -> Canny edges -> contour overlay.

    Returns PNG bytes of a contour visualisation plus counts. Pillow-only fallback is not offered
    because the point of this module is OpenCV preprocessing; callers get a clear error instead.
    """
    try:
        import cv2
        import numpy as np
    except Exception as exc:  # pragma: no cover
        raise UploadError("OpenCV is not installed; floor-plan analysis is unavailable.") from exc
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise UploadError("The image could not be decoded.")
    h, w = img.shape[:2]
    scale = min(1.0, 1600 / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 7)
    edges = cv2.Canny(blur, canny_low, canny_high)
    contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    kept = [c for c in contours if cv2.contourArea(c) >= min_contour_px]
    overlay = img.copy()
    cv2.drawContours(overlay, kept, -1, (0, 120, 255), 2)
    ok, png = cv2.imencode(".png", overlay)
    ok2, edge_png = cv2.imencode(".png", edges)
    if not (ok and ok2):
        raise UploadError("Could not render the analysis image.")
    return {
        "overlay_png": png.tobytes(),
        "edges_png": edge_png.tobytes(),
        "contour_count": len(kept),
        "image_size": [int(img.shape[1]), int(img.shape[0])],
        "downscale_factor": scale,
        "disclaimer": (
            "Edges and contours are a visual aid only. They do not identify rooms or exact dimensions. "
            "Confirm or enter room dimensions manually."
        ),
    }


def detect_rooms(data: bytes, max_side: int = 1100) -> dict:
    """Propose rectangular room candidates from a floor-plan image (walls = dark strokes).

    Method: Otsu threshold -> dilate walls to seal door gaps -> connected components of the remaining free space ->
    discard the outside and tiny regions -> bounding rectangles. This is a *heuristic*: it works on clean plans with
    closed walls, it cannot read room names, doors, windows or dimension text, and L-shaped rooms are approximated by
    their bounding rectangle (flagged via `rectangular`). The caller must have the user review and confirm everything.
    Coordinates are returned in ORIGINAL image pixels.
    """
    try:
        import cv2
        import numpy as np
    except Exception as exc:  # pragma: no cover
        raise UploadError("OpenCV is not installed; room detection is unavailable.") from exc
    arr = np.frombuffer(data, dtype=np.uint8)
    color = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if color is None:
        raise UploadError("The image could not be decoded.")
    oh, ow = color.shape[:2]
    f = min(1.0, max_side / max(oh, ow))
    if f < 1.0:
        color = cv2.resize(color, (int(ow * f), int(oh * f)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    side = max(h, w)
    pad = int(0.1 * side) + 2
    gray = cv2.copyMakeBorder(gray, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=255)  # guarantees an "outside"
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, walls = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    min_area = 0.008 * h * w

    def rooms_for(k: int):
        """Dilating the walls by k seals door gaps up to k px wide; too large a k erodes small rooms away."""
        sealed = cv2.dilate(walls, np.ones((k, k), np.uint8))
        free = (sealed == 0).astype(np.uint8)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
        outside, half, found = labels[0, 0], k // 2, []
        for i in range(1, n):
            if i == outside:
                continue
            x, y, bw, bh, area = stats[i]
            if area < min_area or max(bw, bh) / max(1, min(bw, bh)) > 12:
                continue
            # Fill ratio from the region's OUTER outline, so text/furniture holes inside a room don't look like an L-shape.
            mask = (labels[y:y + bh, x:x + bw] == i).astype(np.uint8)
            cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            outline = max((cv2.contourArea(c) for c in cnts), default=float(area))
            fill = max(float(area), outline) / float(max(1, bw * bh))
            found.append({"x": x - half - pad, "y": y - half - pad, "w": bw + 2 * half, "h": bh + 2 * half,
                          "fill_ratio": round(fill, 2), "rectangular": fill >= 0.82})
        return found

    # The best seal size is the one that separates the most rooms (smallest k wins ties).
    best, best_k = [], 0
    for frac in (0.02, 0.035, 0.05, 0.07, 0.09):
        k = max(5, int(round(frac * side)))
        found = rooms_for(k)
        if len(found) > len(best):
            best, best_k = found, k
    rooms = best
    rooms.sort(key=lambda r: (round(r["y"] / (0.08 * h)), r["x"]))
    overlay = cv2.copyMakeBorder(color, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    for idx, r in enumerate(rooms, 1):
        r["index"] = idx
        cv2.rectangle(overlay, (r["x"] + pad, r["y"] + pad), (r["x"] + r["w"] + pad, r["y"] + r["h"] + pad), (0, 120, 255), 2)
        cv2.putText(overlay, str(idx), (r["x"] + pad + 6, r["y"] + pad + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 80, 220), 2)
    overlay = overlay[pad:-pad, pad:-pad]
    ok, png = cv2.imencode(".png", overlay)
    if not ok:
        raise UploadError("Could not render the detection preview.")
    inv = 1.0 / f
    for r in rooms:  # back to original image pixels
        r["x"], r["y"], r["w"], r["h"] = (int(round(r[c] * inv)) for c in ("x", "y", "w", "h"))
    warnings = []
    if not rooms:
        warnings.append("No closed rooms were found. The walls may have gaps larger than a door, or the plan is a photo/sketch. Enter rooms manually.")
    if any(not r["rectangular"] for r in rooms):
        warnings.append("Some regions are not rectangular (L-shapes, curves). They are approximated by their bounding rectangle: check and correct them.")
    return {
        "rooms": rooms, "image_size": [ow, oh], "overlay_png": png.tobytes(), "warnings": warnings,
        "disclaimer": "Detected rooms are suggestions only. Names, doors, windows and dimension text are NOT read from the image. "
                      "Review every room and confirm before generating the 3D model.",
    }
