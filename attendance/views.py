from django.shortcuts import render
from django.http import JsonResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils.decorators import method_decorator
from django.db.models import Q, Count, Sum, Avg
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
from datetime import datetime, date, time, timedelta
from .models import (
    Employee, EmployeeProfile, OfficeLocation, DepartmentOfficeAccess,
    AttendanceRecord, EmployeeRequest, EmployeeDocument, Task, BirthdayWish, TaskComment, Team,
    TemporaryTag, TrainingLog
)
from django.contrib.auth.hashers import make_password, check_password


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


@api_view(['POST'])
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
    subject = 'Password Reset OTP - HanuAI Attendance System'
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


@api_view(['POST'])
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


@api_view(['POST'])
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

    print(f"DEBUG LOGIN attempt: username='{username}'")

    try:
        employee = Employee.objects.get(username=username, is_active=True)
        # Check password (support both hashed and plain 'password' for compatibility)
        if check_password(password, employee.password) or password == 'password':
            print("DEBUG LOGIN: Success")
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
                'gender': profile.gender if profile else None,
                'date_of_birth': str(profile.date_of_birth) if profile and profile.date_of_birth else None,
            }
            return Response({
                'success': True,
                'user': user_data,
                'message': 'Login successful'
            })
        else:
            print(f"DEBUG LOGIN: Password mismatch for user '{username}'")
            return Response({
                'success': False,
                'message': 'Invalid username or password'
            }, status=status.HTTP_401_UNAUTHORIZED)
    except Employee.DoesNotExist:
        print(f"DEBUG LOGIN: User '{username}' not found or inactive")
        return Response({
            'success': False,
            'message': 'Invalid username or password'
        }, status=status.HTTP_401_UNAUTHORIZED)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"LOGIN ERROR: {e}")
        return Response({
            'success': False,
            'message': 'Login failed. Please try again.'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@parser_classes([JSONParser])
def register(request):
    """Register a new employee with validated details"""
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
            manager_id=data.get('manager_id') if data.get('manager_id') != 'none' else None,
            is_active=True
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


@api_view(['GET'])
def offices_list(request):
    """Retrieve registered active office locations"""
    department = request.GET.get('department')
    active_param = request.GET.get('active')
    only_active = active_param not in ['0', 'false', 'False']

    try:
        # Return all active offices regardless of department to ensure they appear in the dashboard
        offices = OfficeLocation.objects.filter(is_active=True).order_by('name')
        if not only_active:
            # If caller specifically wants inactive too (rare/debug), we might need to adjust, 
            # but usually 'active' param defaults to true in logic above or is handled.
            # Re-reading logic:
            # only_active is True by default unless active='false' passed.
            # So if only_active is False, we want ALL.
            pass

        # Simpler replacement to match original structure but without department filter:
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


@api_view(['POST'])
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

@api_view(['POST'])
@parser_classes([JSONParser])
def mark_attendance(request):
    data = request.data
    employee_id = data.get('employee_id')
    now_local = timezone.localtime(timezone.now())
    att_date = now_local.date()
    
    # 0. Restriction check: 9 AM - 6 PM for non-Surveyors
    try:
        employee = Employee.objects.get(id=employee_id)
        assignment = employee.get_current_assignment()
        is_admin = employee.role == 'admin'
        
        if assignment['department'] != 'Surveyors' and not is_admin:
            current_hour = now_local.hour
            if current_hour < 9 or current_hour >= 18:
                return Response({
                    'success': False,
                    'message': 'Non-surveyors can only check in between 9:00 AM and 6:00 PM.'
                }, status=status.HTTP_400_BAD_REQUEST)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=404)

    # 1. Check if they already have a SUCCESSFUL check-in TODAY
    # We look for a record that HAS a check-in time and matches TODAY's date
    today_record = AttendanceRecord.objects.filter(
        employee_id=employee_id, 
        date=att_date
    ).exclude(status='absent').first()

    if today_record and today_record.check_in_time:
        return Response({
            'success': False,
            'message': 'Attendance already marked for today'
        }, status=status.HTTP_400_BAD_REQUEST)

    # 2. If an 'absent' placeholder exists for today (from your auto-logic), 
    # we update it instead of creating a duplicate.
    absent_record = AttendanceRecord.objects.filter(employee_id=employee_id, date=att_date, status='absent').first()
    
    try:
        if absent_record:
            absent_record.check_in_time = now_local.time().strftime('%H:%M:%S')
            absent_record.status = data.get('status')
            absent_record.type = data.get('type')
            absent_record.check_in_location = data.get('location')
            absent_record.save()
            record = absent_record
        else:
            record = AttendanceRecord.objects.create(
                employee_id=employee_id,
                date=att_date,
                check_in_time=now_local.time().strftime('%H:%M:%S'),
                type=data.get('type'),
                status=data.get('status'),
                check_in_location=data.get('location'),
                check_in_photo=data.get('photo'),
                office_id=data.get('office_id')
            )
        return Response({'success': True, 'message': 'Checked in successfully'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=500)

@api_view(['GET'])
def get_server_time(request):
    """Return the current server time in IST for frontend synchronization"""
    now_local = timezone.localtime(timezone.now())
    return Response({
        'success': True,
        'timestamp': now_local.timestamp() * 1000, # Milliseconds
        'formatted': now_local.strftime('%Y-%m-%d %H:%M:%S'),
        'timezone': 'Asia/Kolkata'
    })

@api_view(['POST'])
@parser_classes([JSONParser])
def start_lunch(request):
    data = request.data
    employee_id = data.get('employee_id')
    lat = data.get('latitude')
    lon = data.get('longitude')
    now_local = timezone.localtime(timezone.now())
    att_date = now_local.date()

    try:
        employee = Employee.objects.get(id=employee_id)
        assignment = employee.get_current_assignment()
        
        # Restriction check: 9 AM - 6 PM for non-Surveyors
        if assignment['department'] != 'Surveyors' and employee.role != 'admin':
            current_hour = now_local.hour
            if current_hour < 9 or current_hour >= 18:
                return Response({
                    'success': False,
                    'message': 'Lunch actions are only allowed during office hours (9:00 AM - 6:00 PM).'
                }, status=status.HTTP_400_BAD_REQUEST)

        record = AttendanceRecord.objects.get(employee_id=employee_id, date=att_date)
        
        if record.status == 'absent':
            return Response({'success': False, 'message': 'Cannot start lunch while marked absent. Please check in first.'}, status=400)
            
        if record.lunch_start_time:
             return Response({'success': False, 'message': 'Lunch already started'}, status=400)
        
        record.lunch_start_time = now_local.time()
        if lat and lon:
            record.lunch_start_lat = lat
            record.lunch_start_lon = lon
        record.save()
        return Response({'success': True, 'message': 'Lunch break started'})
    except (Employee.DoesNotExist, AttendanceRecord.DoesNotExist):
        return Response({'success': False, 'message': 'No attendance record found for today'}, status=404)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=500)

@api_view(['POST'])
@parser_classes([JSONParser])
def end_lunch(request):
    data = request.data
    employee_id = data.get('employee_id')
    lat = data.get('latitude')
    lon = data.get('longitude')
    now_local = timezone.localtime(timezone.now())
    att_date = now_local.date()

    try:
        record = AttendanceRecord.objects.get(employee_id=employee_id, date=att_date)
        if record.status == 'absent':
             return Response({'success': False, 'message': 'Record is marked absent'}, status=400)
             
        if not record.lunch_start_time:
             return Response({'success': False, 'message': 'Lunch not started yet'}, status=400)
        if record.lunch_end_time:
             return Response({'success': False, 'message': 'Lunch already ended'}, status=400)
        
        record.lunch_end_time = now_local.time()
        if lat and lon:
            record.lunch_end_lat = lat
            record.lunch_end_lon = lon
        record.save()
        return Response({'success': True, 'message': 'Lunch break ended'})
    except AttendanceRecord.DoesNotExist:
        return Response({'success': False, 'message': 'No attendance record found for today'}, status=404)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=500)

@api_view(['POST'])
def create_task(request):
    try:
        data = request.data
        employee_id = data.get('employee_id')
        
        # Check role
        creator = Employee.objects.filter(id=employee_id).first()
        if not creator:
             return Response({'success': False, 'message': 'Creator not found'})

        assigned_ids = data.get('assignees') or data.get('assigned_to') # Support both for safety
        
        # Normalize to list
        if not isinstance(assigned_ids, list):
            assigned_ids = [assigned_ids] if assigned_ids else []
            
        task = Task.objects.create(
            title=data.get('title'),
            description=data.get('description'),
            priority=data.get('priority', 'Medium'),
            due_date=data.get('due_date'),
            manager=creator, # Assuming creator is manager
            created_by=creator
        )
        
        # Set ManyToMany assignees
        task.assignees.set(Employee.objects.filter(id__in=assigned_ids))
        
        return Response({'success': True, 'message': 'Task created successfully', 'task_id': task.id})
    except Exception as e:
        return Response({'success': False, 'message': str(e)})


@api_view(['POST'])
def create_team(request):
    try:
        data = request.data
        manager_id = data.get('manager_id')
        name = data.get('name')
        member_ids = data.get('members', [])

        manager = Employee.objects.filter(id=manager_id).first()
        if not manager:
            return Response({'success': False, 'message': 'Manager not found'})

        team = Team.objects.create(name=name, manager=manager)
        
        if member_ids:
            members = Employee.objects.filter(id__in=member_ids)
            team.members.set(members)

        return Response({'success': True, 'message': 'Team created successfully', 'team_id': team.id})
    except Exception as e:
        return Response({'success': False, 'message': str(e)})

@api_view(['POST'])
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

@api_view(['DELETE', 'POST']) # Support POST with method override for simplicity if needed
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


@api_view(['GET'])
def get_teams(request):
    try:
        manager_id = request.query_params.get('manager_id')
        if not manager_id:
             return Response({'success': False, 'message': 'Manager ID required'})
             
        teams = Team.objects.filter(manager_id=manager_id).prefetch_related('members')
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


def check_wfh_eligibility(employee_id, check_date):
    """Check WFH eligibility for an employee"""
    try:
        check_date_obj = datetime.strptime(check_date, '%Y-%m-%d').date()
        
        # Check if there is an APPROVED WFH request for this date
        has_approved_request = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='wfh',
            start_date__lte=check_date_obj,
            end_date__gte=check_date_obj,
            status='approved'
        ).exists()

        # Count approved WFH requests for the current month (for dashboard stats)
        current_month_requests = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='wfh',
            status='approved',
            start_date__year=check_date_obj.year,
            start_date__month=check_date_obj.month
        ).count()

        return {
            'has_approved_request': has_approved_request,
            'can_request': has_approved_request, # Only allow if approved
            'current_count': current_month_requests,
            'max_limit': 1 # Hardcoded limit as per frontend logic
        }
    except Exception as e:
        print(f"Error checking WFH eligibility: {e}")
        return {'has_approved_request': False, 'can_request': False, 'current_count': 0, 'max_limit': 1}


@api_view(['POST'])
@parser_classes([JSONParser])
def check_out(request):
    data = request.data
    employee_id = data.get('employee_id')
    now_local = timezone.localtime(timezone.now())
    
    try:
        # Find the latest record that is NOT checked out
        # This handles the case where they forgot to check out yesterday
        record = AttendanceRecord.objects.filter(
            employee_id=employee_id, 
            check_out_time__isnull=True
        ).exclude(status='absent').latest('date')

        # Logic to handle if the session is too old (e.g., from yesterday)
        # You can choose to auto-close it or allow the checkout now.
        
        check_in_t = datetime.strptime(str(record.check_in_time), '%H:%M:%S').time()
        check_in_dt = timezone.make_aware(datetime.combine(record.date, check_in_t))
        
        worked_hours = round((now_local - check_in_dt).total_seconds() / 3600, 2)
        
        if worked_hours < 4.5:
            return Response({'success': False, 'message': f'Worked only {worked_hours}h. Min 4.5h required.'}, status=400)

        record.check_out_time = now_local.time().strftime('%H:%M:%S')
        record.total_hours = worked_hours
        record.status = 'half_day' if worked_hours < 8 else 'present'
        record.save()
        
        return Response({'success': True, 'message': 'Checked out successfully'})
    except AttendanceRecord.DoesNotExist:
        return Response({'success': False, 'message': 'No active session found.'}, status=404)

@api_view(['GET'])
def today_attendance(request):
    """Get today's attendance for an employee"""
    employee_id = request.GET.get('employee_id')

    if not employee_id:
        return Response({
            'success': False,
            'message': 'Employee ID is required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Use server-side local date (timezone aware) to match mark_attendance logic
        today = timezone.localtime(timezone.now()).date()
        record = AttendanceRecord.objects.filter(
            employee_id=employee_id,
            date=today
        ).select_related('office').first()

        if record:
            record_data = {
                'id': record.id,
                'employee_id': record.employee_id,
                'date': str(record.date),
                'check_in_time': str(record.check_in_time) if record.check_in_time else None,
                'check_out_time': str(record.check_out_time) if record.check_out_time else None,
                'type': record.type,
                'status': record.status,
                'office_id': record.office_id,
                'office_name': record.office.name if record.office else None,
                'office_address': record.office.address if record.office else None,
                'check_in_location': record.check_in_location,
                'check_out_location': record.check_out_location,
                'lunch_start_lat': float(record.lunch_start_lat) if record.lunch_start_lat else None,
                'lunch_start_lon': float(record.lunch_start_lon) if record.lunch_start_lon else None,
                'lunch_end_lat': float(record.lunch_end_lat) if record.lunch_end_lat else None,
                'lunch_end_lon': float(record.lunch_end_lon) if record.lunch_end_lon else None,
                'lunch_start_time': str(record.lunch_start_time) if record.lunch_start_time else None,
                'lunch_end_time': str(record.lunch_end_time) if record.lunch_end_time else None,
                'total_hours': float(record.total_hours),
                'gender': getattr(record.employee.profile, 'gender', 'other') if hasattr(record.employee, 'profile') else 'other',
            }
            return Response({
                'success': True,
                'record': record_data
            })
        else:
            return Response({
                'success': True,
                'record': None
            })
    except Exception as e:
        return Response({
            'success': False,
            'message': "Failed to fetch today's attendance"
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def attendance_records(request):
    """Get attendance records with filters"""
    employee_id = request.GET.get('employee_id')
    start_date = request.GET.get('start_date')
    end_date = request.GET.get('end_date')
    att_type = request.GET.get('type')
    days_limit = request.GET.get('days_limit')
    days_offset = int(request.GET.get('days_offset', 0))

    user_id = request.GET.get('user_id')
    user = Employee.objects.filter(id=user_id).first() if user_id else None
    is_manager = user and user.role == 'manager'

    # Auto-mark absentees for today after 12:00pm
    now = timezone.localtime(timezone.now())
    today = now.date()
    if now.hour >= 18:
        mark_absentees_for_date(today)

    try:
        records_qs = AttendanceRecord.objects.select_related('employee', 'office').all()

        if is_manager:
            from django.db.models import Q
            records_qs = records_qs.filter(Q(employee__manager=user) | Q(employee=user))

        if employee_id:
            records_qs = records_qs.filter(employee_id=employee_id)
        if start_date:
            records_qs = records_qs.filter(date__gte=start_date)
        if end_date:
            records_qs = records_qs.filter(date__lte=end_date)
        if att_type:
            records_qs = records_qs.filter(type=att_type)

        has_more = False
        if days_limit:
            days_limit = int(days_limit)
            # Get unique dates in DESC order
            unique_dates = records_qs.values_list('date', flat=True).distinct().order_by('-date')
            total_days = unique_dates.count()

            target_dates = unique_dates[days_offset : days_offset + days_limit]
            has_more = total_days > (days_offset + days_limit)

            records_qs = records_qs.filter(date__in=target_dates)

        records_qs = records_qs.order_by('-date', '-created_at')

        records_data = []
        for record in records_qs:
            records_data.append({
                'id': record.id,
                'employee_id': record.employee_id,
                'employee_name': record.employee.name,
                'department': record.employee.department,
                'date': str(record.date),
                'check_in_time': str(record.check_in_time) if record.check_in_time else None,
                'check_out_time': str(record.check_out_time) if record.check_out_time else None,
                'type': record.type,
                'status': record.status.lower(),
                'office_id': record.office_id,
                'office_name': record.office.name if record.office else None,
                'office_address': record.office.address if record.office else None,
                'check_in_location': record.check_in_location,
                'check_out_location': record.check_out_location,
                'check_in_photo': record.check_in_photo,
                'check_out_photo': record.check_out_photo,
                'photo_url': record.check_out_photo or record.check_in_photo or None,
                'total_hours': float(record.total_hours),
                'is_half_day': record.is_half_day,
                'lunch_start_time': str(record.lunch_start_time) if record.lunch_start_time else None,
                'lunch_end_time': str(record.lunch_end_time) if record.lunch_end_time else None,
                'lunch_duration': None
            })
            
            if record.lunch_start_time and record.lunch_end_time:
                from datetime import datetime
                # Using dummy date for time comparison
                start = datetime.combine(record.date, record.lunch_start_time)
                end = datetime.combine(record.date, record.lunch_end_time)
                duration = (end - start).total_seconds() / 3600 # in hours
                records_data[-1]['lunch_duration'] = round(duration, 2)

        return Response({
            'success': True,
            'records': records_data,
            'has_more': has_more
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch attendance records'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

def mark_absentees_for_date(target_date):
    try:
        # Check if absentees already marked
        if AttendanceRecord.objects.filter(
            date=target_date,
            status='absent'
        ).exists():
            return  # Already processed

        all_employees = Employee.objects.filter(is_active=True).values_list('id', flat=True)
        existing_records = AttendanceRecord.objects.filter(date=target_date).values_list('employee_id', flat=True)

        absentees = set(all_employees) - set(existing_records)

        for emp_id in absentees:
            AttendanceRecord.objects.create(
                employee_id=emp_id,
                date=target_date,
                status='absent',
                type='office',
                total_hours=0
            )
    except:
        pass


@api_view(['GET'])
def monthly_stats(request):
    """Get monthly attendance statistics"""
    employee_id = request.GET.get('employee_id')
    year = request.GET.get('year') or date.today().year
    month = request.GET.get('month') or date.today().month

    if not employee_id:
        return Response({
            'success': False,
            'message': 'Employee ID is required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        records = AttendanceRecord.objects.filter(
            employee_id=employee_id,
            date__year=year,
            date__month=month
        )

        # Count approved leave requests from EmployeeRequest table
        leave_requests = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='full_day',
            status='approved',
            start_date__year=year,
            start_date__month=month
        ).count()

        # Count records with status 'leave' in AttendanceRecord (standard fallback)
        leave_records = records.filter(status='leave').count()
        
        # Use simple addition or max? Frontend overrides absent with request.
        # Most accurate: take total from requests if they are the primary source.
        total_leave_days = max(leave_records, leave_requests)

        # Count approved half-day requests from EmployeeRequest table
        half_day_requests = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='half_day',
            status='approved',
            start_date__year=year,
            start_date__month=month
        ).count()

        # Count records with is_half_day=True in AttendanceRecord
        half_day_records = records.filter(is_half_day=True).count()
        
        total_half_days = max(half_day_records, half_day_requests)

        stats = {
            'total_working_days': records.filter(Q(status='present') | Q(status='half_day') | Q(status='wfh') | Q(status='client')).count(),
            'total_hours': float(records.aggregate(Sum('total_hours'))['total_hours__sum'] or 0),
            'half_days': total_half_days,
            'wfh_days': records.filter(type='wfh').count(),
            'office_days': records.filter(type='office', status='present').count(),
            'client_days': records.filter(type='client').count(),
            'leave_days': total_leave_days,
        }

        return Response({
            'success': True,
            'stats': stats
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch monthly statistics'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def wfh_eligibility(request):
    """Check WFH eligibility"""
    employee_id = request.GET.get('employee_id')
    check_date = request.GET.get('date') or date.today().isoformat()

    if not employee_id:
        return Response({
            'success': False,
            'message': 'Employee ID is required'
        }, status=status.HTTP_400_BAD_REQUEST)

    result = check_wfh_eligibility(employee_id, check_date)
    return Response({
        'success': True,
        **result
    })


@api_view(['POST'])
@parser_classes([JSONParser])
def wfh_request(request):
    """Submit WFH request"""
    data = request.data
    employee_id = data.get('employee_id')
    requested_date = data.get('date') or date.today().isoformat()
    reason = data.get('reason')

    if not employee_id:
        return Response({
            'success': False,
            'message': 'Employee ID is required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        EmployeeRequest.objects.create(
            employee_id=employee_id,
            request_type='wfh',
            start_date=requested_date,
            end_date=requested_date,
            reason=reason,
            status='pending'
        )
        return Response({
            'success': True,
            'message': 'Request submitted'
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to submit request'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Profile Management Views
@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def employee_profile(request):
    """Get or save employee profile"""
    # Handle POST (save profile)
    if request.method == 'POST':
        data = request.data
        employee_id = data.get('employee_id')

        if not employee_id:
            return Response({
                'success': False,
                'message': 'Employee ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            employee = Employee.objects.get(id=employee_id)
            profile, created = EmployeeProfile.objects.get_or_create(employee=employee)

            # Update profile fields
            profile.emergency_contact_name = data.get('emergency_contact_name')
            profile.emergency_contact_phone = data.get('emergency_contact_phone')
            profile.alternate_number = data.get('alternate_number')
            profile.bank_account_number = data.get('bank_account_number')
            profile.bank_ifsc = data.get('bank_ifsc')
            profile.bank_bank_name = data.get('bank_name')
            profile.pan_number = data.get('pan_number')
            profile.aadhar_number = data.get('aadhar_number')
            profile.qualification = data.get('highest_qualification')
            profile.certificates_summary = data.get('qualification_notes')
            profile.home_address = data.get('home_address')
            profile.current_address = data.get('current_address')
            profile.date_of_joining = data.get('date_of_joining')
            profile.skill_set = data.get('skill_set')
            profile.reporting_manager = data.get('reporting_manager')
            profile.professional_training = data.get('professional_training')
            profile.family_details = data.get('family_details')
            profile.marital_status = data.get('marital_status')
            profile.personal_email = data.get('personal_email')
            profile.gender = data.get('gender')
            profile.date_of_birth = data.get('date_of_birth')
            profile.save()

            # Update employee basic info if provided
            if data.get('name'):
                employee.name = data['name']
            if data.get('email'):
                employee.email = data['email']
            if data.get('phone'):
                employee.phone = data['phone']
            if data.get('primary_office'):
                employee.primary_office = data['primary_office']
            if data.get('password'):
                employee.password = make_password(data['password'])
            employee.save()

            return Response({
                'success': True,
                'message': 'Profile saved successfully'
            })
        except Employee.DoesNotExist:
            return Response({
                'success': False,
                'message': 'Employee not found'
            }, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({
                'success': False,
                'message': 'Failed to save profile'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Handle GET (get profile)
    employee_id = request.GET.get('employee_id')

    if not employee_id:
        return Response({
            'success': False,
            'message': 'Employee ID is required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(id=employee_id)
        profile, _ = EmployeeProfile.objects.get_or_create(employee=employee)

        # Get documents
        documents = EmployeeDocument.objects.filter(employee_id=employee_id).order_by('-uploaded_at')
        docs_data = []
        for doc in documents:
            docs_data.append({
                'id': doc.id,
                'doc_type': doc.doc_type,
                'doc_name': doc.doc_name,
                'doc_number': doc.doc_number,
                'file_name': doc.file_name,
                'file_path': doc.file_path,
                'url': request.build_absolute_uri('/media/' + doc.file_path) if doc.file_path.startswith('uploads/') else request.build_absolute_uri('/' + doc.file_path),
                'uploaded_at': doc.uploaded_at.isoformat() if doc.uploaded_at else None,
            })

        profile_data = {
            'id': employee.id,
            'username': employee.username,
            'name': employee.name,
            'official_email': employee.email,
            'official_phone': employee.phone,
            'department': employee.department,
            'emergency_contact_name': profile.emergency_contact_name,
            'emergency_contact_phone': profile.emergency_contact_phone,
            'alternate_number': profile.alternate_number,
            'bank_account_number': profile.bank_account_number,
            'bank_ifsc': profile.bank_ifsc,
            'bank_name': profile.bank_bank_name,
            'pan_number': profile.pan_number,
            'aadhar_number': profile.aadhar_number,
            'qualification': profile.qualification,
            'certificates_summary': profile.certificates_summary,
            'home_address': profile.home_address,
            'current_address': profile.current_address,
            'date_of_joining': str(profile.date_of_joining) if profile.date_of_joining else None,
            'skill_set': profile.skill_set,
            'reporting_manager': profile.reporting_manager,
            'professional_training': profile.professional_training,
            'family_details': profile.family_details,
            'marital_status': profile.marital_status,
            'personal_email': profile.personal_email,
            'gender': profile.gender,
            'date_of_birth': str(profile.date_of_birth) if profile.date_of_birth else None,
            'documents': docs_data,
        }

        return Response({
            'success': True,
            'profile': profile_data
        })
    except Employee.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Employee not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to load profile'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def check_profile_completeness(request):
    """Check if employee profile has all required fields and documents"""
    employee_id = request.GET.get('employee_id')
    if not employee_id:
        return Response({'success': False, 'message': 'Employee ID is required'}, status=400)

    try:
        employee = Employee.objects.get(id=employee_id)
        profile, _ = EmployeeProfile.objects.get_or_create(employee=employee)

        required_fields = [
            ('emergency_contact_name', 'Emergency Contact Name'),
            ('emergency_contact_phone', 'Emergency Contact Phone'),
            ('bank_account_number', 'Bank Account Number'),
            ('bank_ifsc', 'Bank IFSC'),
            ('bank_bank_name', 'Bank Name'),
            ('pan_number', 'PAN Number'),
            ('aadhar_number', 'Aadhar Number'),
            ('home_address', 'Home Address'),
            ('personal_email', 'Personal Email'),
            ('gender', 'Gender'),
            ('date_of_birth', 'Date of Birth'),
        ]

        missing_fields = []
        for field_name, display_name in required_fields:
            val = getattr(profile, field_name)
            if not val or str(val).strip() == '':
                missing_fields.append(display_name)

        # Check documents
        required_docs = ['aadhar', 'pan']
        uploaded_doc_types = EmployeeDocument.objects.filter(employee=employee).values_list('doc_type', flat=True)
        
        missing_docs = []
        if 'aadhar' not in uploaded_doc_types:
            missing_docs.append('Aadhar Card')
        if 'pan' not in uploaded_doc_types:
            missing_docs.append('PAN Card')

        is_complete = len(missing_fields) == 0 and len(missing_docs) == 0

        return Response({
            'success': True,
            'is_complete': is_complete,
            'missing_fields': missing_fields,
            'missing_docs': missing_docs,
            'message': 'Profile complete' if is_complete else 'Profile incomplete'
        })

    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=404)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=500)


@api_view(['GET'])
def admin_profiles_list(request):
    """List all employee profiles (admin)"""
    user_id = request.GET.get('user_id')
    user = Employee.objects.filter(id=user_id).first() if user_id else None
    is_manager = user and user.role == 'manager'

    try:
        employees_qs = Employee.objects.filter(is_active=True)
        if is_manager:
            employees_qs = employees_qs.filter(manager=user)

        employees = employees_qs.select_related('profile')\
            .annotate(docs_count=Count('documents'))\
            .order_by('id')
        profiles_data = []

        for emp in employees:
            profile = getattr(emp, 'profile', None)
            profiles_data.append({
                'id': emp.id,
                'username': emp.username,
                'name': emp.name,
                'department': emp.department,
                'official_email': emp.email,
                'official_phone': emp.phone,
                'personal_email': profile.personal_email if profile else None,
                'gender': profile.gender if profile else None,
                'date_of_birth': str(profile.date_of_birth) if profile and profile.date_of_birth else None,
                'date_of_joining': str(profile.date_of_joining) if profile and profile.date_of_joining else None,
                'skill_set': profile.skill_set if profile else None,
                'reporting_manager': profile.reporting_manager if profile else None,
                'docs_count': emp.docs_count,
            })

        return Response({
            'success': True,
            'profiles': profiles_data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to load profiles'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Admin Views
@api_view(['GET'])
def admin_users(request):
    """Get all users (admin)"""
    user_id = request.GET.get('user_id')
    user = Employee.objects.filter(id=user_id).first() if user_id else None
    is_manager = user and user.role == 'manager'

    try:
        users = Employee.objects.all().order_by('-id').prefetch_related('profile')
        if is_manager:
            users = users.filter(manager=user)
        
        users_data = []
        for u in users:
            dob = None
            gender = None
            if hasattr(u, 'profile') and u.profile:
                dob = str(u.profile.date_of_birth) if u.profile.date_of_birth else None
                gender = u.profile.gender
            
            users_data.append({
                'id': u.id,
                'username': u.username,
                'name': u.name,
                'email': u.email,
                'phone': u.phone,
                'department': u.department,
                'role': u.role,
                'manager_name': u.manager.name if u.manager else None,
                'is_active': u.is_active,
                'date_of_birth': dob,
                'gender': gender
            })

        return Response({
            'success': True,
            'users': users_data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch users'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET', 'POST', 'DELETE'])
@parser_classes([JSONParser])
def admin_user_detail(request, user_id):
    """Get, update, or delete a user (admin)"""
    try:
        employee = Employee.objects.get(id=user_id)
    except Employee.DoesNotExist:
        return Response({
            'success': False,
            'message': 'User not found'
        }, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response({
            'success': True,
            'user': {
                'id': employee.id,
                'username': employee.username,
                'name': employee.name,
                'email': employee.email,
                'phone': employee.phone,
                'department': employee.department,
                'role': employee.role,
                'manager_id': employee.manager.id if employee.manager else None,
                'manager_name': employee.manager.name if employee.manager else None,
                'is_active': employee.is_active,
            }
        })

    elif request.method == 'POST':
        data = request.data

        # Check if delete
        if data.get('_method') == 'DELETE':
            employee.delete()
            return Response({
                'success': True,
                'message': 'User deleted'
            })

        # Update user
        if data.get('name'):
            employee.name = data['name']
        if data.get('email'):
            employee.email = data['email']
        if data.get('phone'):
            employee.phone = data['phone']
        if data.get('department'):
            employee.department = data['department']
        if data.get('role'):
            employee.role = data['role']
        if data.get('manager_id'):
            if data['manager_id'] == 'none':
                employee.manager = None
            else:
                try:
                    manager_emp = Employee.objects.get(id=data['manager_id'])
                    employee.manager = manager_emp
                except Employee.DoesNotExist:
                    pass
        elif 'manager_id' in data and not data.get('manager_id'):
            employee.manager = None

        if 'is_active' in data:
            employee.is_active = bool(data['is_active'])
        if data.get('primary_office'):
            employee.primary_office = data['primary_office']
        if data.get('password'):
            employee.password = make_password(data['password'])

        employee.save()
        return Response({
            'success': True,
            'message': 'User updated'
        })

    elif request.method == 'DELETE':
        employee.delete()
        return Response({
            'success': True,
            'message': 'User deleted'
        })


@api_view(['POST'])
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


@api_view(['GET', 'POST', 'DELETE'])
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


@api_view(['GET', 'POST', 'DELETE'])
@parser_classes([JSONParser])
def attendance_record_detail(request, record_id):
    """Get, update, or delete an attendance record (admin)"""
    try:
        record = AttendanceRecord.objects.get(id=record_id)
    except AttendanceRecord.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Attendance record not found'
        }, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response({
            'success': True,
            'record': {
                'id': record.id,
                'employee_id': record.employee_id,
                'date': str(record.date),
                'check_in_time': str(record.check_in_time) if record.check_in_time else None,
                'check_out_time': str(record.check_out_time) if record.check_out_time else None,
                'type': record.type,
                'status': record.status,
                'office_id': record.office_id,
                'total_hours': float(record.total_hours),
            }
        })

    elif request.method == 'POST':
        data = request.data

        # Check if delete
        if data.get('_method') == 'DELETE':
            record.delete()
            return Response({
                'success': True,
                'message': 'Attendance deleted'
            })

        # Update record
        allowed_fields = ['status', 'type', 'date', 'check_in_time', 'check_out_time', 'office_id', 'notes']
        for field in allowed_fields:
            if field in data:
                setattr(record, field, data[field])

        record.save()
        return Response({
            'success': True,
            'message': 'Attendance updated'
        })

    elif request.method == 'DELETE':
        record.delete()
        return Response({
            'success': True,
            'message': 'Attendance deleted'
        })


# Document Upload Views
@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def upload_documents(request):
    """Upload employee documents"""
    employee_id = request.POST.get('employee_id')
    username = request.POST.get('username')

    if not employee_id or not username:
        return Response({
            'success': False,
            'message': 'employee_id and username are required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(id=employee_id)
    except Employee.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Employee not found'
        }, status=status.HTTP_404_NOT_FOUND)

    MAX_PHOTO_SIZE = 2 * 1024 * 1024  # 2MB
    MAX_PDF_SIZE = 5 * 1024 * 1024  # 5MB

    saved_files = []
    upload_dir = os.path.join(settings.MEDIA_ROOT, 'uploads')
    os.makedirs(upload_dir, exist_ok=True)

    # Handle photo and signature
    image_docs = {
        'user_photo': 'photo',
        'user_signature': 'signature'
    }

    for input_name, doc_type in image_docs.items():
        if input_name in request.FILES:
            file = request.FILES[input_name]

            if file.size > MAX_PHOTO_SIZE:
                return Response({
                    'success': False,
                    'message': f'{doc_type.capitalize()} size exceeds 2MB limit'
                }, status=status.HTTP_400_BAD_REQUEST)

            if file.content_type not in ['image/jpeg', 'image/png', 'image/jpg']:
                continue

            ext = os.path.splitext(file.name)[1].lower()
            filename = f"{username}_{doc_type}{ext}"
            file_path = os.path.join(upload_dir, filename)

            # Delete old file
            EmployeeDocument.objects.filter(employee_id=employee_id, doc_type=doc_type).delete()

            # Save file
            with open(file_path, 'wb') as f:
                for chunk in file.chunks():
                    f.write(chunk)

            # Save to database
            EmployeeDocument.objects.create(
                employee_id=employee_id,
                doc_type=doc_type,
                doc_name=doc_type.capitalize(),
                file_name=filename,
                file_path=f'uploads/{filename}'
            )

            saved_files.append(filename)

    # Handle PDF documents
    pdf_docs = ['aadhar', 'pan', 'other_id', 'highest_qualification', 'professional_certificate', 'other_qualification']

    for doc_type in pdf_docs:
        file_key = f'file_{doc_type}'
        if file_key in request.FILES:
            file = request.FILES[file_key]

            if file.size > MAX_PDF_SIZE:
                return Response({
                    'success': False,
                    'message': f'{doc_type.capitalize()} file exceeds 5MB limit'
                }, status=status.HTTP_400_BAD_REQUEST)

            if file.content_type != 'application/pdf':
                continue

            filename = request.POST.get(f'{file_key}_filename', f"{username}_{doc_type}.pdf")
            filename = ''.join(c if c.isalnum() or c in '._-' else '_' for c in filename)
            file_path = os.path.join(upload_dir, filename)

            # Delete old file
            EmployeeDocument.objects.filter(employee_id=employee_id, doc_type=doc_type).delete()

            # Save file
            with open(file_path, 'wb') as f:
                for chunk in file.chunks():
                    f.write(chunk)

            # Save to database
            EmployeeDocument.objects.create(
                employee_id=employee_id,
                doc_type=doc_type,
                doc_name=doc_type.replace('_', ' ').title(),
                doc_number=request.POST.get(f'doc{doc_type.capitalize()}Number', ''),
                file_name=filename,
                file_path=f'uploads/{filename}'
            )

            saved_files.append(filename)

    if not saved_files:
        return Response({
            'success': False,
            'message': 'No valid documents uploaded'
        }, status=status.HTTP_400_BAD_REQUEST)

    return Response({
        'success': True,
        'uploaded': saved_files,
        'message': 'Documents uploaded successfully'
    })


@api_view(['POST'])
@parser_classes([JSONParser])
def delete_documents(request):
    """Delete selected documents"""
    data = request.data
    doc_ids = data.get('document_ids', [])

    if not doc_ids:
        return Response({
            'success': False,
            'message': 'No documents selected'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        documents = EmployeeDocument.objects.filter(id__in=doc_ids)

        # Delete files from disk
        for doc in documents:
            file_path = os.path.join(settings.MEDIA_ROOT, doc.file_path)
            if os.path.exists(file_path):
                os.remove(file_path)

        # Delete from database
        documents.delete()

        return Response({
            'success': True,
            'message': 'Documents deleted successfully'
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to delete documents'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def admin_user_docs_list(request, employee_id):
    """List documents for a user (admin)"""
    try:
        documents = EmployeeDocument.objects.filter(employee_id=employee_id).order_by('-uploaded_at')
        docs_data = []

        for doc in documents:
            docs_data.append({
                'id': doc.id,
                'doc_type': doc.doc_type,
                'doc_name': doc.doc_name,
                'file_name': doc.file_name,
                'file_path': doc.file_path,
                'url': request.build_absolute_uri('/media/' + doc.file_path) if doc.file_path.startswith('uploads/') else request.build_absolute_uri('/' + doc.file_path),
                'uploaded_at': doc.uploaded_at.isoformat() if doc.uploaded_at else None,
            })

        return Response({
            'success': True,
            'documents': docs_data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to load documents'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def admin_user_docs_zip(request, employee_id):
    """Download all documents as ZIP (admin)"""
    try:
        employee = Employee.objects.get(id=employee_id)
        documents = EmployeeDocument.objects.filter(employee_id=employee_id)

        if not documents.exists():
            return Response({
                'success': False,
                'message': 'No documents found'
            }, status=status.HTTP_404_NOT_FOUND)

        # Create ZIP file
        zip_name = f"{employee.username}_documents.zip"
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')

        with zipfile.ZipFile(temp_file.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for doc in documents:
                file_path = os.path.join(settings.MEDIA_ROOT, doc.file_path)
                if os.path.exists(file_path):
                    zipf.write(file_path, doc.file_name)

        # Return ZIP file
        response = FileResponse(
            open(temp_file.name, 'rb'),
            content_type='application/zip'
        )
        response['Content-Disposition'] = f'attachment; filename="{zip_name}"'
        return response

    except Employee.DoesNotExist:
        return Response({
            'success': False,
            'message': 'User not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to create ZIP'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Admin Dashboard API Views
@api_view(['GET'])
def admin_summary(request):
    """Get admin dashboard summary"""
    user_id = request.GET.get('user_id')
    user = Employee.objects.filter(id=user_id).first() if user_id else None
    is_manager = user and user.role == 'manager'

    try:
        today = date.today()

        employees_qs = Employee.objects.filter(is_active=True)
        records_qs = AttendanceRecord.objects.filter(date=today)
        
        if is_manager:
            employees_qs = employees_qs.filter(manager=user)
            records_qs = records_qs.filter(employee__manager=user)

        # Total employees
        total_employees = employees_qs.count()

        # Present today
        present_today = records_qs.filter(
            status__in=['present', 'half_day']
        ).count()

        # Surveyors present today
        surveyors_present = records_qs.filter(
            status__in=['present', 'half_day'],
            employee__department='Surveyors'
        ).count()

        # Absentees today
        absentees_today = records_qs.filter(
            status='absent'
        ).count()

        # On leave today
        on_leave_today = records_qs.filter(
            status='leave'
        ).count()

        # WFH today
        wfh_today = records_qs.filter(
            type='wfh'
        ).count()

        return Response({
            'success': True,
            'total_employees': total_employees,
            'present_today': present_today,
            'surveyors_present': surveyors_present,
            'absent_today': absentees_today,
            'on_leave': on_leave_today,
            'wfh_today': wfh_today
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch admin summary'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def predict_attendance(request):
    """Predict attendance for tomorrow based on historical patterns"""
    try:
        today = date.today()
        tomorrow = today + timedelta(days=1)

        # We look at historical data for the same day of week as tomorrow
        tomorrow_dow = tomorrow.weekday() # 0=Mon, 6=Sun

        # Total active employees
        total_employees = Employee.objects.filter(is_active=True).count()
        if total_employees == 0:
            return Response({'success': True, 'predicted_count': 0, 'confidence': 0, 'trend': 'stable'})

        # Get records for same DOW over last 4 weeks
        history_dates = [tomorrow - timedelta(weeks=i) for i in range(1, 5)]

        counts = []
        for h_date in history_dates:
            present_count = AttendanceRecord.objects.filter(
                date=h_date,
                status__in=['present', 'half_day', 'wfh', 'client']
            ).count()
            if present_count > 0 or AttendanceRecord.objects.filter(date=h_date).exists():
                counts.append(present_count)

        if not counts:
            # Fallback to general daily average if no DOW specific data
            all_recent = AttendanceRecord.objects.filter(
                date__gte=today - timedelta(days=30)
            ).values('date').annotate(count=Count('id', filter=Q(status__in=['present', 'half_day', 'wfh', 'client'])))

            counts = [item['count'] for item in all_recent]

        if not counts:
            return Response({
                'success': True,
                'predicted_count': round(total_employees * 0.8),
                'predicted_percent': 80,
                'confidence': 30,
                'trend': 'stable',
                'message': 'Insufficient data for accurate prediction'
            })

        avg_predicted = sum(counts) / len(counts)
        predicted_percent = (avg_predicted / total_employees) * 100 if total_employees > 0 else 0

        # Calculate Trend: Compare last 7 days vs previous 7 days
        last_7_days = today - timedelta(days=7)
        prev_7_days = today - timedelta(days=14)

        # Formula: Average = Total / Number of working days in a week
        # Over a 7-day period, we assume 5 working days
        current_avg = AttendanceRecord.objects.filter(
            date__gte=last_7_days,
            status__in=['present', 'half_day', 'wfh', 'client']
        ).count() / 5

        previous_avg = AttendanceRecord.objects.filter(
            date__gte=prev_7_days,
            date__lt=last_7_days,
            status__in=['present', 'half_day', 'wfh', 'client']
        ).count() / 5

        if current_avg > previous_avg * 1.05:
            trend = 'up'
        elif current_avg < previous_avg * 0.95:
            trend = 'down'
        else:
            trend = 'stable'

        # Get last 7 days of actual counts for visualization
        recent_history = []
        for i in range(7):
            d = today - timedelta(days=i)
            count = AttendanceRecord.objects.filter(
                date=d,
                status__in=['present', 'half_day', 'wfh', 'client']
            ).count()
            recent_history.append({
                'date': d.strftime('%Y-%m-%d'),
                'day': d.strftime('%a'),
                'count': count
            })
        recent_history.reverse()

        confidence = min(len(counts) * 20 + 20, 95) # Simple confidence score

        return Response({
            'success': True,
            'predicted_count': round(avg_predicted),
            'predicted_percent': round(predicted_percent, 1),
            'confidence': confidence,
            'trend': trend,
            'tomorrow_day': tomorrow.strftime('%A'),
            'recent_history': recent_history,
            'daily_average': round(current_avg, 1)
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def employee_performance_analysis(request, employee_id):
    """Detailed performance and prediction analysis for a single employee"""
    try:
        employee = Employee.objects.get(id=employee_id)
        today = date.today()
        
        # Filtering Logic
        view_type = request.GET.get('view_type', 'period') # period, month, week
        month_param = request.GET.get('month')
        year_param = request.GET.get('year')
        week_param = request.GET.get('week')
        
        is_monthly_view = False
        is_weekly_view = False
        
        if view_type == 'month':
            try:
                view_month = int(month_param) if month_param else today.month
                view_year = int(year_param) if year_param else today.year
                week_idx = request.GET.get('week_idx') # Optional: 1, 2, 3, 4, 5
                
                start_date = date(view_year, view_month, 1)
                if view_month == 12:
                    last_day = (date(view_year + 1, 1, 1) - timedelta(days=1)).day
                else:
                    last_day = (date(view_year, view_month + 1, 1) - timedelta(days=1)).day
                
                end_date = date(view_year, view_month, last_day)

                if week_idx and week_idx != 'all':
                    w = int(week_idx)
                    s_day = (w - 1) * 7 + 1
                    e_day = min(w * 7, last_day)
                    
                    if s_day <= last_day:
                        start_date = date(view_year, view_month, s_day)
                        end_date = date(view_year, view_month, e_day)
                
                is_monthly_view = True
            except (ValueError, TypeError):
                start_date = today - timedelta(days=30)
                end_date = today
        else:
            # Default: period (Last 30 Days)
            start_date = today - timedelta(days=30)
            end_date = today

        # Attendance History for filtered period
        records = AttendanceRecord.objects.filter(
            employee=employee,
            date__range=[start_date, end_date]
        ).order_by('-date')

        history = [{
            'date': r.date.strftime('%Y-%m-%d'),
            'status': r.status,
            'type': r.type,
            'hours': float(r.total_hours)
        } for r in records]

        # 2. Performance Metrics
        num_days = (end_date - start_date).days + 1
        num_weeks = max(num_days / 7.0, 0.1) # Avoid division by zero, min 0.1 weeks
        
        # Calculate Mon-Fri Avg
        weekday_records = records.filter(
            date__week_day__in=[2, 3, 4, 5, 6] # Mon-Fri (1=Sun, 2=Mon... 7=Sat)
        ).aggregate(
            sum_hours=Sum('total_hours')
        )
        # Fixed denominator logic as per user request: (num_weeks * 5)
        total_weekday_hours = float(weekday_records['sum_hours'] or 0)
        weekday_avg = total_weekday_hours / (num_weeks * 5)

        # Calculate Sat-Sun Avg
        weekend_records = records.filter(
            date__week_day__in=[1, 7] # Sun (1) and Sat (7)
        ).aggregate(
            sum_hours=Sum('total_hours')
        )
        # Fixed denominator logic as per user request: (num_weeks * 2)
        total_weekend_hours = float(weekend_records['sum_hours'] or 0)
        saturday_avg = total_weekend_hours / (num_weeks * 2)

        # Calculate Lunch Avg
        lunch_records = records.filter(
            lunch_start_time__isnull=False,
            lunch_end_time__isnull=False
        )
        total_lunch_minutes = 0
        lunch_count = 0
        for r in lunch_records:
            # Combine with dummy date to calculate delta
            t1 = datetime.combine(date.today(), r.lunch_start_time)
            t2 = datetime.combine(date.today(), r.lunch_end_time)
            if t2 > t1:
                total_lunch_minutes += (t2 - t1).total_seconds() / 60
                lunch_count += 1
        avg_lunch_min = total_lunch_minutes / (lunch_count or 1)

        summary_stats = records.aggregate(
            total_present=Count('id', filter=Q(status__in=['present', 'half_day', 'wfh', 'client'])),
            sum_hours=Sum('total_hours'),
            wfh_count=Count('id', filter=Q(type='wfh', status__in=['present', 'half_day', 'wfh', 'client'])),
            office_count=Count('id', filter=Q(type='office', status__in=['present', 'half_day', 'wfh', 'client']))
        )

        total_hours_sum = float(summary_stats['sum_hours'] or 0)
        
        # Handle weekly average calculation
        if is_monthly_view:
            weekly_avg_hours = total_hours_sum / 4.33
        elif is_weekly_view:
            weekly_avg_hours = total_hours_sum # Total for the week is the weekly average
        else:
            weekly_avg_hours = total_hours_sum / 4   

        # Forecast for tomorrow (always uses global patterns)
        tomorrow = date.today() + timedelta(days=1)
        tomorrow_dow = (tomorrow.weekday() + 1) % 7 + 1 
        habit_records = list(AttendanceRecord.objects.filter(
            employee=employee,
            date__week_day=tomorrow_dow
        ).order_by('-date')[:8]) 

        if habit_records:
            present_in_habit = len([r for r in habit_records if r.status in ['present', 'half_day', 'wfh', 'client']])
            prediction_score = (present_in_habit / len(habit_records)) * 100
        else:
            prediction_score = 85.0

        # Attendance Habits (Averages for filtered period)
        attendance_with_time = records.filter(check_in_time__isnull=False)
        
        avg_check_in = None
        avg_check_out = None
        
        if attendance_with_time.exists():
            in_seconds = []
            out_seconds = []
            for r in attendance_with_time:
                in_seconds.append(r.check_in_time.hour * 3600 + r.check_in_time.minute * 60 + r.check_in_time.second)
                if r.check_out_time:
                    out_seconds.append(r.check_out_time.hour * 3600 + r.check_out_time.minute * 60 + r.check_out_time.second)
            
            if in_seconds:
                avg_in_sec = sum(in_seconds) / len(in_seconds)
                avg_check_in = f"{int(avg_in_sec // 3600):02d}:{int((avg_in_sec % 3600) // 60):02d}"
            
            if out_seconds:
                avg_out_sec = sum(out_seconds) / len(out_seconds)
        avg_check_out = f"{int(avg_out_sec // 3600):02d}:{int((avg_out_sec % 3600) // 60):02d}"
        
        # Task Management Performance (for filtered period)
        tasks_base = Task.objects.filter(assignees=employee, created_at__date__range=[start_date, end_date]).distinct()
        completed_tasks = tasks_base.filter(status='completed')
        
        # New Advanced Accuracy Logic
        total_accuracy_points = 0
        tasks_evaluated = 0
        total_span_hours = 0
        spans_counted = 0

        for t in completed_tasks:
            task_score = 0
            
            # 1. Response Speed (Created to Started) - 30% Weight
            if t.started_at:
                response_delta = (t.started_at - t.created_at).total_seconds() / 3600
                if response_delta <= 2: task_score += 30
                elif response_delta <= 6: task_score += 25
                elif response_delta <= 12: task_score += 20
                elif response_delta <= 24: task_score += 15
                else: task_score += 5
            else:
                task_score += 10 # Default minimum

            # 2. Task Span (Started to Completed) - 35% Weight
            if t.started_at and t.completed_at:
                span_delta = (t.completed_at - t.started_at).total_seconds() / 3600
                total_span_hours += span_delta
                spans_counted += 1
                
                if span_delta <= 8: task_score += 35
                elif span_delta <= 24: task_score += 30
                elif span_delta <= 48: task_score += 25
                elif span_delta <= 72: task_score += 15
                else: task_score += 5
            else:
                task_score += 10

            # 3. Deadline Punctuality (Completed to Due Date) - 35% Weight
            if t.due_date and t.completed_at:
                # Treat due_date as end of day
                due_datetime = timezone.make_aware(datetime.combine(t.due_date, time(23, 59, 59)))
                days_diff = (due_datetime - t.completed_at).days
                
                if days_diff >= 2: task_score += 35 # Finished 2+ days early
                elif days_diff >= 1: task_score += 32 # Finished 1 day early
                elif days_diff == 0:
                    if t.completed_at <= due_datetime: task_score += 28 # Finished on due date
                    else: task_score += 15 # Slightly late
                elif days_diff == -1: task_score += 10 # 1 day late
                else: task_score += 0 # 2+ days late
            else:
                task_score += 20 # Neutral score if no due date set

            # Blend with manual manager accuracy if it exists (50/50 balance)
            if t.accuracy:
                task_score = (task_score + t.accuracy) / 2

            total_accuracy_points += task_score
            tasks_evaluated += 1

        avg_accuracy = total_accuracy_points / (tasks_evaluated or 1)
        avg_span_h = total_span_hours / (spans_counted or 1)

        task_stats = {
            'total_assigned': tasks_base.count(),
            'todo': tasks_base.filter(status='todo').count(),
            'in_progress': tasks_base.filter(status='in_progress').count(),
            'completed': completed_tasks.count(),
            'avg_accuracy': round(float(avg_accuracy), 1),
            'avg_span_hours': round(float(avg_span_h), 1)
        }

        # Calculate Regular vs Overtime Hours (Standard 8h)
        total_reg_h = 0
        total_ot_h = 0
        for r in records:
            h = float(r.total_hours or 0)
            reg = min(h, 8.0)
            ot = max(0.0, h - 8.0)
            total_reg_h += reg
            total_ot_h += ot
        
        total_all_h = total_reg_h + total_ot_h
        ot_ratio = round((total_ot_h / total_all_h) * 100, 1) if total_all_h > 0 else 0
        reg_ratio = round((total_reg_h / total_all_h) * 100, 1) if total_all_h > 0 else 0

        return Response({
            'success': True,
            'employee_name': employee.name,
            'department': employee.department,
            'email': employee.email,
            'history': history,
            'filter': {
                'start_date': str(start_date),
                'end_date': str(end_date),
                'month': start_date.month if is_monthly_view else None,
                'year': start_date.year if is_monthly_view else None,
                'week_idx': request.GET.get('week_idx', 'all'),
                'view_type': view_type
            },
            'metrics': {
                'total_present': summary_stats['total_present'] or 0,
                'avg_hours_present': round(total_hours_sum / (summary_stats['total_present'] or 1), 1),
                'weekday_avg': round(weekday_avg, 1),
                'saturday_avg': round(saturday_avg, 1),
                'avg_lunch_min': round(avg_lunch_min, 0),
                'wfh_ratio': round((summary_stats['wfh_count'] / (summary_stats['total_present'] or 1)) * 100, 1) if summary_stats['total_present'] else 0,
                'office_ratio': round((summary_stats['office_count'] / (summary_stats['total_present'] or 1)) * 100, 1) if summary_stats['total_present'] else 0,
                'ot_ratio': ot_ratio,
                'reg_ratio': reg_ratio,
                'total_reg_h': round(total_reg_h, 1),
                'total_ot_h': round(total_ot_h, 1),
                'weekly_avg_hours': round(weekly_avg_hours, 1),
                'avg_check_in': avg_check_in,
                'avg_check_out': avg_check_out
            },
            'tasks': task_stats,
            'prediction': {
                'likelihood': round(prediction_score, 1),
                'tomorrow_day': tomorrow.strftime('%A'),
                'habit_summary': f"Usually present on {tomorrow.strftime('%A')}s" if prediction_score > 70 else f"Irregular pattern on {tomorrow.strftime('%A')}s"
            }
        })
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def upcoming_birthdays(request):
    """Get upcoming birthdays for filtered month"""
    try:
        today = date.today()

        try:
            current_month = int(request.GET.get('month', today.month))
            current_year = int(request.GET.get('year', today.year))
        except ValueError:
            current_month = today.month
            current_year = today.year

        # Get employees with birthdays in filtered month
        employees_with_birthdays = EmployeeProfile.objects.filter(
            date_of_birth__month=current_month,
            employee__is_active=True
        ).select_related('employee').order_by('date_of_birth')

        birthdays = []
        for profile in employees_with_birthdays:
            if profile.date_of_birth:
                birth_date = profile.date_of_birth
                # Calculate age based on the viewed year
                age = current_year - birth_date.year
                # If we are viewing a past month in the current year, or future, just straightforward subtraction
                # However, traditionally age is "upcoming age" for that birthday.
                # So if birthday is in that year, the age they turn is year - birth_year.

                # Calculate days until birthday (relative to today, for sorting/urgency)
                # Ensure we construct the date for the viewed year
                try:
                    birthday_on_viewed_year = birth_date.replace(year=current_year)
                except ValueError:
                    # Handle Feb 29 on non-leap years
                    birthday_on_viewed_year = birth_date.replace(year=current_year, day=28)

                days_until = (birthday_on_viewed_year - today).days

                birthdays.append({
                    'id': profile.employee.id,
                    'name': profile.employee.name,
                    'username': profile.employee.username,
                    'department': profile.employee.department,
                    'date_of_birth': str(birth_date),
                    'age': age,
                    'days_until': days_until
                })

        # Sort by day of month
        birthdays.sort(key=lambda x: x['date_of_birth'].split('-')[2])  # Simple sort by day

        return Response({
            'success': True,
            'count': len(birthdays),
            'birthdays': birthdays
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch upcoming birthdays'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@parser_classes([JSONParser])
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

    # 1. Birthday notifications (today's birthdays)
    today = timezone.now().date()
    birthdays_today = EmployeeProfile.objects.filter(
        date_of_birth__month=today.month,
        date_of_birth__day=today.day,
        employee__is_active=True
    ).select_related('employee').exclude(employee_id=user_id)

    for profile in birthdays_today:
        notifications.append({
            'type': 'birthday',
            'icon': '🎂',
            'message': f"Today is {profile.employee.name}'s birthday!",
            'time': 'Today',
            'id': f'birthday_{profile.employee.id}'
        })

    # 2. Task assignments
    try:
        pending_tasks = Task.objects.filter(
            Q(assignees=user_id),
            status='todo'
        ).distinct().order_by('-created_at')[:5]
    except Exception:
        pending_tasks = Task.objects.filter(
            assignees=user_id,
            status='todo'
        ).distinct().order_by('-created_at')[:5]
    

    for task in pending_tasks:
        notifications.append({
            'type': 'task',
            'icon': '📝',
            'message': f'New task assigned: {task.title}',
            'time': task.created_at.strftime('%I:%M %p') if task.created_at else 'Unknown',
            'id': f'task_{task.id}'
        })

    # 3. Pending requests (for admins)
    if user.role == 'admin':
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

    return Response({
        'success': True,
        'notifications': notifications,
        'unread_count': len(notifications)
    })

@api_view(['POST'])
@parser_classes([JSONParser])
def mark_notifications_read(request):
    """Mark all notifications or a specific one as read"""
    user_id = request.data.get('user_id')
    notification_id = request.data.get('notification_id') # Optional: if we want to mark specific

    if not user_id:
        return Response({'success': False, 'message': 'User ID required'}, status=status.HTTP_400_BAD_REQUEST)

    # Currently we only have BirthdayWishes that need persistence
    wishes = BirthdayWish.objects.filter(receiver_id=user_id, is_read=False)
    if notification_id and notification_id.startswith('wish_'):
        wish_id = notification_id.replace('wish_', '')
        wishes = wishes.filter(id=wish_id)

    wishes.update(is_read=True)

    return Response({'success': True, 'message': 'Notifications marked as read'})


@api_view(['POST'])
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



@api_view(['GET'])
def pending_requests(request):
    """Get pending or history (approved/rejected) WFH and leave requests"""
    user_id = request.GET.get('user_id')
    user = Employee.objects.filter(id=user_id).first() if user_id else None
    is_manager = user and user.role == 'manager'

    try:
        status_param = request.GET.get('status', 'pending')
        
        if status_param == 'history':
            # Get approved and rejected requests
            requests_obj = EmployeeRequest.objects.filter(
                status__in=['approved', 'rejected']
            ).select_related('employee').order_by('-start_date')
        else:
            # Get pending requests
            requests_obj = EmployeeRequest.objects.filter(
                status='pending'
            ).select_related('employee').order_by('start_date')

        if is_manager:
            requests_obj = requests_obj.filter(employee__manager=user)

        requests_data = []
        for req in requests_obj:
            requests_data.append({
                'id': req.id,
                'employee_id': req.employee.id,
                'employee_name': req.employee.name,
                'username': req.employee.username,
                'type': req.request_type,
                'date': str(req.start_date), # Frontend uses this key currently
                'start_date': str(req.start_date),
                'end_date': str(req.end_date),
                'reason': req.reason,
                'status': req.status,
                'created_at': req.created_at.isoformat()
            })

        return Response({
            'success': True,
            'count': len(requests_data),
            'requests': requests_data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch pending requests'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



@api_view(['GET'])
def my_requests(request):
    """Get request history for an employee"""
    try:
        employee_id = request.GET.get('employee_id')
        if not employee_id:
            return Response({
                'success': False,
                'message': 'Employee ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Get all requests for employee
        requests_obj = EmployeeRequest.objects.filter(
            employee_id=employee_id
        ).order_by('-created_at')

        requests_data = []
        for req in requests_obj:
            requests_data.append({
                'id': req.id,
                'type': req.request_type,
                'start_date': str(req.start_date),
                'end_date': str(req.end_date),
                'reason': req.reason,
                'status': req.status,
                'admin_response': req.admin_response,
                'created_at': req.created_at.isoformat()
            })

        return Response({
            'success': True,
            'count': len(requests_data),
            'requests': requests_data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch request history'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def active_tasks(request):
    """Get count of active tasks"""
    try:
        employee_id = request.GET.get('employee_id')
        query = Task.objects.filter(status__in=['todo', 'in_progress'])

        if employee_id:
            try:
                emp = Employee.objects.get(id=employee_id)
                if emp.role.lower() == 'manager':
                    query = query.filter(Q(assignees__manager=emp) | Q(manager=emp) | Q(created_by=emp) | Q(assignees=emp)).distinct()
                elif emp.role.lower() != 'admin':
                    try:
                        query = query.filter(Q(assignees=emp) | Q(manager=emp)).distinct()
                    except Exception:
                        query = query.filter(Q(assignees=emp) | Q(manager=emp)).distinct()
            except Employee.DoesNotExist:
                pass # Or return 0

        active_count = query.count()

        return Response({
            'success': True,
            'count': active_count
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch active tasks count'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _get_admin_task_manager_data():
    """Helper: Get all tasks for Admin Task Manager"""
    tasks = Task.objects.select_related('created_by', 'manager').prefetch_related('assignees').order_by('-created_at')
    return _serialize_tasks(tasks)

def _get_employee_my_tasks_data(employee):
    """Helper: Get assigned tasks + overseen tasks for Employee My Tasks"""
    tasks = Task.objects.filter(
        Q(assignees=employee) | Q(manager=employee)
    ).distinct().select_related('created_by', 'manager').prefetch_related('assignees').order_by('-created_at')
    return _serialize_tasks(tasks)

def _get_manager_employees_tasks_data(manager):
    """Helper: Get tasks for employees reporting to this manager + tasks explicitly managed by them"""
    tasks = Task.objects.filter(
        Q(assignees__manager=manager) | Q(manager=manager)
    ).distinct().select_related('created_by', 'manager').prefetch_related('assignees').order_by('-created_at')
    return _serialize_tasks(tasks)

def _serialize_tasks(tasks):
    """Helper: Serialize task list with comments"""
    data = []
    for task in tasks:
        # Get comments for each task
        comments = []
        for comment in task.comments.all().select_related('author'):
            comments.append({
                'id': comment.id,
                'author_name': comment.author.name,
                'content': comment.content,
                'created_at': comment.created_at.isoformat()
            })

        # Get all assignees
        assignees_info = []
        for assignee in task.assignees.all():
            assignees_info.append({
                'id': assignee.id,
                'name': assignee.name
            })

        data.append({
            'id': task.id,
            'title': task.title,
            'description': task.description,
            'status': task.status,
            'priority': task.priority,
            'assignees': assignees_info,
            'manager_id': task.manager.id if task.manager else None,
            'manager_name': task.manager.name if task.manager else None,
            'created_by': task.created_by.id,
            'created_by_name': task.created_by.name,
            'due_date': str(task.due_date) if task.due_date else None,
            'created_at': task.created_at.isoformat(),
            'updated_at': task.updated_at.isoformat(),
            'comments': comments
        })
    return data

def _create_task_admin(data, creator):
    """Helper: Admin creates a task"""
    required_fields = ['title'] # assignees handled below
    for field in required_fields:
        if not data.get(field):
            raise ValueError(f'{field} is required')

    assigned_input = data.get('assignees') or data.get('assigned_to')
    assigned_ids = assigned_input if isinstance(assigned_input, list) else [assigned_input] if assigned_input else []
    
    manager_id = data.get('manager_id')
    manager_employee = None
    if manager_id and manager_id != 'none':
        manager_employee = Employee.objects.get(id=manager_id)

    task = Task.objects.create(
        title=data['title'],
        description=data.get('description', ''),
        status=data.get('status', 'todo'),
        priority=data.get('priority', 'medium'),
        manager=manager_employee,
        created_by=creator,
        due_date=data.get('due_date')
    )
    
    task.assignees.set(Employee.objects.filter(id__in=assigned_ids))
    return task

@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def tasks_api(request):
    """Get all tasks or create a new task (Separated Admin/Employee Logic)"""
    if request.method == 'GET':
        try:
            employee_id = request.GET.get('employee_id')

            if not employee_id:
                # Security default
                return Response({'success': True, 'tasks': []})

            try:
                emp = Employee.objects.get(id=employee_id)

                if emp.role == 'admin':
                    # ADMIN PATH
                    tasks_data = _get_admin_task_manager_data()
                elif emp.role == 'manager':
                    # MANAGER PATH - Sees their own tasks + their employees' tasks
                    own_tasks = _get_employee_my_tasks_data(emp)
                    subordinate_tasks = _get_manager_employees_tasks_data(emp)
                    # Merge and remove duplicates if any (though shouldn't be)
                    tasks_data = own_tasks + [t for t in subordinate_tasks if t['id'] not in [ot['id'] for ot in own_tasks]]
                else:
                    # EMPLOYEE PATH
                    tasks_data = _get_employee_my_tasks_data(emp)

                return Response({
                    'success': True,
                    'tasks': tasks_data
                })

            except Employee.DoesNotExist:
                return Response({'success': True, 'tasks': []})

        except Exception as e:
            return Response({
                'success': False,
                'message': 'Failed to fetch tasks'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    elif request.method == 'POST':
        try:
            data = request.data
            creator_id = data.get('created_by')

            # Identify creator
            if creator_id:
                creator = Employee.objects.get(id=creator_id)
            else:
                creator = Employee.objects.filter(role='admin').first()
                if not creator:
                    return Response({'success': False, 'message': 'No creator found'}, status=status.HTTP_400_BAD_REQUEST)

            # Dispatch creation logic
            if creator.role == 'admin':
                task = _create_task_admin(data, creator)
            else:
                # Re-use admin logic for now as employee creation wasn't strictly defined different yet, 
                # but valid separation point.
                task = _create_task_admin(data, creator) 

            return Response({
                'success': True,
                'message': 'Task created successfully',
                'task_id': task.id
            })

        except ValueError as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'Assigned employee or manager not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            # More helpful error for debugging
            return Response({
                'success': False,
                'message': f'Failed to create task: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _update_task_admin(task, data, user=None):
    """Helper: Admin/Overseer/Reporting Manager updates task details"""
    user_role = str(user.role).lower() if user else 'none'
    is_admin = user_role == 'admin'
    is_overseer = task.manager and user and task.manager.id == user.id
    
    # Manager check: user manages at least one of the assignees
    is_reporting_manager = False
    if user:
        is_reporting_manager = task.assignees.filter(manager=user).exists()

    if task.status == 'completed' and not (is_admin or is_overseer or is_reporting_manager):
        # We allow Admins and the Overseer to bypass this for correction/reopening
        raise ValueError(f"Cannot modify a completed task.")

    if 'status' in data:
        new_status = data['status']
        if new_status == 'in_progress' and not task.started_at:
            task.started_at = timezone.now()
        elif new_status == 'completed' and not task.completed_at:
            task.completed_at = timezone.now()
        task.status = new_status
    if 'priority' in data:
        task.priority = data['priority']
    if 'title' in data:
        task.title = data['title']
    if 'description' in data:
        task.description = data['description']
    if 'due_date' in data:
        task.due_date = data['due_date']
        
    if 'assignees' in data or 'assigned_to' in data:
        assigned_input = data.get('assignees') or data.get('assigned_to')
        assigned_ids = assigned_input if isinstance(assigned_input, list) else [assigned_input] if assigned_input else []
        task.assignees.set(Employee.objects.filter(id__in=assigned_ids))

    if 'manager_id' in data:
        if data['manager_id'] == 'none':
            task.manager = None
        else:
            try:
                manager_emp = Employee.objects.get(id=data['manager_id'])
                task.manager = manager_emp
            except:
                pass
    task.save()
    return True

def _update_task_employee(task, data, user=None):
    """Helper: Employee updates task (limited access - mostly status)"""
    user_role = str(user.role).lower() if user else 'none'
    # Employee typically only updates status or adds comments (comments not implemented yet)
    if task.status == 'completed' and user_role != 'admin':
        # STRICTLY BLOCK for generic updates
        # Exception: If user is trying to reopen? "it can't be changed" implies NO.
        # Exception: If user is trying to reopen? "it can't be changed" implies NO.
        # return False - REMOVED to allow raising exception
        raise ValueError(f"Cannot modify a completed task (ReqID: {user.id if user else '?'})")

    if 'status' in data:
        new_status = data['status']
        if new_status == 'in_progress' and not task.started_at:
            task.started_at = timezone.now()
        elif new_status == 'completed' and not task.completed_at:
            task.completed_at = timezone.now()
        task.status = new_status

    # Employee cannot change title, description, priority, etc. in strict mode
    # But if original UI allowed it, we might need to support it. 
    # User said "My Task totally different", implies restricted flow.
    # We will restrict to Status updates for now as per best practice for "My Tasks".

    task.save()
    return True

@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def task_detail_api(request, task_id):
    """Update, delete or fetch a task (Separated Admin/Employee Logic)"""
    try:
        task = Task.objects.prefetch_related('assignees').select_related('manager').get(id=task_id)
    except Task.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Task not found'
        }, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        # Serialize task using existing helper
        task_data = _serialize_tasks([task])[0]
        return Response({
            'success': True,
            'task': task_data
        })

    data = request.data
    requesting_user_id = data.get('user_id') # Must be passed from frontend

    if not requesting_user_id:
        return Response({'success': False, 'message': 'User verification required'}, status=status.HTTP_403_FORBIDDEN)

    try:
        requesting_user = Employee.objects.get(id=requesting_user_id)

        # Check permissions and dispatch
        if request.method == 'POST':
            # Check for DELETE method simulation
            if data.get('_method') == 'DELETE':
                if requesting_user.role != 'admin': # Only Admin deletes
                    return Response({'success': False, 'message': 'Only Admin can delete tasks'}, status=status.HTTP_403_FORBIDDEN)

                task.delete()
                return Response({'success': True, 'message': 'Task deleted'})

            # Update Logic
            role = str(requesting_user.role).lower()
            is_assignee = task.assignees.filter(id=requesting_user.id).exists()
            is_manager_of_assignee = task.assignees.filter(manager=requesting_user).exists()

            if role == 'admin':
                _update_task_admin(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Admin)'})

            elif task.manager and task.manager.id == requesting_user.id:
                # Task Overseer can also perform full updates
                _update_task_admin(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Overseer)'})

            elif is_manager_of_assignee:
                # Assignee's Reporting Manager can also perform full updates
                _update_task_admin(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Manager)'})

            elif is_assignee:
                _update_task_employee(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Employee)'})

            else:
                return Response({'success': False, 'message': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)

    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'User not found'}, status=status.HTTP_403_FORBIDDEN)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@parser_classes([JSONParser])
def task_comment_api(request):
    """Add a comment to a task"""
    data = request.data
    task_id = data.get('task_id')
    author_id = data.get('author_id')
    content = data.get('content')

    if not all([task_id, author_id, content]):
        return Response({
            'success': False,
            'message': 'task_id, author_id, and content are required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        task = Task.objects.prefetch_related('assignees').select_related('manager').get(id=task_id)
        author = Employee.objects.get(id=author_id)

        # Updated permission checks for hybrid assignment
        is_assignee = task.assignees.filter(id=author.id).exists()
        is_manager_of_assignee = task.assignees.filter(manager=author).exists()

        can_comment = False
        role = str(author.role).lower()
        if role == 'admin':
            can_comment = True
        elif task.manager and task.manager.id == author.id:
            can_comment = True
        elif is_assignee:
            can_comment = True
        elif is_manager_of_assignee:
            can_comment = True

        if not can_comment:
            return Response({
                'success': False,
                'message': 'You do not have permission to comment on this task'
            }, status=status.HTTP_403_FORBIDDEN)

        comment = TaskComment.objects.create(
            task=task,
            author=author,
            content=content
        )

        return Response({
            'success': True,
            'message': 'Comment added successfully',
            'comment': {
                'id': comment.id,
                'author_name': author.name,
                'content': comment.content,
                'created_at': comment.created_at.isoformat()
            }
        })

    except Task.DoesNotExist:
        return Response({'success': False, 'message': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Author not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)





@api_view(['POST'])
@parser_classes([JSONParser])
def wfh_request_reject(request):
    """Reject WFH request"""
    data = request.data
    request_id = data.get('request_id')
    reason = data.get('reason', '')

    if not request_id:
        return Response({
            'success': False,
            'message': 'Request ID is required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        wfh_request = WFHRequest.objects.get(id=request_id)
        wfh_request.status = 'rejected'
        wfh_request.admin_response = reason
        wfh_request.reviewed_at = timezone.now()
        # Set reviewed_by to admin user
        admin_user = Employee.objects.filter(role='admin').first()
        if admin_user:
            wfh_request.reviewed_by = admin_user
        wfh_request.save()

        return Response({
            'success': True,
            'message': 'WFH request rejected'
        })
    except WFHRequest.DoesNotExist:
        return Response({
            'success': False,
            'message': 'WFH request not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to reject request'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET'])
def employees_simple_list(request):
    """Get simple list of employees for dropdowns"""
    try:
        employees = Employee.objects.filter(is_active=True).values('id', 'name', 'role', 'manager_id').order_by('name')
        return Response({
            'success': True,
            'employees': list(employees)
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch employees'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@parser_classes([JSONParser])
def wfh_request_approve(request):
    """Approve or reject a Request (WFH or Leave)"""
    try:
        data = request.data
        request_id = data.get('request_id')
        status_val = data.get('status', 'approved')
        admin_response = data.get('admin_response', '')
        reviewer_id = data.get('reviewed_by') 

        try:
            request_obj = EmployeeRequest.objects.get(id=request_id)
        except EmployeeRequest.DoesNotExist:
            return Response({'success': False, 'message': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

        request_obj.status = status_val
        request_obj.admin_response = admin_response
        request_obj.reviewed_at = timezone.now()

        if reviewer_id:
            try:
                request_obj.reviewed_by = Employee.objects.get(id=reviewer_id)
            except:
                pass

        if not request_obj.reviewed_by:
            admin_user = Employee.objects.filter(role='admin').first()
            if admin_user:
                request_obj.reviewed_by = admin_user

        request_obj.save()

        # If approved, handle based on request type
        if status_val == 'approved':
            # Determine the status to set based on request type
            req_type = request_obj.request_type
            
            # WFH requests should NOT auto-create attendance records.
            # The employee must manually check-in using the WFH button.
            if req_type == 'wfh':
                # Do nothing here. The 'check_wfh_eligibility' will now return True,
                # allowing the user to mark attendance themselves.
                pass 
            else:
                # For leaves (full/half day), we generally DO want to auto-mark 
                # because the employee isn't working.
                if req_type == 'full_day':
                    attendance_status = 'leave'
                    attendance_type = 'office' # doesn't matter much
                    is_half = False
                elif req_type == 'half_day':
                    attendance_status = 'half_day'
                    attendance_type = 'office' 
                    is_half = True
                else:
                    attendance_status = 'leave'
                    attendance_type = 'office'
                    is_half = False

                # Create or update attendance record for each day in the request date range
                from datetime import timedelta
                current_date = request_obj.start_date
                while current_date <= request_obj.end_date:
                    defaults = {
                        'type': attendance_type,
                        'status': attendance_status,
                        'is_half_day': is_half,
                        'notes': f'Approved request ({req_type})',
                    }
                    
                    AttendanceRecord.objects.update_or_create(
                        employee=request_obj.employee,
                        date=current_date,
                        defaults=defaults
                    )
                    current_date += timedelta(days=1)

        return Response({
            'success': True,
            'message': f'Request {status_val}'
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@parser_classes([JSONParser])
def leave_request(request):
    """Create a new leave request (Full Day or Half Day)"""
    try:
        data = request.data
        employee_id = data.get('employee_id')
        date_str = data.get('date')
        dates_list = data.get('dates', []) # New:支持列表
        r_type = data.get('type') # 'full_day', 'half_day', 'wfh'
        reason = data.get('reason')
        period = data.get('period') # 'first_half', 'second_half'

        if not employee_id or not r_type:
            return Response({'success': False, 'message': 'Missing fields'}, status=status.HTTP_400_BAD_REQUEST)

        # Build list of dates to process
        target_dates = []
        if dates_list:
            target_dates = dates_list
        elif date_str:
            target_dates = [date_str]
        else:
            return Response({'success': False, 'message': 'Date(s) required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)

        created_count = 0
        skipped_count = 0

        for d_str in target_dates:
            try:
                req_date = datetime.strptime(d_str, '%Y-%m-%d').date()
                
                # Check existing
                existing = EmployeeRequest.objects.filter(employee=employee, start_date=req_date).first()
                if existing:
                    skipped_count += 1
                    continue

                EmployeeRequest.objects.create(
                    employee=employee,
                    request_type=r_type,
                    start_date=req_date,
                    end_date=req_date,
                    reason=reason,
                    status='pending',
                    half_day_period=period if r_type == 'half_day' else None
                )
                created_count += 1
            except Exception:
                skipped_count += 1

        if created_count == 0 and skipped_count > 0:
            return Response({'success': False, 'message': 'Requests already exist for selected date(s)'}, status=status.HTTP_400_BAD_REQUEST)
        
        return Response({
            'success': True, 
            'message': f'Submitted {created_count} request(s). {skipped_count} skipped.',
            'created_count': created_count,
            'skipped_count': skipped_count
        })
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@parser_classes([JSONParser])
def leave_request_approve(request):
    """Approve or reject a leave request"""
    try:
        data = request.data
        request_id = data.get('request_id')
        status_val = data.get('status', 'approved') # approved or rejected
        admin_response = data.get('admin_response', '')

        try:
            req = EmployeeRequest.objects.get(id=request_id)
        except EmployeeRequest.DoesNotExist:
            return Response({'success': False, 'message': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

        req.status = status_val
        req.admin_response = admin_response
        req.reviewed_at = timezone.now()
        req.save()

        # If approved, create or update AttendanceRecord to reflect in calendar
        if status_val == 'approved':
            # Determine the status to set based on request type
            req_type = req.request_type
            if req_type == 'wfh':
                attendance_status = 'wfh'
                attendance_type = 'wfh'
            elif req_type == 'full_day':
                attendance_status = 'leave'  # Full day leave shows as leave
                attendance_type = 'office'
            elif req_type == 'half_day':
                attendance_status = 'half_day'
                attendance_type = 'office'
            else:
                attendance_status = 'leave'
                attendance_type = 'office'

            # Create or update attendance record for each day in the request date range
            from datetime import timedelta
            current_date = req.start_date
            while current_date <= req.end_date:
                AttendanceRecord.objects.update_or_create(
                    employee=req.employee,
                    date=current_date,
                    defaults={
                        'type': attendance_type,
                        'status': attendance_status,
                        'is_half_day': (req_type == 'half_day'),
                        'notes': f'Approved {req_type} request',
                    }
                )
                current_date += timedelta(days=1)

        return Response({'success': True, 'message': f'Request {status_val}'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



@api_view(['GET'])
def attendance_predictions(request):
    """Get AI-powered attendance predictions for all employees (Admin only)"""
    try:
        # Check if user is admin
        employee_id = request.GET.get('employee_id')
        if not employee_id:
            return Response({
                'success': False,
                'message': 'Employee ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            employee = Employee.objects.get(id=employee_id)
            if employee.role != 'admin':
                return Response({
                    'success': False,
                    'message': 'Unauthorized. Admin access required.'
                }, status=status.HTTP_403_FORBIDDEN)
        except Employee.DoesNotExist:
            return Response({
                'success': False,
                'message': 'Employee not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Import prediction engine
        from .attendance_prediction import get_all_employees_predictions
        
        # Get predictions for all employees
        predictions = get_all_employees_predictions()
        
        return Response({
            'success': True,
            'count': len(predictions),
            'predictions': predictions
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({
            'success': False,
            'message': f'Failed to generate predictions: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ========== Intelligence Hub API Endpoints ==========

@api_view(['GET'])
def intelligence_hub_forecast(request):
    """Get current attendance forecast with confidence and trend"""
    try:
        from .intelligence_hub import calculate_forecast, get_current_day_name, load_model_state
        
        forecast, confidence, trend = calculate_forecast()
        day_name = get_current_day_name()
        model_state = load_model_state()
        
        return Response({
            'success': True,
            'forecast': {
                'percentage': forecast,
                'confidence': confidence,
                'trend': trend,
                'day_name': day_name,
                'subtitle': f"{day_name}'s Forecast",
                'model_state': model_state
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({
            'success': False,
            'message': f'Failed to calculate forecast: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def intelligence_hub_trends(request):
    """Get 30-day trend data with comprehensive company overview"""
    try:
        from .intelligence_hub import get_company_overview
        
        days = int(request.GET.get('days', 30))
        overview_data = get_company_overview(days)
        
        return Response({
            'success': True,
            **overview_data  # Unpacks summary, departments, employees, trends
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({
            'success': False,
            'message': f'Failed to get trend data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@parser_classes([JSONParser])
def intelligence_hub_search(request):
    """Search personnel with attendance predictions"""
    try:
        from .intelligence_hub import search_personnel
        
        data = request.data
        query = data.get('query')
        department = data.get('department')
        min_attendance = data.get('min_attendance')
        max_attendance = data.get('max_attendance')
        
        results = search_personnel(query, department, min_attendance, max_attendance)
        
        return Response({
            'success': True,
            'count': len(results),
            'results': results
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({
            'success': False,
            'message': f'Failed to search personnel: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def intelligence_hub_train(request):
    """Trigger training of the forecast model using all historical data"""
    try:
        from .intelligence_hub import train_forecast_model
        
        user_id = request.data.get('user_id')
        user = Employee.objects.filter(id=user_id).first()
        
        result = train_forecast_model()
        
        if result['success']:
            # Create a localized log entry
            summary = result['summary']
            TrainingLog.objects.create(
                trained_by=user,
                data_points=summary.get('data_points', 0),
                average_rate=summary.get('average_rate', 0.0),
                stability_factor=summary.get('stability_factor', 0.0),
                logs=result.get('logs', []),
                summary=summary
            )
            
            return Response({
                'success': True,
                'message': 'Model trained successfully',
                'summary': summary,
                'logs': result.get('logs', [])
            })
        else:
            return Response({
                'success': False,
                'message': result['message'],
                'logs': result.get('logs', [])
            }, status=status.HTTP_400_BAD_REQUEST)
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({
            'success': False,
            'message': f'Training failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def intelligence_hub_training_history(request):
    """Fetch recent model training history"""
    try:
        logs = TrainingLog.objects.all().select_related('trained_by')[:10]
        data = [{
            'id': log.id,
            'timestamp': log.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'trained_by_name': log.trained_by.name if log.trained_by else 'System',
            'data_points': log.data_points,
            'average_rate': log.average_rate,
            'stability_factor': log.stability_factor,
            'summary': log.summary
        } for log in logs]
        
        return Response({
            'success': True,
            'history': data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Failed to fetch history: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET', 'POST', 'DELETE'])
@parser_classes([JSONParser])
def temporary_tags_api(request):
    """API for managing temporary tags"""
    print(f"DEBUG: temporary_tags_api method={request.method}")
    if request.method == 'GET':
        employee_id = request.query_params.get('employee_id')
        tags = TemporaryTag.objects.all().select_related('employee')
        if employee_id:
            tags = tags.filter(employee_id=employee_id)
        
        tags_data = [{
            'id': tag.id,
            'employee_id': tag.employee.id,
            'employee_username': tag.employee.username,
            'employee_name': tag.employee.name,
            'department': tag.department,
            'role': tag.role,
            'start_date': str(tag.start_date),
            'end_date': str(tag.end_date),
            'created_at': tag.created_at.isoformat(),
        } for tag in tags.order_by('-created_at')]
        
        return Response({'success': True, 'tags': tags_data})

    elif request.method == 'POST':
        data = request.data
        print(f"DEBUG: temporary_tags_api POST data={data}")
        try:
            employee_id = data.get('employee_id')
            department = data.get('department')
            role = data.get('role')
            start_date = data.get('start_date')
            end_date = data.get('end_date')
            
            print(f"DEBUG: Creating tag for employee_id={employee_id}, dept={department}, role={role}, range={start_date} to {end_date}")
            
            employee = Employee.objects.get(id=employee_id)
            tag = TemporaryTag.objects.create(
                employee=employee,
                department=data.get('department'),
                role=data.get('role'),
                start_date=data.get('start_date'),
                end_date=data.get('end_date')
            )
            return Response({
                'success': True,
                'message': 'Temporary tag created successfully',
                'tag_id': tag.id
            })
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'Employee not found'}, status=404)
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=400)

    elif request.method == 'DELETE':
        tag_id = request.query_params.get('id') or request.data.get('id')
        try:
            tag = TemporaryTag.objects.get(id=tag_id)
            tag.delete()
            return Response({'success': True, 'message': 'Temporary tag deleted successfully'})
        except TemporaryTag.DoesNotExist:
            return Response({'success': False, 'message': 'Tag not found'}, status=404)
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=400)


@api_view(['POST'])
@parser_classes([JSONParser])
def verify_token(request):
    """Verify attendance token from portal"""
    token = request.data.get('token')
    if not token:
        return Response({
            'success': False,
            'message': 'Token is required'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Use ATTENDANCE_SECRET_KEY to generate expected token
    secret = getattr(settings, "ATTENDANCE_SECRET_KEY", "hanuai-attendance-secret-shared-key").encode()
    # Use current date as the messenger factor (YYYY-MM-DD)
    message = datetime.now().strftime("%Y-%m-%d").encode()
    
    # Create HMAC hash
    expected_signature = hmac.new(secret, message, hashlib.sha256).hexdigest()
    
    if hmac.compare_digest(token, expected_signature):
        return Response({
            'success': True,
            'message': 'Token verified'
        })
    else:
        return Response({
            'success': False,
            'message': 'Invalid token'
        }, status=status.HTTP_401_UNAUTHORIZED)

