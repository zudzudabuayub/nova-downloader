"""Генератор ролика «Нейросети за минуту».

Рисует кадры через Pillow, синтезирует фоновую музыку через numpy
и собирает всё в MP4 через ffmpeg.

Запуск: python3 videos/make_neural_video.py
"""
import math
import os
import random
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 30
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(OUT_DIR, "neural-networks.mp4")
WAV = os.path.join(OUT_DIR, "_music.wav")

FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_M = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
_fonts = {}


def font(path, size):
    key = (path, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, size)
    return _fonts[key]


BG_TOP = np.array([8, 10, 28])
BG_BOT = np.array([22, 8, 48])
CYAN = (64, 224, 255)
PINK = (255, 92, 180)
GOLD = (255, 200, 80)
WHITE = (240, 244, 255)
GREY = (150, 160, 190)

_grad = np.linspace(0, 1, H)[:, None, None]
BG = (BG_TOP * (1 - _grad) + BG_BOT * _grad).astype(np.uint8)
BG = np.repeat(BG, W, axis=1)

random.seed(7)
STARS = [(random.uniform(0, W), random.uniform(0, H), random.uniform(0.3, 1)) for _ in range(140)]


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))


BG_MID = (15, 9, 38)


def fade(c, a):
    """Цвет c с непрозрачностью a поверх фона."""
    return mix(BG_MID, c, max(0.0, min(1.0, a)))


def background(t):
    img = Image.fromarray(BG.copy())
    d = ImageDraw.Draw(img)
    for i, (x, y, s) in enumerate(STARS):
        x = (x + t * 12 * s) % W
        a = 0.35 + 0.35 * math.sin(t * 2 + i)
        r = 1 + s
        d.ellipse([x - r, y - r, x + r, y + r], fill=fade(WHITE, a * s * 0.8))
    return img, d


def text_center(d, y, s, f, color, alpha=1.0):
    w = d.textlength(s, font=f)
    d.text(((W - w) / 2, y), s, font=f, fill=fade(color, alpha))


def glow_circle(d, x, y, r, color, a=1.0):
    for k in range(4, 0, -1):
        rr = r + k * 4
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=fade(color, a * 0.08 * (5 - k)))
    d.ellipse([x - r, y - r, x + r, y + r], fill=fade(color, a))


# ---------- Сеть, используемая в нескольких сценах ----------
def layer_positions(layers, x0, x1, y0, y1):
    pos = []
    for i, n in enumerate(layers):
        x = lerp(x0, x1, i / (len(layers) - 1))
        col = []
        for j in range(n):
            y = (y0 + y1) / 2 if n == 1 else lerp(y0, y1, j / (n - 1))
            col.append((x, y))
        pos.append(col)
    return pos


def draw_network(d, pos, t, alpha=1.0, pulse=True, appear=1.0):
    nl = len(pos)
    for li in range(nl - 1):
        la = ease(appear * nl - li - 0.5)
        if la <= 0:
            continue
        for (x1, y1) in pos[li]:
            for (x2, y2) in pos[li + 1]:
                c = mix(CYAN, PINK, li / max(1, nl - 2))
                d.line([x1, y1, x2, y2], fill=fade(c, 0.22 * alpha * la), width=1)
    if pulse:
        # сигнал бежит слева направо
        phase = (t * 0.6) % 1.0
        seg = phase * (nl - 1)
        li = int(seg)
        f = seg - li
        if li < nl - 1:
            for a_i, (x1, y1) in enumerate(pos[li]):
                for b_i, (x2, y2) in enumerate(pos[li + 1]):
                    if (a_i + b_i + li) % 2:
                        continue
                    px, py = lerp(x1, x2, f), lerp(y1, y2, f)
                    d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=fade(GOLD, alpha))
    for li, col in enumerate(pos):
        la = ease(appear * nl - li)
        if la <= 0:
            continue
        c = mix(CYAN, PINK, li / (nl - 1))
        for j, (x, y) in enumerate(col):
            act = 0.6 + 0.4 * math.sin(t * 3 + li * 1.3 + j)
            glow_circle(d, x, y, 11, c, alpha * la * act)


# ---------- Сцены ----------
def scene_title(t, dur):
    img, d = background(t)
    pos = layer_positions([4, 6, 6, 3], 150, 1130, 120, 600)
    draw_network(d, pos, t, alpha=0.45, appear=t / 2.0)
    a = ease(t / 1.2) * ease((dur - t) / 0.6)
    overlay = Image.new("RGB", (W, H), (0, 0, 0))
    img = Image.blend(img, overlay, 0.25 * a)
    d = ImageDraw.Draw(img)
    s = 1 + 0.03 * math.sin(t * 2)
    text_center(d, 250, "НЕЙРОСЕТИ", font(FONT_B, int(110 * s)), WHITE, a)
    text_center(d, 395, "как машины учатся думать", font(FONT_R, 38), CYAN, ease((t - 0.8) / 1) * a)
    return img


def scene_what(t, dur):
    img, d = background(t)
    a = ease(t / 0.6) * ease((dur - t) / 0.5)
    text_center(d, 60, "Что такое нейросеть?", font(FONT_B, 54), WHITE, a)
    # мозг слева, сеть справа
    random.seed(3)
    cx, cy = 330, 400
    pts = [(cx + random.gauss(0, 110), cy + random.gauss(0, 80)) for _ in range(40)]
    for i, p in enumerate(pts):
        for q in pts[i + 1:]:
            if math.dist(p, q) < 75:
                d.line([*p, *q], fill=fade(PINK, 0.35 * a), width=1)
    for i, (x, y) in enumerate(pts):
        glow_circle(d, x, y, 5, PINK, a * (0.5 + 0.5 * math.sin(t * 4 + i)))
    text_center_at(d, cx, 560, "мозг: ~86 млрд нейронов", font(FONT_R, 26), GREY, a)
    arrow_a = ease((t - 1.0) / 0.8) * a
    d.line([560, 400, 700, 400], fill=fade(GOLD, arrow_a), width=5)
    d.polygon([(700, 385), (725, 400), (700, 415)], fill=fade(GOLD, arrow_a))
    pos = layer_positions([3, 5, 5, 2], 800, 1150, 250, 540)
    draw_network(d, pos, t, alpha=a, appear=ease((t - 1.3) / 1.5))
    text_center_at(d, 975, 590, "нейросеть: математическая модель", font(FONT_R, 26), GREY,
                   ease((t - 2.2) / 0.8) * a)
    sub = ease((t - 3.0) / 0.8) * a
    text_center(d, 150, "Программа, которая учится на примерах, а не по жёстким правилам",
                font(FONT_R, 28), CYAN, sub)
    return img


def text_center_at(d, cx, y, s, f, color, alpha=1.0):
    w = d.textlength(s, font=f)
    d.text((cx - w / 2, y), s, font=f, fill=fade(color, alpha))


def scene_neuron(t, dur):
    img, d = background(t)
    a = ease(t / 0.6) * ease((dur - t) / 0.5)
    text_center(d, 50, "Искусственный нейрон", font(FONT_B, 54), WHITE, a)
    nx, ny = 700, 380
    inputs = [(260, 230), (260, 380), (260, 530)]
    labels = ["x₁", "x₂", "x₃"]
    weights = ["w₁", "w₂", "w₃"]
    for i, ((x, y), lab, wl) in enumerate(zip(inputs, labels, weights)):
        ia = ease((t - 0.3 * i) / 0.6) * a
        d.line([x, y, nx - 60, ny], fill=fade(CYAN, 0.7 * ia), width=3)
        glow_circle(d, x, y, 26, CYAN, ia * 0.9)
        text_center_at(d, x, y - 17, lab, font(FONT_B, 28), (10, 10, 30), ia)
        mx, my = lerp(x, nx - 60, 0.5), lerp(y, ny, 0.5)
        d.text((mx - 10, my - 40), wl, font=font(FONT_B, 26), fill=fade(GOLD, ia))
        # бегущий сигнал
        f = (t * 0.8 + i * 0.2) % 1
        px, py = lerp(x, nx - 60, f), lerp(y, ny, f)
        d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=fade(GOLD, ia))
    na = ease((t - 1.0) / 0.6) * a
    glow_circle(d, nx, ny, 62, PINK, na)
    text_center_at(d, nx, ny - 32, "Σ", font(FONT_B, 54), WHITE, na)
    oa = ease((t - 1.6) / 0.6) * a
    d.line([nx + 62, ny, 1080, ny], fill=fade(PINK, oa), width=4)
    d.polygon([(1080, ny - 12), (1105, ny), (1080, ny + 12)], fill=fade(PINK, oa))
    d.text((1120, ny - 20), "y", font=font(FONT_B, 36), fill=fade(WHITE, oa))
    fa = ease((t - 2.4) / 0.8) * a
    text_center(d, 600, "y = f( w₁·x₁ + w₂·x₂ + w₃·x₃ + b )", font(FONT_M, 38), GOLD, fa)
    text_center(d, 655, "входы × веса → сумма → функция активации", font(FONT_R, 26), GREY, fa)
    return img


def scene_layers(t, dur):
    img, d = background(t)
    a = ease(t / 0.6) * ease((dur - t) / 0.5)
    text_center(d, 50, "Слои нейросети", font(FONT_B, 54), WHITE, a)
    pos = layer_positions([4, 7, 7, 7, 3], 200, 1080, 170, 560)
    draw_network(d, pos, t, alpha=a, appear=ease(t / 2.0))
    la = ease((t - 1.5) / 0.8) * a
    f = font(FONT_R, 26)
    text_center_at(d, 200, 600, "вход", f, CYAN, la)
    text_center_at(d, 640, 600, "скрытые слои", f, mix(CYAN, PINK, 0.5), la)
    text_center_at(d, 1080, 600, "выход", f, PINK, la)
    d.text((140, 125), "пиксели", font=font(FONT_R, 22), fill=fade(GREY, la))
    d.text((1035, 125), "«кошка»", font=font(FONT_R, 22), fill=fade(GREY, la))
    sa = ease((t - 3.0) / 0.8) * a
    text_center(d, 650, "Много скрытых слоёв = «глубокое обучение» (deep learning)",
                font(FONT_R, 28), GOLD, sa)
    return img


def scene_training(t, dur):
    img, d = background(t)
    a = ease(t / 0.6) * ease((dur - t) / 0.5)
    text_center(d, 50, "Как нейросеть учится", font(FONT_B, 54), WHITE, a)
    steps = ["1. Делает прогноз", "2. Считает ошибку", "3. Подправляет веса", "4. Повторяет миллионы раз"]
    for i, s in enumerate(steps):
        sa = ease((t - 0.4 - i * 0.7) / 0.5) * a
        d.text((90 + (1 - sa) * -40, 190 + i * 85), s, font=font(FONT_R, 34), fill=fade(WHITE, sa))
        glow_circle(d, 65, 210 + i * 85, 7, mix(CYAN, PINK, i / 3), sa)
    # график ошибки
    gx0, gy0, gx1, gy1 = 680, 170, 1180, 560
    ga = ease((t - 0.8) / 0.6) * a
    d.line([gx0, gy1, gx1, gy1], fill=fade(GREY, ga), width=2)
    d.line([gx0, gy0, gx0, gy1], fill=fade(GREY, ga), width=2)
    d.text((gx0 + 10, gy0 - 40), "ошибка", font=font(FONT_R, 24), fill=fade(GREY, ga))
    d.text((gx1 - 90, gy1 + 10), "эпохи", font=font(FONT_R, 24), fill=fade(GREY, ga))
    prog = ease((t - 1.2) / (dur - 2.0))
    n = max(2, int(200 * prog))
    pts = []
    random.seed(11)
    noise = [random.uniform(-1, 1) for _ in range(201)]
    for k in range(n):
        u = k / 200
        val = 0.9 * math.exp(-4.5 * u) + 0.06 + 0.035 * noise[k] * (1 - u)
        pts.append((lerp(gx0, gx1, u), lerp(gy1, gy0, val)))
    if len(pts) > 1:
        d.line(pts, fill=fade(PINK, ga), width=4, joint="curve")
        x, y = pts[-1]
        glow_circle(d, x, y, 8, GOLD, ga)
    return img


APPS = [
    ("Чат-боты и тексты", "пишут, переводят, отвечают"),
    ("Изображения и видео", "рисуют картинки, распознают лица"),
    ("Речь", "голосовые помощники, субтитры"),
    ("Медицина", "находят болезни на снимках"),
    ("Беспилотники", "видят дорогу и пешеходов"),
    ("Наука", "предсказывают структуру белков"),
]


def scene_apps(t, dur):
    img, d = background(t)
    a = ease(t / 0.6) * ease((dur - t) / 0.5)
    text_center(d, 50, "Где работают нейросети", font(FONT_B, 54), WHITE, a)
    for i, (title, desc) in enumerate(APPS):
        col, row = i % 2, i // 2
        x = 110 + col * 560
        y = 160 + row * 160
        ca = ease((t - 0.3 - i * 0.45) / 0.5) * a
        c = mix(CYAN, PINK, i / 5)
        dy = (1 - ca) * 30
        d.rounded_rectangle([x, y + dy, x + 510, y + 130 + dy], radius=18,
                            outline=fade(c, ca), width=3, fill=fade((20, 22, 55), ca))
        d.text((x + 28, y + 24 + dy), title, font=font(FONT_B, 32), fill=fade(c, ca))
        d.text((x + 28, y + 76 + dy), desc, font=font(FONT_R, 22), fill=fade(GREY, ca))
    return img


def scene_final(t, dur):
    img, d = background(t)
    pos = layer_positions([5, 8, 8, 5], 150, 1130, 110, 610)
    draw_network(d, pos, t, alpha=0.35)
    a = ease(t / 0.8) * ease((dur - t) / 1.0)
    text_center(d, 210, "Нейросеть — не магия,", font(FONT_B, 60), WHITE, a)
    text_center(d, 310, "а математика + данные + обучение", font(FONT_B, 44), CYAN,
                ease((t - 0.8) / 0.8) * a)
    text_center(d, 440, "Будущее уже здесь", font(FONT_R, 40), GOLD, ease((t - 1.8) / 0.8) * a)
    return img


SCENES = [
    (scene_title, 5.0),
    (scene_what, 7.0),
    (scene_neuron, 8.0),
    (scene_layers, 7.0),
    (scene_training, 8.0),
    (scene_apps, 8.0),
    (scene_final, 6.0),
]


# ---------- Музыка ----------
def make_music(seconds, path, sr=44100):
    tt = np.arange(int(seconds * sr)) / sr
    # Am - F - C - G, по 4 секунды
    chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63],
              [196.0, 261.63, 329.63], [196.0, 246.94, 293.66]]
    out = np.zeros_like(tt)
    seg = 4.0
    for k in range(int(math.ceil(seconds / seg))):
        s0, s1 = int(k * seg * sr), int(min(seconds, (k + 1) * seg + 1) * sr)
        local = tt[s0:s1] - k * seg
        env = np.minimum(1, local / 1.0) * np.exp(-np.maximum(0, local - seg) * 3)
        for f in chords[k % 4]:
            for det in (1.0, 1.003):
                out[s0:s1] += 0.06 * env * np.sin(2 * np.pi * f * det * local)
            out[s0:s1] += 0.03 * env * np.sin(2 * np.pi * f / 2 * local)
    # лёгкие «пульсы» арпеджио
    step = 0.25
    for k in range(int(seconds / step)):
        s0 = int(k * step * sr)
        s1 = min(len(tt), s0 + int(0.4 * sr))
        local = tt[s0:s1] - k * step
        chord = chords[int(k * step / seg) % 4]
        f = chord[k % 3] * 2
        out[s0:s1] += 0.035 * np.exp(-local * 9) * np.sin(2 * np.pi * f * local)
    fade_n = int(2 * sr)
    out[-fade_n:] *= np.linspace(1, 0, fade_n)
    out[: int(0.5 * sr)] *= np.linspace(0, 1, int(0.5 * sr))
    out /= np.max(np.abs(out)) * 1.15
    data = (out * 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(data.tobytes())


def main():
    total = sum(dur for _, dur in SCENES)
    make_music(total, WAV)
    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", WAV,
           "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for fn, dur in SCENES:
        for i in range(int(dur * FPS)):
            t = i / FPS
            img = fn(t, dur)
            proc.stdin.write(img.tobytes())
    proc.stdin.close()
    proc.wait()
    os.remove(WAV)
    print("Готово:", OUT, f"({total:.0f} c)")


if __name__ == "__main__":
    main()
