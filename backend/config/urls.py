from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from apps.accounts.views import LoginView, LogoutView, ProfileView, RegisterView, guest_login
from apps.world.views import demo_world

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/guest/", guest_login),
    path("api/auth/register/", RegisterView.as_view()),
    path("api/auth/login/", LoginView.as_view()),
    path("api/auth/logout/", LogoutView.as_view()),
    path("api/auth/profile/", ProfileView.as_view()),
    path("api/worlds/demo/", demo_world),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
