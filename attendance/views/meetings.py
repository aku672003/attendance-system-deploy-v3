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

# --- Function: meetings_api ---
@api_view(['GET', 'POST'])
@require_gated_token_api
@parser_classes([JSONParser, MultiPartParser, FormParser])
def meetings_api(request):
    """List or create meetings"""
    if request.method == 'GET':
        try:
            employee_id = request.GET.get('employee_id')
            if not employee_id:
                return Response({'success': False, 'message': 'Employee ID required'}, status=status.HTTP_400_BAD_REQUEST)
            
            from ..models import Meeting
            # Get meetings where user is participant OR creator
            meetings = Meeting.objects.filter(
                Q(participants__id=employee_id) | Q(created_by_id=employee_id)
            ).distinct().prefetch_related('participants', 'created_by').order_by('-date', '-start_time')[:20]
            
            data = []
            for m in meetings:
                import re as _re, json as _json
                raw_desc = m.description or ''
                # Extract embedded steps_json
                steps_data = []
                steps_match = _re.search(r'__steps_json__(.*?)__end_steps__', raw_desc, _re.DOTALL)
                if steps_match:
                    try:
                        steps_data = _json.loads(steps_match.group(1))
                    except Exception:
                        steps_data = []
                # Clean display description
                display_desc = _re.sub(r'\n\n__steps_json__.*?__end_steps__', '', raw_desc, flags=_re.DOTALL).strip()

                data.append({
                    'id': m.id,
                    'title': m.title,
                    'description': display_desc,
                    'steps': steps_data,
                    'date': m.date.strftime('%Y-%m-%d'), 
                    'display_date': m.date.strftime('%d-%m-%Y'),
                    'start_time': m.start_time.strftime('%H:%M') if m.start_time else '', 
                    'display_time': m.start_time.strftime('%I:%M %p') if m.start_time else '',
                    'created_by_name': m.created_by.name,
                    'created_by_id': m.created_by.id,
                    'participants': [{'id': p.id, 'name': p.name} for p in m.participants.all()],
                    'project_id': m.project_id,
                    'project_name': m.project.name if m.project else None
                })
            
            return Response({'success': True, 'meetings': data})
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    elif request.method == 'POST':
        try:
            from ..models import Meeting, Employee
            data = request.data
            creator_id = data.get('created_by')
            if not creator_id:
                return Response({'success': False, 'message': 'Creator ID required'}, status=status.HTTP_400_BAD_REQUEST)
            
            creator = Employee.objects.get(id=creator_id)

            # Store steps_json in description for later editing
            description = data.get('description', '')
            steps_json = data.get('steps_json')
            if steps_json:
                description = f"{description}\n\n__steps_json__{steps_json}__end_steps__"

            meeting = Meeting.objects.create(
                title=data.get('title'),
                description=description,
                date=data.get('date'),
                start_time=data.get('start_time') if data.get('start_time') else None,
                project_id=data.get('project_id'),
                created_by=creator
            )
            
            participant_ids = data.get('participants', [])
            if participant_ids:
                meeting.participants.set(Employee.objects.filter(id__in=participant_ids))
            
            return Response({'success': True, 'meeting_id': meeting.id})
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# --- Function: meeting_detail_api ---
@api_view(['GET', 'PATCH', 'DELETE'])
@require_gated_token_api
@parser_classes([JSONParser])
def meeting_detail_api(request, meeting_id):
    """Update or delete a meeting"""
    try:
        from ..models import Meeting, Employee
        meeting = Meeting.objects.get(id=meeting_id)
        
        if request.method == 'DELETE':
            meeting.delete()
            return Response({'success': True, 'message': 'Meeting deleted'})
            
        elif request.method == 'PATCH':
            data = request.data
            if 'title' in data: meeting.title = data['title']
            if 'date' in data: meeting.date = data['date']
            if 'start_time' in data: 
                meeting.start_time = data['start_time'] if data['start_time'] else None
            
            # Update description, embedding steps_json if provided
            new_desc = data.get('description', meeting.description or '')
            steps_json = data.get('steps_json')
            if steps_json:
                import re
                new_desc = re.sub(r'\n\n__steps_json__.*?__end_steps__', '', new_desc or '', flags=re.DOTALL)
                new_desc = f"{new_desc}\n\n__steps_json__{steps_json}__end_steps__"
            meeting.description = new_desc

            if 'participants' in data:
                meeting.participants.set(Employee.objects.filter(id__in=data['participants']))
            
            meeting.save()
            return Response({'success': True, 'message': 'Meeting updated'})
            
    except Meeting.DoesNotExist:
        return Response({'success': False, 'message': 'Meeting not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




