from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User


@admin.register(User)
class OpenWorldUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("Openworld", {"fields": ("display_name",)}),)
