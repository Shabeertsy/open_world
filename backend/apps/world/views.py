from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models import World

@api_view(["GET"])
def demo_world(request):
    world, _ = World.objects.get_or_create(slug="demo", defaults={"name": "Starter Island", "seed": 1})
    return Response({"id": world.slug, "name": world.name, "bounds": {"minX": -100, "maxX": 100, "minZ": -100, "maxZ": 100}, "spawn": {"x": 0, "y": 0, "z": 0}})
