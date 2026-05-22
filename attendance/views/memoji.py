from django.shortcuts import render, redirect
from django.http import HttpResponse, JsonResponse, HttpResponseForbidden, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils.decorators import method_decorator
from django.db.models import Q, Count, Sum, Avg, Prefetch
from django.utils import timezone
from django.core.cache import cache
from django.core.mail import send_mail
from django.conf import settings
import random
import string
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import status
import json
import uuid
import math
import os
import hashlib
import hmac
import zipfile
import tempfile
import re
from datetime import datetime, date, time, timedelta

# Import models & serializers using parent directory relative path
from ..models import (
    Employee, EmployeeProfile, OfficeLocation, DepartmentOfficeAccess,
    AttendanceRecord, EmployeeRequest, EmployeeDocument, Task, BirthdayWish, TaskComment, TaskStep, TaskAttachment, Team,
    TemporaryTag, TrainingLog, AvatarAsset, Memoji, Notification, TaskHistory, Project, Holiday, HolidayUpload, UserHoliday
)
from ..serializers import AvatarAssetSerializer, MemojiSerializer
from ..security import require_valid_token, require_gated_token_api
from django.contrib.auth.hashers import make_password, check_password
from .utils import get_current_user

# --- Function: avatar_assets_list ---
@api_view(['GET'])
@require_gated_token_api
def avatar_assets_list(request):
    """Returns available assets grouped by category"""
    category = request.GET.get('category')
    assets = AvatarAsset.objects.filter(is_active=True)
    if category:
        assets = assets.filter(category=category)
    
    serializer = AvatarAssetSerializer(assets, many=True)
    return Response({
        'success': True,
        'assets': serializer.data
    })



# --- Function: user_memoji_api ---
@api_view(['GET', 'POST', 'PUT'])
@require_gated_token_api
def user_memoji_api(request, user_id=None):
    """Retrieve or update a user's memoji configuration"""
    if not user_id:
        user_id = request.data.get('user_id') or request.GET.get('user_id')
    
    if not user_id:
        return Response({'success': False, 'message': 'User ID required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(id=user_id)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        memoji = Memoji.objects.filter(employee=employee).first()
        if not memoji:
            return Response({'success': True, 'memoji': None})
        serializer = MemojiSerializer(memoji)
        return Response({'success': True, 'memoji': serializer.data})

    elif request.method in ['POST', 'PUT']:
        avatar_config = request.data.get('avatar_config')
        avatar_url = request.data.get('avatar_url')
        
        if not avatar_config and not avatar_url:
            return Response({'success': False, 'message': 'Avatar configuration or URL required'}, status=status.HTTP_400_BAD_REQUEST)
        
        defaults = {}
        if avatar_config:
            defaults['avatar_config'] = avatar_config
        if avatar_url:
            defaults['avatar_url'] = avatar_url
            
        memoji, created = Memoji.objects.update_or_create(
            employee=employee,
            defaults=defaults
        )
        
        # Sync with Employee profile avatar fields for global rendering
        profile = getattr(employee, 'profile', None)
        if profile:
            if avatar_url:
                profile.avatar_url = avatar_url
            if avatar_config:
                import json
                profile.theme_settings['avatar_config'] = avatar_config
            profile.save()
        
        serializer = MemojiSerializer(memoji)
        return Response({
            'success': True, 
            'message': 'Avatar saved successfully',
            'memoji': serializer.data
        })




# --- Function: upload_avatar ---
@api_view(['POST'])
@require_gated_token_api
@csrf_exempt
@parser_classes([MultiPartParser, FormParser])
def upload_avatar(request):
    """Upload a custom photo for user avatar"""
    employee_id = request.POST.get('employee_id')
    if not employee_id:
        return Response({'success': False, 'message': 'Employee ID is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(id=employee_id)
        profile, _ = EmployeeProfile.objects.get_or_create(employee=employee)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)

    if 'photo' not in request.FILES:
        return Response({'success': False, 'message': 'No photo file provided'}, status=status.HTTP_400_BAD_REQUEST)

    photo = request.FILES['photo']
    
    # Validation
    if photo.size > 2 * 1024 * 1024: # 2MB limit
        return Response({'success': False, 'message': 'Photo size exceeds 2MB limit'}, status=status.HTTP_400_BAD_REQUEST)
    
    if not photo.content_type.startswith('image/'):
        return Response({'success': False, 'message': 'Invalid file type. Please upload an image.'}, status=status.HTTP_400_BAD_REQUEST)

    # Save file
    upload_dir = os.path.join(settings.MEDIA_ROOT, 'avatars')
    os.makedirs(upload_dir, exist_ok=True)
    
    ext = os.path.splitext(photo.name)[1].lower()
    filename = f"avatar_{employee_id}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(upload_dir, filename)
    
    with open(file_path, 'wb') as f:
        for chunk in photo.chunks():
            f.write(chunk)
            
    # Update profile
    previous_photo = profile.avatar_url
    profile.avatar_url = f'avatars/{filename}'
    profile.avatar_emoji = "👤" # Reset emoji if used
    profile.theme_settings.pop('avatar_config', None) # Clear 3D config
    profile.save()
    
    # Delete previous custom avatar if exists and is not default
    if previous_photo and os.path.exists(os.path.join(settings.MEDIA_ROOT, previous_photo)):
        try:
            os.remove(os.path.join(settings.MEDIA_ROOT, previous_photo))
        except:
            pass

    return Response({
        'success': True,
        'message': 'Avatar photo uploaded successfully',
        'avatar_url': profile.avatar_url
    })




