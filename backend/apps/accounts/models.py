from uuid import uuid4

from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models


class AccountManager(UserManager):
    def create_guest(self, display_name: str):
        identifier = uuid4().hex
        user = self.create_user(
            username=f"guest_{identifier}",
            display_name=display_name,
        )
        user.set_unusable_password()
        user.save(update_fields=("password",))
        return user


class User(AbstractUser):
    display_name = models.CharField(max_length=24, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)

    objects = AccountManager()

    def __str__(self):
        return self.display_name or self.username
