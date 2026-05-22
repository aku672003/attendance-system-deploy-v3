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
# --- Function: calculate_distance ---
def calculate_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two points using Haversine formula"""
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(float(lat1))
    phi2 = math.radians(float(lat2))
    delta_phi = math.radians(float(lat2) - float(lat1))
    delta_lambda = math.radians(float(lon2) - float(lon1))

    a = math.sin(delta_phi / 2) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c




# --- Function: get_current_user ---
def get_current_user(request, requested_id=None, require_admin=False):
    """
    Helper to extract and validate the user for API requests.
    Prioritizes request.user (attached via gated token decorator).
    If a specific requested_id is provided, it verifies the caller is authorized.
    """
    # 1. Get the authenticated user from the token (attached by decorator)
    token_user = getattr(request, 'user', None)
    
    # 2. If no token user (legacy/development without token), fallback to requested_id
    if not isinstance(token_user, Employee):
        if not requested_id:
            return None
        return Employee.objects.filter(id=requested_id).first()

    # 3. If token user exists, enforce that they only access their own data
    # (Unless they are an admin or it's an admin-level request)
    user_role = (token_user.role or '').lower()
    
    if requested_id and str(requested_id) != str(token_user.id):
        if user_role != 'admin':
            return None # Unauthorized
            
    if require_admin and user_role != 'admin':
        return None

    return token_user



