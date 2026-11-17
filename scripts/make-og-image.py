#!/usr/bin/env python3
"""Regenerate public/og.png and public/og-demo.png — the 1200x630 link-preview card.

Run after changing the logo or the app's name/tagline:

    python3 scripts/make-og-image.py

1200x630 is the size Slack, LinkedIn, X and WhatsApp all crop cleanly. A
square image (which is what they fell back to when no og:image was set)
renders as a full-width block that dwarfs the message around it.
"""

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (255, 255, 255)
BODY = (82, 92, 88)
MUTED = (140, 150, 146)

FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
bold = lambda s: ImageFont.truetype(FONT, s, index=1)
medium = lambda s: ImageFont.truetype(FONT, s, index=10)
regular = lambda s: ImageFont.truetype(FONT, s, index=0)

# Product-neutral card. og-demo.png carries the demo URL; og.png is the same
# card without it, for self-hosted installs.
demo = Image.new("RGBA", (W, H), (*BG, 255))
demo_draw = ImageDraw.Draw(demo)
demo_draw.rectangle([0, 0, 12, H], fill=(59, 130, 246))

mark_center = (235, H // 2)
mark_radius = 92
for offset, color in [
    ((0, -68), (52, 211, 153)),
    ((68, 0), (251, 191, 36)),
    ((0, 68), (244, 114, 182)),
    ((-68, 0), (96, 165, 250)),
]:
    cx = mark_center[0] + offset[0]
    cy = mark_center[1] + offset[1]
    demo_draw.ellipse(
        [cx - mark_radius, cy - mark_radius, cx + mark_radius, cy + mark_radius],
        fill=(*color, 184),
    )
demo_draw.ellipse([207, 287, 263, 343], fill=BG)

demo_draw.text((455, 224), "Time Off", font=bold(86), fill=(23, 23, 23))
demo_draw.text(
    (455, 330),
    "Leave requests without the spreadsheet",
    font=medium(34),
    fill=BODY,
)

demo.convert("RGB").save("public/og.png", optimize=True)
print(f"wrote public/og.png ({W}x{H})")
demo_draw.text((455, 386), "time-off.autotakt.dev", font=regular(28), fill=MUTED)
demo.convert("RGB").save("public/og-demo.png", optimize=True)
print(f"wrote public/og-demo.png ({W}x{H})")
