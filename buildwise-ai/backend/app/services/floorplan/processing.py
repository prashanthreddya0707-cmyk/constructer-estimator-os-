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
