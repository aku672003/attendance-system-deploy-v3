"""attendance_system URL Configuration"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView
from attendance import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('attendance.urls')),
    
    # Catch-all pattern for SPA - serve protected spa_view for all non-API routes
    re_path(r'^(?!api/|admin/|static/|media/).*$', views.spa_view, name='spa'),
]

# Configure custom error handlers
handler400 = 'attendance.views.error_400_view'
handler403 = 'attendance.views.error_403_view'
handler404 = 'attendance.views.error_404_view'
handler500 = 'attendance.views.error_500_view'

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

# Ensure uploads directory exists
import os
os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
