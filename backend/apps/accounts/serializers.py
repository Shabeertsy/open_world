from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.players.models import Player
from .models import User


class PlayerProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username")
    display_name = serializers.CharField(source="user.display_name", required=False, allow_blank=True, max_length=24)
    avatar = serializers.ImageField(source="user.avatar", required=False, allow_null=True)

    class Meta:
        model = Player
        fields = ("id", "username", "display_name", "avatar", "current_world", "created_at")
        read_only_fields = ("id", "current_world", "created_at")

    def validate_username(self, value):
        user_id = self.instance.user_id if self.instance else None
        if User.objects.exclude(pk=user_id).filter(username=value).exists():
            raise serializers.ValidationError("This username is already in use.")
        return value

    def update(self, instance, validated_data):
        user_data = validated_data.pop("user", {})
        for field, value in user_data.items():
            setattr(instance.user, field, value)
        if user_data:
            instance.user.save()
        return instance


class RegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8, style={"input_type": "password"})
    password_confirmation = serializers.CharField(write_only=True, style={"input_type": "password"})
    avatar = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = User
        fields = ("username", "display_name", "avatar", "password", "password_confirmation")
        extra_kwargs = {"display_name": {"required": False, "allow_blank": True}}

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("password_confirmation"):
            raise serializers.ValidationError({"password_confirmation": "Passwords do not match."})
        validate_password(attrs["password"])
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User.objects.create_user(password=password, **validated_data)
        Player.objects.create(user=user)
        return user


class LoginSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["player_id"] = user.player.id
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["player"] = PlayerProfileSerializer(self.user.player, context=self.context).data
        return data
