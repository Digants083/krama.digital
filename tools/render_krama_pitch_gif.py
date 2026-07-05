from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT = PUBLIC / "krama-pitch-video.gif"
W, H = 960, 540
FPS = 10
DURATION = 54


PALETTE = {
    "ink": "#14312d",
    "muted": "#5f746f",
    "teal": "#21c7b5",
    "cyan": "#76d9ee",
    "coral": "#ff8e72",
    "rose": "#f46fa5",
    "amber": "#ffc44f",
    "green": "#8ee0b5",
    "navy": "#25435f",
    "paper": "#f8fffd",
    "line": "#d7ebe7",
}


SCENES = [
    (0, 5, "Krama", "Smart digital queue for clinics"),
    (5, 13, "The clinic problem", "Crowded queues, delayed doctors, billing rush, and missed follow-ups."),
    (13, 21, "Control Queue", "Live token flow for walk-ins and appointments."),
    (21, 29, "Time Manager", "Doctor schedules, slots, delays, and live ETA updates."),
    (29, 37, "Billing Section", "Create bills faster while the patient journey stays connected."),
    (37, 45, "Reminders & Revisits", "Patients remember appointments. Clinics recover missed revisits."),
    (45, 54, "One flow. Less waiting.", "Krama helps clinics run calmer, faster, and more predictably."),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    if t < 0.5:
        return 4 * t * t * t
    return 1 - pow(-2 * t + 2, 3) / 2


def rr(draw: ImageDraw.ImageDraw, xy, radius: int, fill, outline=None, width: int = 1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def txt(draw: ImageDraw.ImageDraw, value: str, xy, size: int, fill=PALETTE["ink"], bold: bool = True, anchor=None):
    draw.text(xy, value, font=font(size, bold), fill=fill, anchor=anchor)


def logo_box(draw: ImageDraw.ImageDraw, x: int, y: int, size: int):
    rr(draw, (x, y, x + size, y + size), 18, "#006160")
    txt(draw, "K", (x + size // 2, y + size // 2 - 4), int(size * 0.58), "white", True, "mm")


def bg(t: float) -> Image.Image:
    img = Image.new("RGB", (W, H), "#f8fffd")
    draw = ImageDraw.Draw(img)
    for y in range(H):
        amt = y / H
        r = int(248 * (1 - amt) + 255 * amt)
        g = int(255 * (1 - amt) + 247 * amt)
        b = int(253 * (1 - amt) + 238 * amt)
        draw.line((0, y, W, y), fill=(r, g, b))
    colors = [PALETTE["cyan"], PALETTE["teal"], PALETTE["coral"], PALETTE["amber"], PALETTE["rose"]]
    for i, color in enumerate(colors):
        x = 90 + i * 190 + math.sin(t * 0.7 + i) * 10
        y = 466 + math.cos(t * 0.8 + i) * 7
        rr(draw, (x, y, x + 92, y + 8), 5, color)
    rr(draw, (58, 500, 902, 508), 5, "#d5e6e2")
    rr(draw, (58, 500, 58 + int(844 * (t / DURATION)), 508), 5, PALETTE["teal"])
    return img


def chrome(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int):
    rr(draw, (x, y, x + w, y + h), 20, "#21323d")
    rr(draw, (x + 25, y + 25, x + w - 25, y + h - 25), 8, "#ffffff")
    rr(draw, (x + 25, y + 25, x + w - 25, y + 68), 8, "#dff8ff")
    draw.rectangle((x + 25, y + 65, x + w - 25, y + h - 25), fill="#eef7f4")
    logo_box(draw, x + 40, y + 36, 26)
    txt(draw, "Krama", (x + 74, y + 38), 18)


def header(draw, title, subtitle, scene_title):
    txt(draw, title, (58, 46), 44 if scene_title == "Krama" else 31)
    txt(draw, subtitle, (59, 104 if scene_title == "Krama" else 91), 18, PALETTE["muted"], True)


def pill(draw, label, x, y, w, color, delay, t):
    a = ease((t - delay) / 0.7)
    slide = int((1 - a) * 48)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    rr(d, (x + slide, y, x + slide + w, y + 42), 8, color)
    txt(d, label, (x + slide + 20, y + 10), 19, "#15302c")
    alpha = overlay.getchannel("A").point(lambda value: int(value * a))
    overlay.putalpha(alpha)
    return overlay


def draw_scene(img: Image.Image, scene, local_t: float, global_t: float) -> Image.Image:
    draw = ImageDraw.Draw(img)
    start, end, title, subtitle = scene
    header(draw, title, subtitle, title)

    if title == "Krama":
        logo_box(draw, 362, 166, 126)
        txt(draw, "Krama", (530, 196), 52)
        txt(draw, "A clinic workflow video in under one minute", (532, 270), 18, PALETTE["navy"])
    elif title == "The clinic problem":
        items = [
            ("Long waiting room queues", PALETTE["cyan"]),
            ("Manual token confusion", PALETTE["rose"]),
            ("Delay calls and angry patients", PALETTE["amber"]),
            ("Billing and revisit follow-up gaps", PALETTE["green"]),
        ]
        for i, item in enumerate(items):
            img.alpha_composite(pill(draw, item[0], 250, 162 + i * 62, 465, item[1], i * 0.45, local_t).convert("RGBA"))
    elif title == "Control Queue":
        chrome(draw, 158, 96, 645, 354)
        txt(draw, "Control Queue", (218, 168), 23)
        rows = [("A-12", "Now serving", PALETTE["teal"]), ("A-13", "Next patient", PALETTE["cyan"]), ("B-07", "Appointment", PALETTE["green"]), ("W-21", "Walk-in", PALETTE["amber"])]
        for i, row in enumerate(rows):
            rr(draw, (220, 214 + i * 44, 610, 246 + i * 44), 7, "#ffffff", PALETTE["line"])
            rr(draw, (234, 221 + i * 44, 290, 240 + i * 44), 10, row[2])
            txt(draw, row[0], (246, 223 + i * 44), 12)
            txt(draw, row[1], (308, 221 + i * 44), 14)
        rr(draw, (632, 218, 732, 258), 8, PALETTE["teal"])
        txt(draw, "Call Next", (650, 230), 13, "white")
        rr(draw, (632, 272, 732, 312), 8, "#ffffff", PALETTE["line"])
        txt(draw, "Skip", (670, 284), 13, PALETTE["navy"])
    elif title == "Time Manager":
        chrome(draw, 165, 94, 630, 356)
        txt(draw, "Time Manager", (220, 168), 23)
        slots = [("09:00 - 09:30", "Open", PALETTE["green"]), ("09:30 - 10:00", "Full", PALETTE["cyan"]), ("10:00 - 10:30", "+15 min delay", PALETTE["coral"]), ("10:30 - 11:00", "Available", PALETTE["green"])]
        for i, slot in enumerate(slots):
            rr(draw, (224, 216 + i * 43, 600, 247 + i * 43), 7, "#ffffff", PALETTE["line"])
            txt(draw, slot[0], (240, 224 + i * 43), 13)
            rr(draw, (484, 222 + i * 43, 577, 241 + i * 43), 10, slot[2])
            txt(draw, slot[1], (498, 225 + i * 43), 10)
        rr(draw, (622, 230, 734, 325), 8, "#ffe5dc", PALETTE["coral"])
        txt(draw, "Auto ETA", (646, 252), 15)
        txt(draw, "10:15", (646, 286), 25, PALETTE["coral"])
    elif title == "Billing Section":
        chrome(draw, 166, 94, 628, 356)
        txt(draw, "Billing", (224, 166), 24)
        rr(draw, (228, 214, 496, 388), 8, "#ffffff", PALETTE["line"])
        for i, row in enumerate([("Consultation", "Rs 500"), ("Medicine", "Rs 350"), ("Lab note", "Rs 250")]):
            txt(draw, row[0], (252, 238 + i * 38), 14)
            txt(draw, row[1], (414, 238 + i * 38), 14, PALETTE["navy"])
        draw.line((252, 350, 466, 350), fill=PALETTE["line"], width=2)
        txt(draw, "Total", (252, 364), 17)
        txt(draw, "Rs 1,100", (390, 364), 17, PALETTE["teal"])
        rr(draw, (536, 226, 706, 338), 8, "#f3fffb", PALETTE["teal"])
        txt(draw, "Paid", (587, 252), 31, PALETTE["teal"])
        txt(draw, "Patient record updated", (556, 306), 12, PALETTE["muted"])
    elif title == "Reminders & Revisits":
        rr(draw, (338, 86, 622, 470), 26, "#26333f")
        rr(draw, (350, 112, 610, 444), 18, "#ffffff")
        logo_box(draw, 370, 142, 26)
        txt(draw, "Krama", (406, 145), 18)
        cards = [("Tomorrow 10:30 AM", "Appointment reminder", PALETTE["cyan"]), ("After 7 days", "Revisit follow-up", PALETTE["green"]), ("Missed visit", "Reschedule in one tap", PALETTE["rose"])]
        for i, card in enumerate(cards):
            rr(draw, (372, 202 + i * 68, 594, 251 + i * 68), 8, card[2])
            txt(draw, card[0], (390, 212 + i * 68), 12)
            txt(draw, card[1], (390, 232 + i * 68), 14)
    else:
        logo_box(draw, 417, 118, 112)
        txt(draw, "Krama", (480, 245), 52, anchor="mt")
        txt(draw, "Digital queue. Scheduling. Delay management. Billing. Revisits.", (480, 318), 19, PALETTE["navy"], True, "mt")
        rr(draw, (332, 382, 628, 426), 8, PALETTE["teal"])
        txt(draw, "Less waiting. Better clinic flow.", (480, 393), 17, "white", True, "mt")
    return img


def frame(t: float) -> Image.Image:
    img = bg(t).convert("RGBA")
    scene = next((s for s in SCENES if s[0] <= t < s[1]), SCENES[-1])
    draw_scene(img, scene, t - scene[0], t)
    return img.convert("P", palette=Image.Palette.ADAPTIVE, colors=128)


def main() -> None:
    frames = [frame(i / FPS) for i in range(DURATION * FPS)]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(OUT)


if __name__ == "__main__":
    main()
