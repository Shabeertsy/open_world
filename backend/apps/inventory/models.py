from django.db import models


class InventoryItem(models.Model):
    player = models.ForeignKey("players.Player", on_delete=models.CASCADE, related_name="inventory_items")
    item_key = models.SlugField(max_length=80)
    quantity = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("player", "item_key"), name="unique_player_inventory_item")]

    def __str__(self):
        return f"{self.player}: {self.item_key} x{self.quantity}"
