from django.urls import re_path
from .consumers import GameRoomConsumer


websocket_urlpatterns = [re_path(r"ws/game/rooms/(?P<room_slug>[\w-]+)/$", GameRoomConsumer.as_asgi())]
