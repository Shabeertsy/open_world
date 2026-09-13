# Openworld prototype

The current playable slice is a local Three.js arena. Django has the foundational accounts, players, world, inventory, and friends apps; real-time multiplayer is intentionally not included yet.

## Run

1. Copy `.env.example` to `.env` if you need to override defaults.
2. Start the services: `docker compose up --build`.
3. Run migrations in another terminal: `docker compose exec backend python manage.py migrate`.
4. Open `http://localhost:5173` in two tabs.

## Authentication API

All authenticated requests use `Authorization: Bearer <access-token>`.

- `POST /api/auth/register/` — `username`, `password`, `password_confirmation`, optional `display_name` and multipart `avatar`; returns access/refresh JWTs and the player profile.
- `POST /api/auth/login/` — `username` and `password`; returns access/refresh JWTs and the player profile.
- `POST /api/auth/logout/` — authenticated, with a `refresh` token; blacklists that refresh token.
- `GET` / `PATCH /api/auth/profile/` — authenticated player profile; `username`, `display_name`, and multipart `avatar` can be updated.

Uploaded avatars are served at `/media/avatars/...` in development.

## Game room WebSocket

Authenticated clients connect to `ws://localhost:8000/ws/game/rooms/demo/?token=<access-token>`. Redis holds the room's live presence/position state while Django Channels broadcasts `room_state`, `player_joined`, `player_moved`, and `player_left` events. The current room contains player movement only—vehicles and NPCs are not implemented.
# open_world
