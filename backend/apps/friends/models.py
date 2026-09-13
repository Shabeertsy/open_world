from django.db import models


class Friendship(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"

    sender = models.ForeignKey("players.Player", on_delete=models.CASCADE, related_name="sent_friendships")
    receiver = models.ForeignKey("players.Player", on_delete=models.CASCADE, related_name="received_friendships")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("sender", "receiver"), name="unique_friendship_direction"),
            models.CheckConstraint(condition=~models.Q(sender=models.F("receiver")), name="friendship_requires_two_players"),
        ]

    def __str__(self):
        return f"{self.sender} → {self.receiver} ({self.status})"
