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

# --- Function: _trigger_push_notification ---
def _trigger_push_notification(user, title, message, link=None):
    """Internal helper to send browser push notifications via pywebpush"""
    from ..models import PushSubscription
    from pywebpush import webpush, WebPushException
    import json
    from django.conf import settings

    subscriptions = PushSubscription.objects.filter(employee=user)
    if not subscriptions.exists():
        return

    vapid_private_key = getattr(settings, 'VAPID_PRIVATE_KEY', None)
    vapid_claims = {"sub": getattr(settings, 'VAPID_CLAIMS_SUB', 'mailto:admin@example.com')}

    # Fix VAPID private key if it has literal \n or extra quotes (common in .env)
    if isinstance(vapid_private_key, str):
        if "\\n" in vapid_private_key:
            vapid_private_key = vapid_private_key.replace("\\n", "\n")
        vapid_private_key = vapid_private_key.strip('"\'')

    if not vapid_private_key:
        print("[Push] VAPID private key is missing — skipping.")
        return

    data = json.dumps({
        "title": title,
        "body": message,
        "url": link  # Changed from "data": {"link": link} to match sw.js expectation
    })

    success_count = 0
    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {
                        "p256dh": sub.p256dh,
                        "auth": sub.auth
                    }
                },
                data=data,
                vapid_private_key=vapid_private_key,
                vapid_claims=vapid_claims
            )
            success_count += 1
        except WebPushException as ex:
            print(f"[Push] WebPushException for {user.username}: {ex}")
            if ex.response and ex.response.status_code == 410:
                sub.delete()
        except Exception as e:
            print(f"[Push] Unexpected error for {user.username}: {e}")
    
    if success_count > 0:
        print(f"[Push] Successfully sent {success_count} notifications to {user.username}")




# --- Function: get_notifications ---
@api_view(['GET'])
@require_gated_token_api
def get_notifications(request):
    """Get notifications for the current user"""
    user_id = request.GET.get('user_id')
    if not user_id:
        return Response({'success': False, 'message': 'User ID required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = Employee.objects.get(id=user_id)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    notifications = []

    # 0. Received Birthday Wishes
    received_wishes = BirthdayWish.objects.filter(
        receiver_id=user_id,
        is_read=False
    ).select_related('sender').order_by('-created_at')

    for wish in received_wishes:
        notifications.append({
            'type': 'wish',
            'icon': '🎈',
            'message': f"{wish.sender.name}: {wish.message}",
            'time': wish.created_at.strftime('%I:%M %p'),
            'id': f'wish_{wish.id}'
        })

    # Note: Synthetic birthday and task notifications are removed here 
    # as they kept reappearing after "Mark all as read". 
    # Real notifications are handled by the Notification model.

    # 3. Pending requests (for admins/mentors)
    if (user.role or '').lower() == 'admin':
        pending_requests_count = EmployeeRequest.objects.filter(
            status='pending'
        ).count()

        if pending_requests_count > 0:
            notifications.append({
                'type': 'request',
                'icon': '📋',
                'message': f'{pending_requests_count} pending approval(s)',
                'time': 'Now',
                'id': 'pending_requests'
            })
    
    # 3.1 Task Requests for Mentors
    is_mentor = user.role == 'mentor' or user.subordinates.exists()
    if is_mentor:
        task_requests = EmployeeRequest.objects.filter(
            request_type='task_request',
            status='pending',
            employee__mentors=user
        ).select_related('employee')
        
        for treq in task_requests:
            notifications.append({
                'type': 'task_request',
                'icon': '⚠️',
                'message': f'{treq.employee.name} is requesting a task',
                'time': treq.created_at.strftime('%I:%M %p') if treq.created_at else 'Now',
                'id': f'task_req_{treq.id}',
                'employee_id': treq.employee.id,
                'employee_name': treq.employee.name
            })
            
        # Idle Subordinates (No tasks) - Summary Notification
        idle_count = 0
        try:
            subordinates = user.subordinates.all()
            for sub in subordinates:
                # Check if this subordinate has any tasks in progress or todo
                has_active = Task.objects.filter(
                    assignees=sub, 
                    status__in=['todo', 'in_progress']
                ).exists()
                if not has_active:
                    idle_count += 1
        except Exception:
            idle_count = 0
        
    # Note: Synthetic/Calculated notifications are removed here to ensure "Mark all as read"
    # functions correctly. Users only see alerts that can be dismissed (tracked in DB).

    # 4. Persistence Notifications from DB
    from ..models import Notification
    db_notifs = Notification.objects.filter(user=user, is_read=False).order_by('-created_at')[:15]
    for dn in db_notifs:
        # Avoid duplicating recent comments if they are already added above
        if dn.type == 'task_comment' and any(n.get('id') == f'comment_{dn.link_id}' for n in notifications):
            continue
            
        icon = '🔔'
        if dn.type == 'task_comment': icon = '💬'
        elif dn.type == 'task': icon = '📝'
        elif dn.type == 'meeting': icon = '🤝'
        elif dn.type == 'request': icon = '📋'
        elif dn.type == 'mentor_assigned': icon = '🔗'
        
        notifications.append({
            'id': f'dn_{dn.id}',
            'type': dn.type,
            'icon': icon,
            'message': dn.message,
            'time': dn.created_at.strftime('%I:%M %p'),
            'task_id': dn.link_id
        })

    return Response({
        'success': True,
        'notifications': notifications,
        'unread_count': len(notifications)
    })



# --- Function: mark_notifications_read ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def mark_notifications_read(request):
    """Mark all notifications or a specific one as read"""
    user_id = request.data.get('user_id')
    notification_id = request.data.get('notification_id') # Optional: if we want to mark specific

    if not user_id:
        return Response({'success': False, 'message': 'User ID required'}, status=status.HTTP_400_BAD_REQUEST)

    # Handle BirthdayWishes persistence
    wishes = BirthdayWish.objects.filter(receiver_id=user_id, is_read=False)
    if notification_id and str(notification_id).startswith('wish_'):
        wish_id = str(notification_id).replace('wish_', '')
        wishes = wishes.filter(id=wish_id)
    wishes.update(is_read=True)

    # Handle persistent Notification model
    from ..models import Notification
    db_notifs = Notification.objects.filter(user_id=user_id, is_read=False)
    if notification_id and str(notification_id).startswith('dn_'):
        notif_id = str(notification_id).replace('dn_', '')
        db_notifs = db_notifs.filter(id=notif_id)
    db_notifs.update(is_read=True)

    return Response({'success': True, 'message': 'Notifications marked as read'})




# --- Function: send_birthday_wish ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def send_birthday_wish(request):
    """Send a birthday wish to an employee"""
    sender_id = request.data.get('sender_id')
    receiver_id = request.data.get('receiver_id')
    message = request.data.get('message', 'Wishing you a very Happy Birthday! 🎂')

    if not all([sender_id, receiver_id]):
        return Response({'success': False, 'message': 'Sender and Receiver IDs required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        sender = Employee.objects.get(id=sender_id)
        receiver = Employee.objects.get(id=receiver_id)

        # Prevent duplicate wishes for same day
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        existing_wish = BirthdayWish.objects.filter(
            sender=sender,
            receiver=receiver,
            created_at__gte=today_start
        ).exists()

        if existing_wish:
            return Response({'success': False, 'message': 'You have already sent a wish today!'})

        wish = BirthdayWish.objects.create(
            sender=sender,
            receiver=receiver,
            message=message
        )
        return Response({'success': True, 'message': 'Birthday wish sent successfully!'})

    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'User not found'}, status=status.HTTP_404_NOT_FOUND)





# --- Function: get_vapid_public_key ---
@api_view(['GET'])
@require_gated_token_api
def get_vapid_public_key(request):
    """Return the VAPID public key so the browser can subscribe to push notifications."""
    from django.conf import settings
    key = getattr(settings, 'VAPID_PUBLIC_KEY', '')
    if not key:
        return Response({'success': False, 'message': 'VAPID not configured'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({'success': True, 'public_key': key})




# --- Function: save_push_subscription ---
@api_view(['POST', 'DELETE'])
@require_gated_token_api
@parser_classes([JSONParser])
def save_push_subscription(request):
    """
    POST  → Save (or update) a browser push subscription for an employee.
    DELETE → Remove a subscription (for unsubscribe / logout).
    Body: { employee_id, endpoint, p256dh, auth }
    """
    from attendance.models import PushSubscription

    data = request.data
    employee_id = data.get('employee_id')
    endpoint = data.get('endpoint')

    if not employee_id or not endpoint:
        return Response({'success': False, 'message': 'employee_id and endpoint are required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(id=employee_id)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        PushSubscription.objects.filter(employee=employee, endpoint=endpoint).delete()
        return Response({'success': True, 'message': 'Push subscription removed'})

    # POST — save or update
    p256dh = data.get('p256dh', '')
    auth   = data.get('auth', '')
    ua     = request.META.get('HTTP_USER_AGENT', '')[:255]

    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={
            'employee': employee,
            'p256dh': p256dh,
            'auth': auth,
            'user_agent': ua,
        }
    )
    return Response({'success': True, 'message': 'Push subscription saved'})




