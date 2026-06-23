# TwitchMod Pro — Smart Moderation System

Real-time Twitch chat moderation with behavioral AI spam detection.

## Quick Start

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Fill in your Twitch credentials in .env
#    TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
#    TWITCH_BOT_USERNAME, TWITCH_BOT_OAUTH

# 3. Start everything
docker compose up -d

# Dashboard: http://localhost:3000
# API:       http://localhost:4000
```

## Getting Twitch Credentials

1. **Client ID & Secret**: https://dev.twitch.tv/console → Create App
2. **Bot OAuth Token**: https://twitchapps.com/tmi/ (login with your bot account)

The bot account must be a moderator in the channels you want to moderate.

## Architecture

```
frontend (React + Tailwind)   → :3000
backend  (Node.js + Express)  → :4000
database (PostgreSQL)         → :5432
```

### Backend modules

| Module | Description |
|---|---|
| `twitch/TwitchManager` | IRC connection, joins channels, handles messages, sends /timeout /ban |
| `spam-engine/SpamEngine` | Behavioral analysis: cosine similarity, burst detection, promo detection |
| `channels/channelRouter` | CRUD for channel management |
| `moderation/moderationRouter` | Manual mute/ban endpoints |
| `websocket/wsHandler` | Real-time broadcast to all dashboard clients |
| `database/db` | PostgreSQL connection pool |

## Spam Detection Logic

Scores 0–100 based on:

| Check | Max Score |
|---|---|
| Exact duplicate messages | +40 |
| Cosine similarity to recent messages | +30 |
| Promotional intent (channel/subscribe keywords) | +25 |
| Burst activity (too many messages in window) | +20 |
| Link detection (http/www) | +15 |
| Repeated sentence structure | +15 |

**Thresholds (configurable):**
- 0–69 → normal
- 70–89 → moderation queue
- 90–100 → auto mute

## Configuration

All settings are live-editable from the Settings panel without restart.
Changes apply immediately to all connected channels.

## Development

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

## Production Notes

- Set `JWT_SECRET` to a long random string
- Use HTTPS reverse proxy (nginx/caddy) in front of both services
- The bot account needs `/mod botname` in each channel
- PostgreSQL data persists in the `postgres_data` Docker volume
