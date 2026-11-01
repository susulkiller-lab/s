"""pdf2md.ico 생성기. 실행: python make_icon.py  (Pillow, numpy 필요)

초록 바탕에 PDF 문서와 Markdown 표지(M↓)가 겹친 모양. 크기별로 따로 줄여 16~256px을 한 파일에 담고, 24px 이하는 단순화한 그림을 쓴다.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
S = 1024                                  # 작업 해상도


def gradient(size, c0, c1):
    """왼쪽 위(c0)에서 오른쪽 아래(c1)로 가는 대각 그라데이션."""
    y, x = np.mgrid[0:size, 0:size]
    t = ((x + y) / (2 * (size - 1)))[..., None]
    arr = np.array(c0)[None, None, :] * (1 - t) + np.array(c1)[None, None, :] * t
    return Image.fromarray(arr.astype("uint8"), "RGB").convert("RGBA")


def shadow(layer_mask, blur, offset, alpha):
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    black = Image.new("RGBA", (S, S), (6, 30, 24, alpha))
    sh.paste(black, offset, layer_mask)
    return sh.filter(ImageFilter.GaussianBlur(blur))


def center_text(d, box, text, font, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text(((x0 + x1) / 2 - (l + r) / 2, (y0 + y1) / 2 - (t + b) / 2), text, font=font, fill=fill)


def master(small=False):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg = gradient(S, (36, 124, 99), (11, 58, 46))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((24, 24, S - 24, S - 24), radius=230, fill=255)
    img.paste(bg, (0, 0), mask)

    # 문서(오른쪽 위 모서리 접힘)
    px0, py0, px1, py1, fold = 170, 130, 640, 790, 150
    page = Image.new("L", (S, S), 0)
    pd = ImageDraw.Draw(page)
    pd.rounded_rectangle((px0, py0, px1, py1), radius=46, fill=255)
    pd.polygon([(px1 - fold, py0 - 2), (px1 + 2, py0 - 2), (px1 + 2, py0 + fold)], fill=0)
    img = Image.alpha_composite(img, shadow(page, 22, (10, 22), 120))
    white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    img.paste(white, (0, 0), page)
    d = ImageDraw.Draw(img)
    d.polygon([(px1 - fold, py0), (px1 - fold, py0 + fold - 14), (px1 - 14, py0 + fold)], fill=(205, 222, 215, 255))

    # PDF 띠
    bx0, by0, bx1, by1 = (110, 300, 570, 520) if small else (120, 330, 560, 490)
    band = Image.new("L", (S, S), 0)
    ImageDraw.Draw(band).rounded_rectangle((bx0, by0, bx1, by1), radius=30, fill=255)
    img = Image.alpha_composite(img, shadow(band, 10, (4, 8), 90))
    img.paste(Image.new("RGBA", (S, S), (233, 74, 49, 255)), (0, 0), band)
    d = ImageDraw.Draw(img)
    if not small:
        center_text(d, (bx0, by0, bx1, by1), "PDF", ImageFont.truetype(BOLD, 128), (255, 255, 255, 255))
        for w, y in ((330, 560), (330, 620), (210, 680)):         # 본문 줄
            d.rounded_rectangle((px0 + 70, y, px0 + 70 + w, y + 28), radius=14, fill=(196, 212, 206, 255))

    # Markdown 표지(M↓)
    gx0, gy0, gx1, gy1 = (430, 520, 910, 900) if small else (470, 560, 900, 880)
    ring = Image.new("L", (S, S), 0)
    ImageDraw.Draw(ring).rounded_rectangle((gx0 - 22, gy0 - 22, gx1 + 22, gy1 + 22), radius=82, fill=255)
    img.paste(Image.new("RGBA", (S, S), (14, 66, 52, 255)), (0, 0), ring)
    badge = Image.new("L", (S, S), 0)
    ImageDraw.Draw(badge).rounded_rectangle((gx0, gy0, gx1, gy1), radius=64, fill=255)
    img = Image.alpha_composite(img, shadow(badge, 14, (6, 14), 110))
    img.paste(Image.new("RGBA", (S, S), (246, 250, 248, 255)), (0, 0), badge)
    d = ImageDraw.Draw(img)
    green = (18, 78, 62, 255)
    k = 1.18 if small else 1.0                       # 작은 크기에서는 M↓를 키운다
    center_text(d, (gx0 + 8, gy0, gx0 + int(255 * k), gy1), "M", ImageFont.truetype(BOLD, int(250 * k)), green)
    ax = gx0 + int(330 * k)                          # 아래 화살표
    d.rectangle((ax - int(24 * k), gy0 + 90, ax + int(24 * k), gy0 + 190), fill=green)
    d.polygon([(ax - int(66 * k), gy0 + 180), (ax + int(66 * k), gy0 + 180), (ax, gy0 + 262)], fill=green)
    return img


def main():
    m, m_small = master(), master(small=True)
    sizes = [256, 128, 64, 48, 32, 24, 16]
    frames = [(m_small if n <= 24 else m).resize((n, n), Image.LANCZOS) for n in sizes]
    out = HERE / "pdf2md.ico"
    frames[0].save(out, format="ICO", sizes=[(n, n) for n in sizes], append_images=frames[1:])
    m.resize((512, 512), Image.LANCZOS).save(HERE / "pdf2md_icon_preview.png")
    print(out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
