import json
import os
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from redis.asyncio import Redis
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User

WORLD_LIMIT = 100
redis_client = Redis(host=os.getenv("REDIS_HOST", "localhost"), port=int(os.getenv("REDIS_PORT", "6379")), decode_responses=True)


class GameRoomConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.room_slug = self.scope["url_route"]["kwargs"]["room_slug"]
        self.group_name = f"game-room-{self.room_slug}"
        self.presence_key = f"game:room:{self.room_slug}:players"
        token = parse_qs(self.scope["query_string"].decode()).get("token", [None])[0]
        user = await self.get_user(token)
        if not user:
            await self.close(code=4401)
            return

        self.player_id = str(user.player.id)
        self.player = {"playerId": self.player_id, "username": user.username, "displayName": user.display_name or user.username, "position": {"x": 0, "y": 0, "z": 0}}
        existing = await redis_client.hgetall(self.presence_key)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await redis_client.hset(self.presence_key, self.player_id, json.dumps(self.player))
        await self.accept()
        await self.send_json({"type": "room_state", "room": self.room_slug, "players": [json.loads(value) for player_id, value in existing.items() if player_id != self.player_id]})
        await self.channel_layer.group_send(self.group_name, {"type": "player.joined", "player": self.player})

    async def disconnect(self, close_code):
        if not hasattr(self, "player_id"):
            return
        await redis_client.hdel(self.presence_key, self.player_id)
        await self.channel_layer.group_send(self.group_name, {"type": "player.left", "playerId": self.player_id})
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if content.get("type") != "move":
            return
        position = content.get("position", {})
        try:
            x, z = float(position["x"]), float(position["z"])
        except (KeyError, TypeError, ValueError):
            return
        if abs(x) > WORLD_LIMIT or abs(z) > WORLD_LIMIT:
            return
        self.player["position"] = {"x": x, "y": 0, "z": z}
        await redis_client.hset(self.presence_key, self.player_id, json.dumps(self.player))
        await self.channel_layer.group_send(self.group_name, {"type": "player.moved", "player": self.player})

    async def player_joined(self, event):
        await self.send_json({"type": "player_joined", "player": event["player"]})

    async def player_moved(self, event):
        await self.send_json({"type": "player_moved", "player": event["player"]})

    async def player_left(self, event):
        await self.send_json({"type": "player_left", "playerId": event["playerId"]})

    @database_sync_to_async
    def get_user(self, raw_token):
        if not raw_token:
            return None
        try:
            user_id = AccessToken(raw_token)["user_id"]
            return User.objects.select_related("player").get(pk=user_id, is_active=True)
        except (TokenError, User.DoesNotExist):
            return None
