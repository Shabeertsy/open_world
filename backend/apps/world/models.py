from django.db import models


class World(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=100)
    seed = models.PositiveBigIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
