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

# --- Function: send_otp ---
@api_view(['POST'])
# @require_gated_token_api
@parser_classes([JSONParser])
def send_otp(request):
    """
    Send a 6-digit OTP to the user's email for password reset.
    """
    username = request.data.get('username', '').strip()
    email = request.data.get('email', '').strip()
    
    if not username or not email:
        return Response({'success': False, 'message': 'Username and Email are required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(username__iexact=username, email__iexact=email, is_active=True)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Account not found with this username and email combo'}, status=status.HTTP_404_NOT_FOUND)

    # Generate 6-digit OTP
    otp = ''.join(random.choices(string.digits, k=6))
    
    # Store OTP in cache for 5 minutes
    cache_key = f"otp_{email}"
    cache.set(cache_key, otp, timeout=300)

    # Send email
    subject = 'Password Reset OTP - HANUSPHERE Attendance System'
    message = f'Your OTP for password reset is: {otp}. It is valid for 5 minutes.'
    from_email = settings.DEFAULT_FROM_EMAIL
    recipient_list = [email]

    try:
        send_mail(subject, message, from_email, recipient_list, fail_silently=False)
        return Response({
            'success': True, 
            'message': 'OTP sent to your email',
            'debug_info': {
                'recipient': email,
                'from': from_email,
                'backend': settings.EMAIL_BACKEND
            }
        })
    except Exception as e:
        print(f"Error sending email: {e}")
        return Response({'success': False, 'message': 'Failed to send OTP. Please try again later.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: reset_password ---
@api_view(['POST'])
# @require_gated_token_api
@parser_classes([JSONParser])
def reset_password(request):
    """
    Verify OTP and reset user password.
    """
    username = request.data.get('username')
    email = request.data.get('email')
    otp = request.data.get('otp')
    new_password = request.data.get('new_password')

    if not username or not email or not otp or not new_password:
        return Response({'success': False, 'message': 'Username, Email, OTP, and new password are required'}, status=status.HTTP_400_BAD_REQUEST)

    # Verify OTP from cache
    cache_key = f"otp_{email}"
    cached_otp = cache.get(cache_key)

    if not cached_otp:
        return Response({'success': False, 'message': 'OTP expired or not found'}, status=status.HTTP_400_BAD_REQUEST)

    if cached_otp != otp:
        return Response({'success': False, 'message': 'Invalid OTP'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(username__iexact=username, email__iexact=email, is_active=True)
        employee.password = make_password(new_password)
        employee.save()
        
        # Clear OTP from cache
        cache.delete(cache_key)
        
        return Response({'success': True, 'message': 'Password reset successful'})
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f"Password reset error: {e}")
        return Response({'success': False, 'message': 'Failed to reset password'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: login ---
@api_view(['POST'])
# @require_gated_token_api
@parser_classes([JSONParser])
def login(request):
    """Authenticate user credentials and return profile data"""
    data = request.data
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return Response({
            'success': False,
            'message': 'Username and password are required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Support login via both username OR email
        employee = Employee.objects.filter(Q(username__iexact=username) | Q(email__iexact=username), is_active=True).first()
        
        if not employee:
            return Response({
                'success': False,
                'message': 'Invalid username/email or password'
            }, status=status.HTTP_401_UNAUTHORIZED)

        # Check password — no backdoors, hashed comparison only
        if check_password(password, employee.password):
            profile = EmployeeProfile.objects.filter(employee=employee).first()
            assignment = employee.get_current_assignment()
            
            # Generate a gated token for this session
            from ..security import generate_gated_token
            session_token = generate_gated_token(employee.id, employee.username)

            user_data = {
                'id': employee.id,
                'username': employee.username,
                'name': employee.name,
                'email': employee.email,
                'phone': employee.phone,
                'department': assignment['department'],
                'primary_office': employee.primary_office,
                'role': assignment['role'],
                'is_temporary': assignment['is_temporary'],
                'has_subordinates': employee.subordinates.exists(),
                'gender': profile.gender if profile else None,
                'date_of_birth': str(profile.date_of_birth) if profile and profile.date_of_birth else None,
                'avatar_emoji': profile.avatar_emoji if profile else "👤",
                'avatar_url': profile.avatar_url if profile else None,
                'theme_settings': profile.theme_settings if profile else {},
                'mentors': [{'id': m.id, 'name': m.name} for m in employee.mentors.all()],
                'total_cl': profile.total_cl if profile else 12,
                'taken_cl': profile.taken_cl if profile else 0,
            }
            return Response({
                'success': True,
                'user': user_data,
                'token': session_token,
                'message': 'Login successful'
            })
        else:
            return Response({
                'success': False,
                'message': 'Invalid username/email or password'
            }, status=status.HTTP_401_UNAUTHORIZED)
    except Employee.DoesNotExist:
        # Check if the user exists but is inactive (via username or email)
        if Employee.objects.filter(Q(username__iexact=username) | Q(email__iexact=username), is_active=False).exists():
             return Response({
                'success': False,
                'message': 'Your account is inactive. Please contact the administrator.'
            }, status=status.HTTP_403_FORBIDDEN)

        return Response({
            'success': False,
            'message': 'Invalid username/email or password'
        }, status=status.HTTP_401_UNAUTHORIZED)
    except Exception as e:
        import logging
        logging.getLogger('attendance').exception('Login error')
        return Response({
            'success': False,
            'message': 'Login failed. Please try again.'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: register ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def register(request):
    """Register a new employee with validated details (admin only)"""
    # Verify caller is an admin
    caller = get_current_user(request, require_admin=True)
    if not caller:
        return Response({'success': False, 'message': 'Admin access required to register users'}, status=403)

    data = request.data
    required_fields = ['username', 'password', 'name', 'email', 'phone', 'department', 'primary_office']

    for field in required_fields:
        if not data.get(field):
            return Response({
                'success': False,
                'message': f"Field '{field}' is required"
            }, status=status.HTTP_400_BAD_REQUEST)

    # Validate phone number
    if not data['phone'].isdigit() or len(data['phone']) != 10:
        return Response({
            'success': False,
            'message': 'Phone number must be exactly 10 digits'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Check if username or email already exists
    if Employee.objects.filter(Q(username__iexact=data['username']) | Q(email__iexact=data['email'])).exists():
        return Response({
            'success': False,
            'message': 'Username or email already exists'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.create(
            username=data['username'],
            password=make_password(data['password']),
            name=data['name'],
            email=data['email'],
            phone=data['phone'],
            department=data['department'],
            primary_office=data['primary_office'],
            role=data.get('role', 'employee'),
            is_active=True
        )
        
        # Handle multiple Mentors if provided as list, or single mentor_id
        mentor_ids = data.get('mentor_ids') or []
        if not mentor_ids and data.get('mentor_id') and data.get('mentor_id') != 'none':
            mentor_ids = [data.get('mentor_id')]
            
        if mentor_ids:
            mentors_qs = Employee.objects.filter(id__in=mentor_ids)
            employee.mentors.set(mentors_qs)
            mentor_names = ", ".join([m.name for m in mentors_qs])
            _send_task_notification(employee, f"Welcome! Admin has assigned your mentor(s): {mentor_names}", None, type="mentor_assigned")

        # Create Profile and set initial leaves
        joining_date_str = data.get('date_of_joining')
        total_cl = int(data.get('total_cl', 12))
        
        # If joining date provided and it's this year, calculate pro-rata CL
        if joining_date_str:
            try:
                joining_date = datetime.strptime(joining_date_str, '%Y-%m-%d').date()
                today = date.today()
                if joining_date.year == today.year:
                    # 1 CL per month remaining (including joining month)
                    total_cl = 12 - joining_date.month + 1
            except Exception as e:
                print(f"Error calculating pro-rata CL: {e}")

        profile = EmployeeProfile.objects.create(
            employee=employee,
            total_cl=total_cl,
            taken_cl=0,
            date_of_joining=joining_date_str
        )

        return Response({
            'success': True,
            'message': 'Account created successfully',
            'employee_id': employee.id
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Registration failed. Please try again.'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: verify_token ---
@api_view(['POST'])
@parser_classes([JSONParser])
def verify_token(request):
    """Verify attendance token from portal and return user data if valid"""
    token = request.data.get('token')
    if not token:
        return Response({'success': False, 'message': 'Token is required'}, status=status.HTTP_400_BAD_REQUEST)

    # 1. Try Gated Access verification (itsdangerous) - Priority for auto-login
    from ..security import validate_gated_token
    success, result = validate_gated_token(token)
    if success:
        user_id = result.get('user_id')
        username = result.get('username')
        employee = None
        
        if username:
            employee = Employee.objects.filter(username__iexact=username, is_active=True).first()
        if not employee and user_id:
            employee = Employee.objects.filter(id=user_id, is_active=True).first()

        if employee:
            profile = EmployeeProfile.objects.filter(employee=employee).first()
            assignment = employee.get_current_assignment()
            user_data = {
                'id': employee.id,
                'username': employee.username,
                'name': employee.name,
                'email': employee.email,
                'phone': employee.phone,
                'department': assignment['department'],
                'primary_office': employee.primary_office,
                'role': assignment['role'],
                'is_temporary': assignment['is_temporary'],
                'has_subordinates': employee.subordinates.exists(),
                'gender': profile.gender if profile else None,
                'date_of_birth': str(profile.date_of_birth) if profile and profile.date_of_birth else None,
                'avatar_emoji': profile.avatar_emoji if profile else "👤",
                'avatar_url': profile.avatar_url if profile else None,
                'theme_settings': profile.theme_settings if profile else {},
                'mentors': [{'id': m.id, 'name': m.name} for m in employee.mentors.all()],
                'total_cl': profile.total_cl if profile else 12,
                'taken_cl': profile.taken_cl if profile else 0,
            }
            return Response({
                'success': True, 
                'message': 'Token verified (Gated)',
                'user': user_data
            })
        else:
            return Response({'success': False, 'message': 'User associated with token not found'}, status=404)

    # 2. Try HMAC verification (The legacy way)
    secret = getattr(settings, "ATTENDANCE_SECRET_KEY", "hanuai-attendance-secret-shared-key").encode()
    message = timezone.localtime(timezone.now()).strftime("%Y-%m-%d").encode()
    expected_hmac = hmac.new(secret, message, hashlib.sha256).hexdigest()
    
    if hmac.compare_digest(token, expected_hmac):
        return Response({'success': True, 'message': 'Token verified (HMAC)'})
    
    return Response({'success': False, 'message': f'Invalid token: {result}'}, status=status.HTTP_401_UNAUTHORIZED)




