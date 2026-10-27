#!/usr/bin/env python3
"""Erzeugt alle Icon- und Startbild-Dateien fuer LU Mobile aus dem Desktop-Monogramm.

Quelle: quelle/lu-monogramm-maske-2048.png neben diesem Skript. Das ist
public/LU-monogram.svg (Ring plus LU), mit qlmanage auf 2048 px gerastert und als
weisse Alphamaske abgelegt.

Aufruf:  python3 scripts/mobile/release/make_icons.py AUSGABEORDNER   (braucht nur Pillow)

Das Skript schreibt nur in den Ausgabeordner (android/..., ios/...), nie ins
Repo. Von dort kopiert man, was man braucht, nach src-tauri/gen/android und
src-tauri/gen/apple. Es erzeugt Startbild und Farben in heller und dunkler
Variante, beide liegen im Repo (mobile-docs/BAUEN.md 4.6 und 5.7, mobile-docs/r5/start.md).
Die beiden Grundfarben sind --m-canvas aus src/mobile/styles/tokens.css. Der
Waechter src/mobile/platform/__tests__/start-colours.test.ts prueft sie.
"""
import json, math, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) != 2:
    sys.exit("Aufruf: make_icons.py AUSGABEORDNER")
ROOT = os.path.abspath(sys.argv[1])
if os.path.commonpath([ROOT, HERE]) == HERE or os.path.exists(os.path.join(ROOT, ".git")):
    sys.exit("Der Ausgabeordner darf nicht im Repo liegen.")
MASK = Image.open(os.path.join(HERE, "quelle", "lu-monogramm-maske-2048.png")).convert("RGBA")

CANVAS_LIGHT = "F3F4F6"     # --m-canvas hell (src/mobile/styles/tokens.css)
CANVAS_DARK = "141414"      # --m-canvas dunkel
INK = (11, 11, 13)          # #0B0B0D, das Schwarz des Desktop-Icons (src-tauri/icons/icon.png)
WHITE = (255, 255, 255)
SS = 4                      # Ueberabtastung fuer glatte Kanten

# Motiv eng zuschneiden und seine Ausdehnung messen
alpha = MASK.split()[3]
bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
MOTIF = MASK.crop(bbox)
MW, MH = MOTIF.size
assert abs(MW - MH) <= 2, (MW, MH)


def motif_max_radius_ratio():
    """Groesster Abstand eines Motivpixels von der Mitte, geteilt durch die Motivbreite."""
    a = MOTIF.split()[3].resize((512, 512), Image.LANCZOS)
    px = a.load()
    c = 255.5
    best = 0.0
    for y in range(512):
        for x in range(512):
            if px[x, y] > 64:
                d = math.hypot(x - c, y - c)
                if d > best:
                    best = d
    return best / 512.0


RADIUS_RATIO = motif_max_radius_ratio()   # etwa 0,61: Eckpunkt des Rings


def tinted(size, color):
    """Motiv in gewuenschter Kantenlaenge und Farbe, transparenter Grund."""
    m = MOTIF.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), color + (0,))
    out.putalpha(m.split()[3])
    return out


def place(canvas, motif_px, color):
    m = tinted(motif_px, color)
    off = ((canvas.width - motif_px) // 2, (canvas.height - motif_px) // 2)
    canvas.alpha_composite(m, off)
    return canvas


def save(img, rel, flatten=None):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if flatten is not None:
        bg = Image.new("RGB", img.size, flatten)
        bg.paste(img, (0, 0), img)
        img = bg
    img.save(path, optimize=True)
    return path


def down(img, size):
    return img.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- Android
DENS = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

# Adaptives Icon: Leinwand 108 dp, sichtbar mindestens der innere Kreis mit 66 dp.
# Der aeusserste Punkt des Motivs (Ringecke) soll bei 30 dp Radius liegen, also
# 3 dp innerhalb der Sicherheitszone von 33 dp.
ADAPTIVE_MOTIF = (30.0 / 108.0) / RADIUS_RATIO      # Motivbreite als Anteil der Leinwand


def adaptive_layer(px, color):
    big = Image.new("RGBA", (px * SS, px * SS), (0, 0, 0, 0))
    place(big, round(px * SS * ADAPTIVE_MOTIF), color)
    return down(big, px)


def legacy_square(px):
    """Fuer Android 7.x ohne adaptive Icons: schwarzes abgerundetes Quadrat mit Rand."""
    n = px * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    side = round(n * 0.875)                      # 42 von 48 dp
    o = (n - side) // 2
    ImageDraw.Draw(img).rounded_rectangle([o, o, o + side - 1, o + side - 1], radius=round(side * 0.22), fill=INK + (255,))
    place(img, round(side * 0.74), WHITE)
    return down(img, px)


def legacy_round(px):
    n = px * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    dia = round(n * 0.9167)                      # 44 von 48 dp
    o = (n - dia) // 2
    ImageDraw.Draw(img).ellipse([o, o, o + dia - 1, o + dia - 1], fill=INK + (255,))
    # Ringecke bei 80 Prozent des Kreisradius
    place(img, round((dia / 2) * 0.80 / RADIUS_RATIO), WHITE)
    return down(img, px)


def android():
    for d, f in DENS.items():
        save(adaptive_layer(round(108 * f), WHITE), f"android/res/mipmap-{d}/ic_launcher_foreground.png")
        save(adaptive_layer(round(108 * f), WHITE), f"android/res/mipmap-{d}/ic_launcher_monochrome.png")
        save(legacy_square(round(48 * f)), f"android/res/mipmap-{d}/ic_launcher.png")
        save(legacy_round(round(48 * f)), f"android/res/mipmap-{d}/ic_launcher_round.png")
        # Startbild Android 12+: Leinwand 288 dp, sichtbar der Kreis mit 192 dp.
        # Ringecke bei 86 dp Radius, also 10 dp innerhalb.
        for night, color in (("", INK), ("-night", WHITE)):
            px = round(288 * f)
            big = Image.new("RGBA", (px * 2, px * 2), (0, 0, 0, 0))
            place(big, round(px * 2 * (86.0 / 288.0) / RADIUS_RATIO), color)
            save(down(big, px), f"android/res/drawable{night}-{d}/lu_splash_icon.png")
    # Play Store: 512 px, volle Flaeche, Google rundet selbst ab. Motiv wie im adaptiven Icon,
    # bezogen auf den sichtbaren Ausschnitt von 72 dp.
    n = 512 * SS
    img = Image.new("RGBA", (n, n), INK + (255,))
    place(img, round(n * ADAPTIVE_MOTIF * 108 / 72), WHITE)
    save(down(img, 512), "android/play-store/ic_launcher-playstore-512.png", flatten=INK)


# ---------------------------------------------------------------- iOS
IOS_MOTIF_SMALL = 0.78
IOS_MOTIF = 0.66   # Ringbreite als Anteil der Kantenlaenge, volle Flaeche, iOS maskiert selbst

IOS_ICONS = [
    # (Dateiname, idiom, Punktgroesse, Massstab)
    ("AppIcon-20x20@2x.png", "iphone", "20x20", 2), ("AppIcon-20x20@3x.png", "iphone", "20x20", 3),
    ("AppIcon-29x29@2x.png", "iphone", "29x29", 2), ("AppIcon-29x29@3x.png", "iphone", "29x29", 3),
    ("AppIcon-40x40@2x.png", "iphone", "40x40", 2), ("AppIcon-40x40@3x.png", "iphone", "40x40", 3),
    ("AppIcon-60x60@2x.png", "iphone", "60x60", 2), ("AppIcon-60x60@3x.png", "iphone", "60x60", 3),
    ("AppIcon-20x20@1x.png", "ipad", "20x20", 1), ("AppIcon-20x20@2x-1.png", "ipad", "20x20", 2),
    ("AppIcon-29x29@1x.png", "ipad", "29x29", 1), ("AppIcon-29x29@2x-1.png", "ipad", "29x29", 2),
    ("AppIcon-40x40@1x.png", "ipad", "40x40", 1), ("AppIcon-40x40@2x-1.png", "ipad", "40x40", 2),
    ("AppIcon-76x76@1x.png", "ipad", "76x76", 1), ("AppIcon-76x76@2x.png", "ipad", "76x76", 2),
    ("AppIcon-83.5x83.5@2x.png", "ipad", "83.5x83.5", 2),
    ("AppIcon-512@2x.png", "ios-marketing", "1024x1024", 1),
]


def ios_icon(px):
    n = max(px * SS, 1024)
    img = Image.new("RGBA", (n, n), INK + (255,))
    # Optische Groesse: bis 40 px Kantenlaenge wird das Motiv groesser gesetzt, sonst
    # verschwimmen Ring und Buchstaben (am Kontrollbild gesehen und korrigiert).
    place(img, round(n * (IOS_MOTIF_SMALL if px <= 40 else IOS_MOTIF)), WHITE)
    return down(img, px)


def ios():
    base = "ios/Assets.xcassets"
    images = []
    for name, idiom, size, scale in IOS_ICONS:
        pt = float(size.split("x")[0])
        px = round(pt * scale)
        # Ohne Alphakanal speichern (RGB). Apple lehnt ein 1024er Icon mit Alpha ab.
        save(ios_icon(px), f"{base}/AppIcon.appiconset/{name}", flatten=INK)
        images.append({"size": size, "idiom": idiom, "filename": name, "scale": f"{scale}x"})
    with open(os.path.join(ROOT, base, "AppIcon.appiconset", "Contents.json"), "w") as f:
        json.dump({"images": images, "info": {"version": 1, "author": "xcode"}}, f, indent=2)
        f.write("\n")
    with open(os.path.join(ROOT, base, "Contents.json"), "w") as f:
        json.dump({"info": {"version": 1, "author": "xcode"}}, f, indent=2)
        f.write("\n")

    # Startbild: Logo 120 pt, hell (dunkles Motiv) und dunkel (weisses Motiv)
    imgs = []
    for scale in (1, 2, 3):
        for appearance, color in ((None, INK), ("dark", WHITE)):
            px = 120 * scale
            name = f"LaunchLogo{'-dark' if appearance else ''}@{scale}x.png"
            save(tinted(px, color), f"{base}/LaunchLogo.imageset/{name}")
            e = {"idiom": "universal", "filename": name, "scale": f"{scale}x"}
            if appearance:
                e["appearances"] = [{"appearance": "luminosity", "value": "dark"}]
            imgs.append(e)
    with open(os.path.join(ROOT, base, "LaunchLogo.imageset", "Contents.json"), "w") as f:
        json.dump({"images": imgs, "info": {"version": 1, "author": "xcode"}}, f, indent=2)
        f.write("\n")

    def comp(hexrgb):
        return {"color-space": "srgb", "components": {
            "red": f"0x{hexrgb[0:2]}", "green": f"0x{hexrgb[2:4]}", "blue": f"0x{hexrgb[4:6]}", "alpha": "1.000"}}
    colors = {"colors": [
        {"idiom": "universal", "color": comp(CANVAS_LIGHT)},
        {"idiom": "universal", "appearances": [{"appearance": "luminosity", "value": "dark"}], "color": comp(CANVAS_DARK)},
    ], "info": {"version": 1, "author": "xcode"}}
    os.makedirs(os.path.join(ROOT, base, "LaunchBackground.colorset"), exist_ok=True)
    with open(os.path.join(ROOT, base, "LaunchBackground.colorset", "Contents.json"), "w") as f:
        json.dump(colors, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    android()
    ios()
    print(f"Motivbreite {MW}px, Eckradius-Verhaeltnis {RADIUS_RATIO:.4f}")
    print(f"Adaptiv: Motiv {ADAPTIVE_MOTIF*108:.1f} dp von 108 dp, Ringecke bei 30,0 dp (Sicherheitszone 33 dp)")
