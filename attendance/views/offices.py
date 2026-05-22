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
from .utils import calculate_distance, get_current_user

# --- Function: offices_list ---
@api_view(['GET'])
@require_gated_token_api
def offices_list(request):
    """Retrieve registered active office locations"""
    department = request.GET.get('department')
    active_param = request.GET.get('active')
    only_active = active_param not in ['0', 'false', 'False']

    try:
        offices = OfficeLocation.objects.all()
        if only_active:
            offices = offices.filter(is_active=True)
        offices = offices.order_by('name')

        offices_data = [{
            'id': office.id,
            'name': office.name,
            'address': office.address,
            'latitude': float(office.latitude),
            'longitude': float(office.longitude),
            'radius_meters': office.radius_meters,
            'is_active': office.is_active,
        } for office in offices]

        return Response({
            'success': True,
            'offices': offices_data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch office information'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: check_location ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def check_location(request):
    """Check if user location is within office geofence"""
    data = request.data
    user_lat = data.get('latitude')
    user_lng = data.get('longitude')
    office_id = data.get('office_id')

    if not all([user_lat, user_lng, office_id]):
        return Response({
            'success': False,
            'message': 'Latitude, longitude, and office_id are required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        office = OfficeLocation.objects.get(id=office_id)
        distance = calculate_distance(
            user_lat, user_lng,
            float(office.latitude), float(office.longitude)
        )

        return Response({
            'success': True,
            'distance': distance,
            'in_range': distance <= office.radius_meters,
            'office_location': {
                'latitude': float(office.latitude),
                'longitude': float(office.longitude),
                'radius_meters': office.radius_meters,
            }
        })
    except OfficeLocation.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Office not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to check location'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# --- Function: check_location_proximity ---
def check_location_proximity(lat, lng, office_id):
    """Helper function to check location proximity"""
    try:
        office = OfficeLocation.objects.get(id=office_id)
        distance = calculate_distance(
            lat, lng,
            float(office.latitude), float(office.longitude)
        )
        return {
            'success': True,
            'distance': distance,
            'in_range': distance <= office.radius_meters,
        }
    except:
        return {'success': False, 'in_range': False}




# --- Function: create_office ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def create_office(request):
    """Create a new office (admin)"""
    data = request.data

    if not data.get('id') or not data.get('name'):
        return Response({
            'success': False,
            'message': 'Office ID and Office name are required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        office = OfficeLocation.objects.create(
            id=data['id'],
            name=data['name'],
            address=data.get('address', ''),
            latitude=float(data['latitude']) if data.get('latitude') else None,
            longitude=float(data['longitude']) if data.get('longitude') else None,
            radius_meters=int(data.get('radius_meters') or data.get('radius') or 100),
            is_active=True
        )

        # Grant access to all departments
        departments = ['IT', 'HR', 'Surveyors', 'Accounts', 'Growth', 'Others']
        for dept in departments:
            DepartmentOfficeAccess.objects.get_or_create(
                department=dept,
                office=office
            )

        return Response({
            'success': True,
            'message': 'Office created',
            'office_id': office.id
        })
    except Exception as e:
        if 'UNIQUE constraint' in str(e) or 'Duplicate entry' in str(e):
            return Response({
                'success': False,
                'message': 'Failed to create office: That Office ID already exists.'
            }, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'success': False,
            'message': f'Failed to create office: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: office_detail ---
@api_view(['GET', 'POST', 'DELETE'])
@require_gated_token_api
@parser_classes([JSONParser])
def office_detail(request, office_id):
    """Get, update, or delete an office"""
    try:
        office = OfficeLocation.objects.get(id=office_id)
    except OfficeLocation.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Office not found'
        }, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response({
            'success': True,
            'office': {
                'id': office.id,
                'name': office.name,
                'address': office.address,
                'latitude': float(office.latitude),
                'longitude': float(office.longitude),
                'radius_meters': office.radius_meters,
                'is_active': office.is_active,
            }
        })

    elif request.method == 'POST':
        data = request.data

        # Check if delete
        if data.get('_method') == 'DELETE':
            office.delete()
            return Response({
                'success': True,
                'message': 'Office deleted successfully'
            })

        # Update office
        office.name = data.get('name', office.name)
        office.address = data.get('address', office.address)
        if data.get('latitude'):
            office.latitude = float(data['latitude'])
        if data.get('longitude'):
            office.longitude = float(data['longitude'])
        if data.get('radius_meters'):
            office.radius_meters = int(data['radius_meters'])
        office.save()

        return Response({
            'success': True,
            'message': 'Office updated successfully'
        })

    elif request.method == 'DELETE':
        office.delete()
        return Response({
            'success': True,
            'message': 'Office deleted successfully'
        })




