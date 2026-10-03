#!/usr/bin/env python3
"""
Сборка анимированной иконки загрузки в формате Lottie.

Генератором, а не файлом в репозитории: Lottie — это JSON с десятками
повторяющихся слоёв, и править такое руками means ошибаться. Здесь
описаны только исходные величины, остальное считается.

Геометрия взята из design/app-icon.svg: те же координаты, делённые на
1024/96 — анимация обязана совпадать со статичной иконкой, иначе при
загрузке знак «дёргается».
"""
import json
import sys
from pathlib import Path

# Холст VK требует 96×96, исходник иконки нарисован в 1024.
CANVAS = 96
SCALE = 1024 / CANVAS

FPS = 60
# Длительность петли: за полторы секунды глаз успевает проследить маршрут,
# а ожидание не кажется застывшим.
TOTAL = 100

WHITE = [1, 1, 1, 1]
ACCENT = [0xE2 / 255, 0x61 / 255, 0x3C / 255, 1]

# Градиент фона — те же три цвета, что в SVG.
GRADIENT = [
    (0.00, (0xA3, 0x3A, 0x22)),
    (0.55, (0xE2, 0x61, 0x3C)),
    (1.00, (0xFF, 0xA7, 0x6B)),
]


def p(x: float, y: float) -> list[float]:
    """Точка из системы координат иконки (1024) в систему анимации (96)."""
    return [round(x / SCALE, 3), round(y / SCALE, 3)]


def r(value: float) -> float:
    """Радиус или длина из системы координат иконки."""
    return round(value / SCALE, 3)


def ease(frame: int, value: list[float], nxt: bool = True) -> dict:
    """Ключевой кадр с мягким входом и выходом."""
    key: dict = {"t": frame, "s": value}
    if nxt:
        dims = len(value)
        key["i"] = {"x": [0.35] * dims, "y": [1] * dims}
        key["o"] = {"x": [0.65] * dims, "y": [0] * dims}
    return key


def transform(position: list[float], opacity: list[dict], scale: list[dict]) -> dict:
    return {
        "o": {"a": 1, "k": opacity},
        "r": {"a": 0, "k": 0},
        "p": {"a": 0, "k": [position[0], position[1], 0]},
        "a": {"a": 0, "k": [0, 0, 0]},
        "s": {"a": 1, "k": scale},
    }


def appear(start: int) -> tuple[list[dict], list[dict]]:
    """
    Появление элемента: проявляется и чуть перелетает нужный размер.

    Перелёт на 15 % — не украшение: без него появление читается как
    мигание, а с ним как «встало на место».
    """
    fade_out = TOTAL - 14
    opacity = [
        ease(start, [0]),
        ease(start + 8, [100]),
        ease(fade_out, [100]),
        ease(TOTAL - 2, [0], nxt=False),
    ]
    scale = [
        ease(start, [40, 40, 100]),
        ease(start + 7, [115, 115, 100]),
        ease(start + 12, [100, 100, 100]),
        ease(fade_out, [100, 100, 100]),
        ease(TOTAL - 2, [60, 60, 100], nxt=False),
    ]
    return opacity, scale


def ellipse(size: float, colour: list[float]) -> dict:
    return {
        "ty": "gr",
        "it": [
            {"ty": "el", "p": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [size, size]}, "d": 1},
            {"ty": "fl", "c": {"a": 0, "k": colour}, "o": {"a": 0, "k": 100}, "r": 1},
            {
                "ty": "tr",
                "p": {"a": 0, "k": [0, 0]},
                "a": {"a": 0, "k": [0, 0]},
                "s": {"a": 0, "k": [100, 100]},
                "r": {"a": 0, "k": 0},
                "o": {"a": 0, "k": 100},
            },
        ],
    }


def shape_layer(index: int, name: str, shapes: list[dict], position: list[float], start: int) -> dict:
    opacity, scale = appear(start)
    return {
        "ddd": 0,
        "ind": index,
        "ty": 4,
        "nm": name,
        "sr": 1,
        "ks": transform(position, opacity, scale),
        "ao": 0,
        "shapes": shapes,
        "ip": 0,
        "op": TOTAL,
        "st": 0,
        "bm": 0,
    }


def pin_path() -> dict:
    """
    Контур метки теми же кривыми, что в SVG.

    Дуга `A 92 92 0 1 1` в исходнике — ровно полуокружность (хорда равна
    диаметру), поэтому она разложена на две четверти с управляющим
    коэффициентом 0.5523: это стандартное приближение четверти круга
    кубической кривой.
    """
    k = 0.5523 * 92
    vertices = [p(700, 440), p(608, 296), p(700, 204), p(792, 296)]
    out_tangents = [
        [r(-64), r(-80)],
        [0, r(-k)],
        [r(k), 0],
        [0, r(34)],
    ]
    in_tangents = [
        [r(64), r(-80)],
        [0, r(34)],
        [r(-k), 0],
        [0, r(-k)],
    ]
    # Вершины заданы в системе холста, а слой стоит в нуле — смещаем
    # контур так же, как остальные фигуры рисуются от центра слоя.
    centre = p(700, 296)
    vertices = [[v[0] - centre[0], v[1] - centre[1]] for v in vertices]

    return {
        "ty": "gr",
        "it": [
            {
                "ty": "sh",
                "ks": {"a": 0, "k": {"c": True, "v": vertices, "i": in_tangents, "o": out_tangents}},
            },
            {"ty": "fl", "c": {"a": 0, "k": WHITE}, "o": {"a": 0, "k": 100}, "r": 1},
            {
                "ty": "tr",
                "p": {"a": 0, "k": [0, 0]},
                "a": {"a": 0, "k": [0, 0]},
                "s": {"a": 0, "k": [100, 100]},
                "r": {"a": 0, "k": 0},
                "o": {"a": 0, "k": 100},
            },
        ],
    }


def background() -> dict:
    stops: list[float] = []
    for position, (red, green, blue) in GRADIENT:
        stops += [position, round(red / 255, 4), round(green / 255, 4), round(blue / 255, 4)]

    return {
        "ddd": 0,
        "ind": 99,
        "ty": 4,
        "nm": "fon",
        "sr": 1,
        "ks": {
            "o": {"a": 0, "k": 100},
            "r": {"a": 0, "k": 0},
            "p": {"a": 0, "k": [CANVAS / 2, CANVAS / 2, 0]},
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": {"a": 0, "k": [100, 100, 100]},
        },
        "ao": 0,
        "shapes": [
            {
                "ty": "gr",
                "it": [
                    {
                        "ty": "rc",
                        "p": {"a": 0, "k": [0, 0]},
                        "s": {"a": 0, "k": [CANVAS, CANVAS]},
                        "r": {"a": 0, "k": 20},
                    },
                    {
                        "ty": "gf",
                        "o": {"a": 0, "k": 100},
                        "r": 1,
                        "t": 1,
                        "g": {"p": len(GRADIENT), "k": {"a": 0, "k": stops}},
                        "s": {"a": 0, "k": [-CANVAS / 2, -CANVAS / 2]},
                        "e": {"a": 0, "k": [CANVAS / 2, CANVAS / 2]},
                    },
                    {
                        "ty": "tr",
                        "p": {"a": 0, "k": [0, 0]},
                        "a": {"a": 0, "k": [0, 0]},
                        "s": {"a": 0, "k": [100, 100]},
                        "r": {"a": 0, "k": 0},
                        "o": {"a": 0, "k": 100},
                    },
                ],
            }
        ],
        "ip": 0,
        "op": TOTAL,
        "st": 0,
        "bm": 0,
    }


def build() -> dict:
    # Точки на кривой маршрута: значения t подобраны так, чтобы шаг по
    # длине выглядел равномерным — у квадратичной кривой он неравномерен.
    route = [(325, 620), (381, 537), (454, 486), (543, 456), (624, 443)]

    layers: list[dict] = []
    index = 1

    # Метка назначения появляется последней — к ней ведёт маршрут.
    layers.append(
        shape_layer(index, "metka", [ellipse(r(78), ACCENT), pin_path()], p(700, 296), 54)
    )
    index += 1

    for number, (x, y) in enumerate(reversed(route)):
        start = 44 - number * 7
        layers.append(shape_layer(index, f"tochka{number}", [ellipse(r(42), WHITE)], p(x, y), start))
        index += 1

    layers.append(
        shape_layer(
            index,
            "nachalo",
            [ellipse(r(54), ACCENT), ellipse(r(128), WHITE)],
            p(300, 760),
            0,
        )
    )

    layers.append(background())

    return {
        "v": "5.7.4",
        "fr": FPS,
        "ip": 0,
        "op": TOTAL,
        "w": CANVAS,
        "h": CANVAS,
        "nm": "Poisk poputchikov — zagruzka",
        "ddd": 0,
        "assets": [],
        "layers": layers,
    }


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "design/app-icon-loader.json")
    data = build()
    # separators без пробелов: лимит 24 КБ, а читать этот файл всё равно
    # будет плеер, а не человек.
    out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    size = out.stat().st_size
    print(f"{out} — {size} байт ({size / 1024:.1f} КБ из 24)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
