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

# --- Function: create_team ---
@api_view(['POST'])
@require_gated_token_api
def create_team(request):
    try:
        data = request.data
        mentor_id = data.get('mentor_id')
        name = data.get('name')
        member_ids = data.get('members', [])

        if not mentor_id:
             return Response({'success': False, 'message': 'Mentor ID required'})

        mentor_obj = Employee.objects.filter(id=mentor_id).first()
        if not mentor_obj:
            return Response({'success': False, 'message': 'Mentor not found'})

        team = Team.objects.create(name=name, mentor=mentor_obj)
        
        if member_ids:
            members = Employee.objects.filter(id__in=member_ids)
            team.members.set(members)

        return Response({'success': True, 'message': 'Team created successfully', 'team_id': team.id})
    except Exception as e:
        return Response({'success': False, 'message': str(e)})



# --- Function: update_team ---
@api_view(['POST'])
@require_gated_token_api
def update_team(request):
    try:
        data = request.data
        team_id = data.get('team_id')
        name = data.get('name')
        member_ids = data.get('members', [])

        team = Team.objects.filter(id=team_id).first()
        if not team:
            return Response({'success': False, 'message': 'Team not found'})

        if name:
            team.name = name
        
        if member_ids:
            members = Employee.objects.filter(id__in=member_ids)
            team.members.set(members)
        
        team.save()
        return Response({'success': True, 'message': 'Team updated successfully'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)})



# --- Function: delete_team ---
@api_view(['DELETE', 'POST']) # Support POST with method override for simplicity if needed
@require_gated_token_api
def delete_team(request):
    try:
        team_id = request.data.get('team_id') or request.query_params.get('team_id')
        team = Team.objects.filter(id=team_id).first()
        if not team:
            return Response({'success': False, 'message': 'Team not found'})
            
        team.delete()
        return Response({'success': True, 'message': 'Team deleted successfully'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)})




# --- Function: get_teams ---
@api_view(['GET'])
@require_gated_token_api
def get_teams(request):
    try:
        mentor_id = request.query_params.get('mentor_id')
        if not mentor_id:
             return Response({'success': False, 'message': 'Mentor ID required'})
             
        teams = Team.objects.filter(mentor_id=mentor_id).prefetch_related('members')
        data = []
        for t in teams:
            data.append({
                'id': t.id,
                'name': t.name,
                'members': list(t.members.values('id', 'name', 'username', 'role'))
            })
            
        return Response({'success': True, 'teams': data})
    except Exception as e:
        return Response({'success': False, 'message': str(e)})



