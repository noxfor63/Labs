# Отправить ролик ботом, с кнопкой — с самого начала

Пост с кнопкой может отправить только бот: в интерфейсе Telegram кнопку к
посту прикрепить нечем. Ниже весь путь, ничего не предполагая заранее.

**Файл никуда загружать не нужно.** Telegram забирает видео по ссылке сам, а
ролик лежит в репозитории и приезжает на сервер обычным `git pull`.

Нужны три вещи: ролик по адресу, токен бота и ваш числовой идентификатор в
Telegram. Дальше по порядку.

---

## Часть 1. Отдать ролик по ссылке (на сервере, один раз)

### 1.1. Забрать свежий код

```bash
ssh root@ВАШ_IP
cd /opt/vk-rideshare/app
sudo -u rideshare -H git pull
```

Должно быть `Fast-forward` или `Already up to date`, но **не** `Aborting`.
Прервалось из-за `package-lock.json` — `sudo -u rideshare -H git checkout --
package-lock.json`, затем `git pull` заново.

Проверить, что файл на месте:

```bash
ls -la design/promo/video/po-puti-promo-1080.mp4
```

### 1.2. Добавить адрес в nginx

Вставьте блок целиком. Он снимает копию конфига, дописывает недостающее,
проверяет синтаксис и возвращает как было, если проверка не прошла. Запускать
можно сколько угодно раз.

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

### 1.3. Проверить

```bash
curl -sI https://vk-rideshare.duckdns.org/promo.mp4 | head -3
```

Нужен `HTTP/2 200` и `content-length` около 746000. Если `404` — блок не
применился; если `403` — nginx не читает файл, проверьте права на каталог.

### 1.4. Забрать токен бота

Он понадобится в части 3. Показать на экране, чтобы скопировать:

```bash
grep '^TELEGRAM_BOT_TOKEN=' /opt/vk-rideshare/app/.env
```

Скопируйте то, что после знака равенства, без кавычек. В конце инструкции
сказано, что с ним потом сделать.

---

## Часть 2. Узнать свой номер в Telegram

Нужен, чтобы сначала отправить пост себе, а не сразу в канал. Самый простой
способ — без всякой консоли:

**В Telegram напишите боту `@userinfobot`.** Он ответит числом из девяти-десяти
цифр. Это и есть ваш идентификатор.

---

## Часть 3. Отправить пост себе

С вашего сервера и из домашней сети `api.telegram.org` недоступен — проверено
по обоим протоколам. Поэтому отправка идёт из облачной консоли.

### 3.1. Открыть консоль

Браузер → `shell.cloud.google.com` → войти в аккаунт Google. Если спросит про
проект, можно пропустить. Через полминуты появится приглашение вида
`имя@cloudshell:~$` — **это не ваш сервер**, дальше всё делается здесь.

### 3.2. Убедиться, что отсюда Telegram доступен

```bash
curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://api.telegram.org
```

Любой код — 200, 404, 302 — значит связь есть. Таймаут означает, что закрыто и
здесь; тогда остаётся публиковать руками, без кнопки.

### 3.3. Создать файл поста

Подставьте свой номер в первой строке и вставьте блок целиком:

```bash
CHAT="ВАШ_НОМЕР"

cat > post-video.json <<JSON
{
  "chat_id": "$CHAT",
  "video": "https://vk-rideshare.duckdns.org/promo.mp4",
  "caption": "«По пути» — приложение для поиска попутчиков между Оренбургом, Соль-Илецком и Акбулаком. Открывается внутри ВКонтакте и Telegram, база объявлений общая — где удобнее, там и смотрите.\n\nВидно, кто едет: направление, время выезда, свободные места и цена за место. Откликнулись — автор видит заявку и сам решает, кого взять.\n\nПоездок сейчас мало, сервис открылся недавно. Если вы водитель и на днях едете по любому из этих направлений — создайте поездку, это занимает минуту. Без водителей приложение бесполезно, и это единственное, о чём стоит просить на старте.\n\nВерсия для ВКонтакте: <a href=\"https://vk.ru/app54794463\">vk.ru/app54794463</a>",
  "parse_mode": "HTML",
  "supports_streaming": true,
  "reply_markup": {
    "inline_keyboard": [
      [
        {
          "text": "Открыть в Telegram",
          "url": "https://t.me/po_puti56_bot/app"
        }
      ]
    ]
  }
}
JSON
```

После `<<` стоит `JSON` **без кавычек** — только поэтому `$CHAT` подставится.
С кавычками в файл попадёт само имя переменной.

Проверить, что получилось:

```bash
python3 -m json.tool post-video.json > /dev/null && echo "JSON в порядке"
grep -c ВАШ_НОМЕР post-video.json
```

Первая строка должна напечатать «JSON в порядке», вторая — `0`.

### 3.4. Отправить

```bash
TOKEN=сюда_вставить_токен
curl -sS -m 60 "https://api.telegram.org/bot$TOKEN/sendVideo" \
  -H 'Content-Type: application/json' -d @post-video.json
```

В ответе ищите `"ok":true`. Посмотрите в Telegram: ролик, подпись, кнопка под
ним. Нажмите кнопку — приложение должно открыться.

---

## Часть 4. Отправить в канал

Бот должен быть администратором канала с правом «Публикация сообщений»:
канал → «Управление каналом» → «Администраторы» → добавить бота.

Затем в той же консоли, не закрывая её:

```bash
sed -i 's|"chat_id": "[^"]*"|"chat_id": "@нужный_канал"|' post-video.json
grep chat_id post-video.json
curl -sS -m 60 "https://api.telegram.org/bot$TOKEN/sendVideo" \
  -H 'Content-Type: application/json' -d @post-video.json
```

Запишите `message_id` из ответа: по нему потом можно поменять кнопку, не
трогая пост (`editMessageReplyMarkup`).

Закрепить пост — руками, из самого Telegram.

---

## Часть 5. Прибраться

```bash
rm -f post-video.json
cat /dev/null > ~/.bash_history
history -c
```

Домашний каталог облачной консоли живёт долго, и без этого там останется
история команд с токеном.

**Токен побывал на чужой машине.** Если хотите чисто: @BotFather → `/revoke` →
выбрать бота → получить новый, вписать его в `/opt/vk-rideshare/app/.env` на
сервере и перезапустить `systemctl restart vk-rideshare-api`.

---

## Если вместо `"ok":true` пришла ошибка

| Что в ответе | Что это значит |
| --- | --- |
| `failed to get HTTP URL content` | Telegram не смог скачать видео — вернитесь к части 1.3 |
| `wrong file identifier/HTTP URL specified` | В поле `video` не ссылка или она без `https://` |
| `message caption is too long` | Подпись длиннее 700 символов |
| `can't parse entities` | Сломан HTML в подписи: незакрытый тег или неэкранированный `<` |
| `chat not found` | Номер или @username неверны, либо бот не администратор канала |
| `not enough rights to send text messages` | Бот админ, но без права «Публикация сообщений» |
| `401 Unauthorized` | Токен не тот или скопирован не целиком |
| `curl: (28)` | `api.telegram.org` недоступен из этой сети |

## Почему именно так

- **`sendVideo`, а не `sendMessage`.** Текст идёт полем `caption`, и предел у
  него 700 символов против 4096 у сообщения. Подпись уложена в 600.
- **Видео ссылкой, а не файлом.** Загружать ничего не надо; предел для такого
  способа — 20 МБ, у ролика 730 КБ.
- **Кнопка только типа `url`.** `web_app` работает лишь в приватном чате с
  ботом, в канал его не поставить.
- **`supports_streaming`** — воспроизведение начинается без полной загрузки.
- **Ссылка на ВКонтакте осталась в тексте**, а не ушла в кнопку: площадки
  неравнозначны в этом посте — он публикуется в Telegram, и кнопка ведёт
  туда же.
