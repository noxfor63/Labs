# Как отправить ролик ботом, с кнопками

Пост с кнопками может отправить только бот — в интерфейсе Telegram кнопку к
посту прикрепить нечем. Общий разбор в
`marketing/telegram/08-launch-checklist.md`, шаг 5a; здесь только то, что
отличается для видео.

**Файл никуда загружать не нужно.** Telegram умеет забирать видео по ссылке
сам, а ролик уже лежит в репозитории и приезжает на сервер с `git pull`.
Остаётся отдать его одним адресом.

## Шаг 1. Отдать ролик по ссылке (на сервере, один раз)

Вставьте блок целиком. Он снимает копию конфига, дописывает недостающее,
проверяет синтаксис и возвращает как было, если проверка не прошла. Повторный
запуск безопасен.

```bash
CONF=/etc/nginx/sites-available/vk-rideshare
BAK="$CONF.bak-$(date +%F-%H%M%S)"
cp "$CONF" "$BAK" && echo "Копия: $BAK"

python3 - "$CONF" <<'PYEOF'
import io, re, sys

path = sys.argv[1]
text = io.open(path, encoding='utf-8').read()

PROMO = """
    # Промо-ролик по прямой ссылке: Telegram забирает видео сам.
    location = /promo.mp4 {
        alias /opt/vk-rideshare/app/design/promo/video/po-puti-promo-1080.mp4;
        default_type video/mp4;
        add_header Cache-Control "public, max-age=86400";
    }
"""

listen = re.search(r'^[ \t]*listen[ \t]+443\b', text, re.M)
if listen is None:
    print('Не нашёл server-блок с listen 443 — ничего не меняю.')
    raise SystemExit(1)
if 'location = /promo.mp4' in text:
    print('Всё уже на месте — ничего не меняю.')
    raise SystemExit(0)

opened = text.rindex('{', 0, listen.start())
depth = 0
for i in range(opened, len(text)):
    if text[i] == '{':
        depth += 1
    elif text[i] == '}':
        depth -= 1
        if depth == 0:
            io.open(path, 'w', encoding='utf-8').write(text[:i] + PROMO + text[i:])
            print('Добавлено: /promo.mp4')
            raise SystemExit(0)
print('Не нашёл конец server-блока — ничего не меняю.')
raise SystemExit(1)
PYEOF

if nginx -t; then
  systemctl reload nginx
  echo "Готово."
else
  cp "$BAK" "$CONF"
  echo "Конфиг не прошёл проверку — вернул как было."
fi
```

Перед этим на сервере нужен свежий код, иначе файла ещё нет:

```bash
cd /opt/vk-rideshare/app && sudo -u rideshare -H git pull
```

Проверка — размер должен быть около 730 КБ:

```bash
curl -sI https://vk-rideshare.duckdns.org/promo.mp4 | head -3
```

## Шаг 2. Отправить пост

В облачной консоли (`shell.cloud.google.com`), потому что с вашего сервера и
домашней сети `api.telegram.org` закрыт — проверено, подробности в шаге 4а
чек-листа.

Подставьте канал в первой строке:

```bash
CHANNEL="@нужный_канал"

cat > post-video.json <<JSON
{
  "chat_id": "$CHANNEL",
  "video": "https://vk-rideshare.duckdns.org/promo.mp4",
  "caption": "Из Оренбурга в Соль-Илецк и Акбулак — теперь видно, кто едет.\n\n«По пути» показывает поездки по шести направлениям между тремя городами: время выезда, свободные места и цену за место. Всё это до того, как вы кому-то напишете. Цену назначает автор, в коридоре от 500 до 850 ₽.\n\nОткликнулись — автор видит заявку и решает сам, кого взять. Дальше договариваетесь напрямую.\n\nПриложение открывается внутри ВКонтакте и Telegram, устанавливать ничего не нужно. База объявлений общая — где удобнее, там и смотрите.\n\nПоездок пока мало: сервис только открылся. Если вы за рулём и на днях едете по любому из этих направлений — создайте поездку, это занимает минуту.",
  "supports_streaming": true,
  "reply_markup": {
    "inline_keyboard": [
      [
        {
          "text": "Открыть во ВКонтакте",
          "url": "https://vk.ru/app54794463"
        },
        {
          "text": "Открыть в Telegram",
          "url": "https://t.me/po_puti56_bot/app"
        }
      ]
    ]
  }
}
JSON

TOKEN=сюда_вставить_токен
curl -sS -m 60 "https://api.telegram.org/bot$TOKEN/sendVideo" \
  -H 'Content-Type: application/json' -d @post-video.json
```

Здесь `<<JSON` **без кавычек** — только поэтому `$CHANNEL` подставится. С
кавычками в файл попадёт само имя переменной.

В ответе ищите `"ok":true` и `"message_id"` — число запишите, по нему потом
меняется кнопка.

## Что знать про этот запрос

- **Метод `sendVideo`, а не `sendMessage`.** Текст идёт полем `caption`, и
  предел у него другой — 700 символов против 4096. Подпись в `caption.md`
  уложена в 653 символа именно поэтому.
- **Видео передаётся ссылкой, а не файлом.** Telegram скачивает его сам, и
  загружать ничего не надо. Предел для такого способа — 20 МБ, у нас 730 КБ.
- **Ссылки убраны из подписи** и переехали в кнопки. Оставить их в обоих
  местах — показать одно и то же дважды.
- **`supports_streaming`** даёт проигрывание без полной загрузки. На ролике в
  730 КБ разница невелика, но в мобильной сети заметна.
- **Кнопки только типа `url`.** `web_app` работает лишь в приватном чате с
  ботом, в канал его не поставить.

## Если вместо `"ok":true` пришла ошибка

| Что в ответе | Что это значит |
| --- | --- |
| `Bad Request: failed to get HTTP URL content` | Telegram не смог скачать видео — проверьте шаг 1 через `curl -sI` |
| `Bad Request: wrong file identifier/HTTP URL specified` | В поле `video` не ссылка или она без `https://` |
| `Bad Request: message caption is too long` | Подпись длиннее 700 символов |
| `Bad Request: chat not found` | @username канала неверен или бот не администратор |
| `curl: (28)` | `api.telegram.org` недоступен из этой сети — отправляйте из облачной консоли |
