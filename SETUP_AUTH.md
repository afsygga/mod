# Настройка авторизации через Google

## 1. Получить Google OAuth Client ID

1. Зайди на https://console.cloud.google.com/apis/credentials
2. **Create Project** (если нет) — назови как угодно
3. Нажми **+ CREATE CREDENTIALS** → **OAuth client ID**
4. Если просит настроить consent screen — настрой:
   - User Type: **External**
   - App name: `afsygga inc`
   - User support email: твой email
   - Developer contact: твой email
   - Scopes: оставь по умолчанию
   - Test users: добавь свой email
5. Возвращайся к Create OAuth client ID:
   - Application type: **Web application**
   - Name: `afsygga inc web`
   - **Authorized JavaScript origins**:
     - `http://localhost:8080` (для локальной разработки)
     - твой домен если есть, например `https://moderate.example.com`
   - **Authorized redirect URIs** оставь пустым
6. Нажми **CREATE** — получишь **Client ID** вида `123456789-xxxxx.apps.googleusercontent.com`

## 2. Настроить .env

Открой файл `.env` в корне проекта и добавь:

```
GOOGLE_CLIENT_ID=123456789-xxxxxxxxxx.apps.googleusercontent.com
ADMIN_EMAIL=твой_email@gmail.com
```

`ADMIN_EMAIL` — это твой Google email. После первого входа он автоматически:
- Добавится в whitelist
- Станет администратором с доступом ко всем разделам

## 3. Перезапустить

```cmd
docker compose down
docker compose build --no-cache
docker compose up -d
```

## 4. Зайти на сайт

http://localhost:8080

- Нажми **Continue with Google**
- Выбери свой Google аккаунт
- Если email = `ADMIN_EMAIL` — попадёшь сразу
- Если другой email — увидишь "Доступ запрещён"

## 5. Добавить пользователей

В админке (вкладка **Admin → Whitelist**):
- Введи email пользователя
- Опционально — заметку
- Нажми **Добавить**

Пользователь сможет войти через Google если его email в whitelist.

## Управление пользователями (Admin → Пользователи)

- 👑 **Crown** — назначить/убрать админа
- 🛡 **Shield** — включить/выключить аккаунт (отключённый не сможет войти)
- 🗑 **Trash** — удалить пользователя

## Безопасность

- Токены сессий хранятся в БД, срок жизни 30 дней
- Удаление пользователя автоматически инвалидирует все его сессии
- При отключении (enabled=false) пользователь будет выкинут при следующем запросе
