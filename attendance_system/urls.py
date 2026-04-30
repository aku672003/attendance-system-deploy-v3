"""attendance_system URL Configuration"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView, RedirectView
from attendance import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('attendance.urls')),
    
    # Service Worker handling - served from root to allow controlling the whole site
    path('sw.js', views.service_worker_view, name='service_worker'),
    
    # Favicon handling
    path('favicon.ico', RedirectView.as_view(url='/static/favicon.ico', permanent=True)),
    
    # Catch-all pattern for SPA - serve protected spa_view for all non-API routes
    re_path(r'^(?!api/|admin/|static/|media/|manifest\.json|browserconfig\.xml).*$', views.spa_view, name='spa'),
]

# Configure custom error handlers
handler400 = 'attendance.views.error_400_view'
handler403 = 'attendance.views.error_403_view'
handler404 = 'attendance.views.error_404_view'
handler500 = 'attendance.views.error_500_view'

# Serve media files in development
# Serve media files
from django.views.static import serve
urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]

# Ensure uploads directory exists
import os
os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
