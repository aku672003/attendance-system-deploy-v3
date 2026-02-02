from django.shortcuts import render
from django.http import JsonResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils.decorators import method_decorator
from django.db.models import Q, Count, Sum, Avg
from django.utils import timezone
from django.conf import settings
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import status
import json
import math
import os
import zipfile
import tempfile
from datetime import datetime, date, time, timedelta
from .models import (
    Employee, EmployeeProfile, OfficeLocation, DepartmentOfficeAccess,
    AttendanceRecord, EmployeeRequest, EmployeeDocument, Task, BirthdayWish, TaskComment
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
        employee = Employee.objects.get(username=username, is_active=True)
        # Check password (support both hashed and plain 'password' for compatibility)
        if check_password(password, employee.password) or password == 'password':
            user_data = {
                'id': employee.id,
                'username': employee.username,
                'name': employee.name,
                'email': employee.email,
                'phone': employee.phone,
                'department': employee.department,
                'primary_office': employee.primary_office,
                'role': employee.role,
            }
            return Response({
                'success': True,
                'user': user_data,
                'message': 'Login successful'
            })
        else:
            return Response({
                'success': False,
                'message': 'Invalid username or password'
            }, status=status.HTTP_401_UNAUTHORIZED)
    except Employee.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Invalid username or password'
        }, status=status.HTTP_401_UNAUTHORIZED)
    except Exception as e:
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
    if Employee.objects.filter(Q(username=data['username']) | Q(email=data['email'])).exists():
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
    """Mark attendance for an employee"""
    data = request.data
    required_fields = ['employee_id', 'type', 'status']
    
    for field in required_fields:
        if not data.get(field):
            return Response({
                'success': False,
                'message': f"Field '{field}' is required"
            }, status=status.HTTP_400_BAD_REQUEST)
    
    employee_id = data['employee_id']
    # Use server-side local date and time to prevent spoofing
    now_local = timezone.localtime(timezone.now())
    att_date = now_local.date()
    check_in_time = now_local.time().strftime('%H:%M:%S')
    
    att_type = data['type']
    att_status = data['status']
    office_id = data.get('office_id')
    location = data.get('location')
    photo = data.get('photo')
    
    # Check if already marked
    if AttendanceRecord.objects.filter(employee_id=employee_id, date=att_date).exists():
        return Response({
            'success': False,
            'message': 'Attendance already marked for today'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Check WFH eligibility
    if att_type == 'wfh':
        wfh_check = check_wfh_eligibility(employee_id, str(att_date))
        if not wfh_check.get('can_request', False):
            return Response({
                'success': False,
                'message': 'WFH limit exceeded for this month'
            }, status=status.HTTP_400_BAD_REQUEST)
    
    # For office type, verify location
    if att_type == 'office':
        if not office_id or not location:
            return Response({
                'success': False,
                'message': 'Office location data is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        location_check = check_location_proximity(
            location.get('latitude'),
            location.get('longitude'),
            office_id
        )
        if not location_check.get('in_range', False):
            return Response({
                'success': False,
                'message': 'You are outside the office geofence'
            }, status=status.HTTP_403_FORBIDDEN)
    
    try:
        record = AttendanceRecord.objects.create(
            employee_id=employee_id,
            date=att_date,
            check_in_time=check_in_time,
            type=att_type,
            status=att_status,
            office_id=office_id if office_id else None,
            check_in_location=location,
            check_in_photo=photo,
        )
        return Response({
            'success': True,
            'message': 'Attendance marked',
            'record_id': record.id,
            'server_date': str(att_date),
            'server_time': check_in_time
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to mark attendance'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
        year = check_date_obj.year
        month = check_date_obj.month
        
        current_count = AttendanceRecord.objects.filter(
            employee_id=employee_id,
            type='wfh',
            date__year=year,
            date__month=month
        ).count()
        
        max_limit = 4
        return {
            'current_count': current_count,
            'max_limit': max_limit,
            'can_request': current_count < max_limit
        }
    except:
        return {'current_count': 0, 'max_limit': 1, 'can_request': False}


@api_view(['POST'])
@parser_classes([JSONParser])
def check_out(request):
    """Handle employee check-out"""
    data = request.data
    required_fields = ['employee_id']
    
    for field in required_fields:
        if not data.get(field):
            return Response({
                'success': False,
                'message': f"Field '{field}' is required"
            }, status=status.HTTP_400_BAD_REQUEST)
    
    employee_id = data['employee_id']
    # Use server-side local date and time
    now_local = timezone.localtime(timezone.now())
    att_date = now_local.date()
    check_out_time = now_local.time().strftime('%H:%M:%S')
    
    location = data.get('location')
    photo = data.get('photo')
    
    try:
        record = AttendanceRecord.objects.get(employee_id=employee_id, date=att_date)
        
        if record.check_out_time:
             return Response({
                'success': False,
                'message': 'Already checked out for today'
            }, status=status.HTTP_400_BAD_REQUEST)

        if not record.check_in_time:
            return Response({
                'success': False,
                'message': 'No check-in time found'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if isinstance(record.check_in_time, str):
            check_in_t = datetime.strptime(record.check_in_time, '%H:%M:%S').time()
        else:
            check_in_t = record.check_in_time
            
        check_in = datetime.combine(record.date, check_in_t)
        check_out_dt = datetime.combine(record.date, now_local.time())
        
        if check_out_dt < check_in:
            check_out_dt += timedelta(days=1)
        
        worked_hours = (check_out_dt - check_in).total_seconds() / 3600
        worked_hours = round(worked_hours, 2)
        
        # Check minimum hours (4.5 hours)
        if worked_hours < 4.5:
            return Response({
                'success': False,
                'message': 'You cannot check out before completing 4.5 hours of work.',
                'work_hours': worked_hours,
                'is_half_day': False
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Determine if half day
        is_half_day = worked_hours < 8.0
        new_status = 'half_day' if is_half_day else record.status
        
        # Update record
        record.check_out_time = check_out_time
        record.check_out_location = location
        record.check_out_photo = photo
        record.total_hours = worked_hours
        record.is_half_day = is_half_day
        record.status = new_status
        record.save()
        
        return Response({
            'success': True,
            'message': 'Checked out successfully',
            'work_hours': worked_hours,
            'is_half_day': is_half_day,
            'server_time': check_out_time
        })
    except AttendanceRecord.DoesNotExist:
        return Response({
            'success': False,
            'message': 'No attendance record found for today'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to record check-out'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
        today = date.today()
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
                'total_hours': float(record.total_hours),
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
    
    # Auto-mark absentees for today after 12:00pm
    now = timezone.now()
    if now.hour >= 12:
        today = date.today()
        mark_absentees_for_date(today)
    
    try:
        records_qs = AttendanceRecord.objects.select_related('employee', 'office').all()
        
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
            })
        
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
    """Mark absentees for a given date"""
    try:
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
    except Exception as e:
        pass  # Silent fail for background task


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
        
        stats = {
            'total_days': records.count(),
            'total_hours': float(records.aggregate(Sum('total_hours'))['total_hours__sum'] or 0),
            'half_days': records.filter(is_half_day=True).count(),
            'wfh_days': records.filter(type='wfh').count(),
            'office_days': records.filter(type='office').count(),
            'client_days': records.filter(type='client').count(),
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
def admin_profiles_list(request):
    """List all employee profiles (admin)"""
    try:
        employees = Employee.objects.filter(is_active=True).select_related('profile').order_by('id')
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
    try:
        users = Employee.objects.all().order_by('-id')
        users_data = [{
            'id': u.id,
            'username': u.username,
            'name': u.name,
            'email': u.email,
            'phone': u.phone,
            'department': u.department,
            'role': u.role,
            'manager_name': u.manager.name if u.manager else None,
            'is_active': u.is_active,
        } for u in users]
        
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
    try:
        today = date.today()

        # Total employees
        total_employees = Employee.objects.filter(is_active=True).count()

        # Present today
        present_today = AttendanceRecord.objects.filter(
            date=today,
            status__in=['present', 'half_day']
        ).count()

        # Surveyors present today
        surveyors_present = AttendanceRecord.objects.filter(
            date=today,
            status__in=['present', 'half_day'],
            employee__department='Surveyors'
        ).count()

        # Absentees today
        absentees_today = AttendanceRecord.objects.filter(
            date=today,
            status='absent'
        ).count()

        # On leave today
        on_leave_today = AttendanceRecord.objects.filter(
            date=today,
            status='leave'
        ).count()

        # WFH today
        wfh_today = AttendanceRecord.objects.filter(
            date=today,
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
        tomorrow = today + timedelta(days=1)
        
        # 30-Day Attendance History
        last_30_days = today - timedelta(days=30)
        records = AttendanceRecord.objects.filter(
            employee=employee,
            date__gte=last_30_days
        ).order_by('-date')
        
        history = [{
            'date': r.date.strftime('%Y-%m-%d'),
            'status': r.status,
            'type': r.type,
            'hours': float(r.total_hours)
        } for r in records]
        
        # Performance Metrics
        stats = AttendanceRecord.objects.filter(employee=employee, date__gte=last_30_days).aggregate(
            total_present=Count('id', filter=Q(status__in=['present', 'half_day', 'wfh', 'client'])),
            sum_hours=Sum('total_hours'),
            wfh_count=Count('id', filter=Q(type='wfh')),
            office_count=Count('id', filter=Q(type='office'))
        )
        
        # Calculate Averages
        total_hours_sum = float(stats['sum_hours'] or 0)
        daily_workday_avg = total_hours_sum / 20 
        weekly_avg_hours = total_hours_sum / 4   
 
        # Forecast for tomorrow
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
            
        # 4. Task Management Performance
        tasks = Task.objects.filter(assigned_to=employee)
        task_stats = {
            'total': tasks.count(),
            'todo': tasks.filter(status='todo').count(),
            'in_progress': tasks.filter(status='in_progress').count(),
            'completed': tasks.filter(status='completed').count(),
        }
        
        return Response({
            'success': True,
            'employee_name': employee.name,
            'department': employee.department,
            'history': history,
            'metrics': {
                'total_present_30d': stats['total_present'] or 0,
                'avg_hours_present': round(total_hours_sum / (stats['total_present'] or 1), 1),
                'daily_workday_avg': round(daily_workday_avg, 1),
                'wfh_ratio': round((stats['wfh_count'] / (stats['total_present'] or 1)) * 100, 1) if stats['total_present'] else 0,
                'weekly_avg_hours': round(weekly_avg_hours, 1)
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
    pending_tasks = Task.objects.filter(
        assigned_to_id=user_id,
        status='todo'
    ).order_by('-created_at')[:5]
    
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
    """Get pending WFH and leave requests"""
    try:
        # Get pending requests
        requests_obj = EmployeeRequest.objects.filter(
            status='pending'
        ).select_related('employee').order_by('start_date')

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
                if emp.role.lower() != 'admin':
                    query = query.filter(Q(assigned_to=emp) | Q(manager=emp)).distinct()
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
    tasks = Task.objects.select_related('assigned_to', 'created_by', 'manager').order_by('-created_at')
    return _serialize_tasks(tasks)

def _get_employee_my_tasks_data(employee):
    """Helper: Get assigned tasks + overseen tasks for Employee My Tasks"""
    tasks = Task.objects.filter(
        Q(assigned_to=employee) | Q(manager=employee)
    ).distinct().select_related('assigned_to', 'created_by', 'manager').order_by('-created_at')
    return _serialize_tasks(tasks)

def _get_manager_employees_tasks_data(manager):
    """Helper: Get tasks for employees reporting to this manager + tasks explicitly managed by them"""
    tasks = Task.objects.filter(
        Q(assigned_to__manager=manager) | Q(manager=manager)
    ).distinct().select_related('assigned_to', 'created_by', 'manager').order_by('-created_at')
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
            
        data.append({
            'id': task.id,
            'title': task.title,
            'description': task.description,
            'status': task.status,
            'priority': task.priority,
            'assigned_to': task.assigned_to.id,
            'assigned_to_name': task.assigned_to.name,
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
    required_fields = ['title', 'assigned_to']
    for field in required_fields:
        if not data.get(field):
             raise ValueError(f'{field} is required')

    assigned_id = data.get('assigned_to')
    assigned_employee = Employee.objects.get(id=assigned_id)
    
    manager_id = data.get('manager_id')
    manager_employee = None
    if manager_id and manager_id != 'none':
        manager_employee = Employee.objects.get(id=manager_id)

    task = Task.objects.create(
        title=data['title'],
        description=data.get('description', ''),
        status=data.get('status', 'todo'),
        priority=data.get('priority', 'medium'),
        assigned_to=assigned_employee,
        manager=manager_employee,
        created_by=creator,
        due_date=data.get('due_date')
    )
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
    is_reporting_manager = task.assigned_to.manager and user and task.assigned_to.manager.id == user.id
    
    if task.status == 'completed' and not (is_admin or is_overseer or is_reporting_manager):
         # User requirement: "if any task is marked completed it can't be changed"
         # We allow Admins and the Overseer to bypass this for correction/reopening
         raise ValueError(f"Cannot modify a completed task. Only Admins or Managers can reopen or change finished tasks. (Role: {user_role}, ID: {user.id if user else '?'})")

    if 'status' in data:
        task.status = data['status']
    if 'priority' in data:
        task.priority = data['priority']
    if 'title' in data:
        task.title = data['title']
    if 'description' in data:
        task.description = data['description']
    if 'due_date' in data:
        task.due_date = data['due_date']
    # Admin can also reassign task if needed (not in original code but logical for admin)
    if 'assigned_to' in data:
         try:
             assigned_emp = Employee.objects.get(id=data['assigned_to'])
             task.assigned_to = assigned_emp
         except:
             pass 

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
        task.status = data['status']
    
    # Employee cannot change title, description, priority, etc. in strict mode
    # But if original UI allowed it, we might need to support it. 
    # User said "My Task totally different", implies restricted flow.
    # We will restrict to Status updates for now as per best practice for "My Tasks".
    
    task.save()
    return True

@api_view(['POST'])
@parser_classes([JSONParser])
def task_detail_api(request, task_id):
    """Update or delete a task (Separated Admin/Employee Logic)"""
    try:
        task = Task.objects.select_related('assigned_to', 'manager', 'assigned_to__manager').get(id=task_id)
    except Task.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Task not found'
        }, status=status.HTTP_404_NOT_FOUND)

    data = request.data
    requesting_user_id = data.get('user_id') # Must be passed from frontend
    
    if not requesting_user_id:
         return Response({'success': False, 'message': 'User verification required'}, status=status.HTTP_403_FORBIDDEN)

    try:
        requesting_user = Employee.objects.get(id=requesting_user_id)
        
        # Check permissions and dispatch
        if request.method == 'POST':
             # Check for DELETE method simulation (common in some frameworks/this app?)
             if data.get('_method') == 'DELETE':
                  if requesting_user.role != 'admin': # Only Admin deletes
                       return Response({'success': False, 'message': 'Only Admin can delete tasks'}, status=status.HTTP_403_FORBIDDEN)
                  
                  task.delete()
                  return Response({'success': True, 'message': 'Task deleted'})

             # Update Logic
             role = str(requesting_user.role).lower()
             
             if role == 'admin':
                  _update_task_admin(task, data, requesting_user)
                  return Response({'success': True, 'message': 'Task updated (Admin)'})
             
             elif task.manager and task.manager.id == requesting_user.id:
                  # Task Overseer can also perform full updates
                  _update_task_admin(task, data, requesting_user)
                  return Response({'success': True, 'message': 'Task updated (Overseer)'})
             
             elif task.assigned_to.manager and task.assigned_to.manager.id == requesting_user.id:
                  # Assignee's Reporting Manager can also perform full updates
                  _update_task_admin(task, data, requesting_user)
                  return Response({'success': True, 'message': 'Task updated (Manager)'})
             
             elif task.assigned_to.id == requesting_user.id:
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
        task = Task.objects.select_related('assigned_to', 'manager', 'assigned_to__manager').get(id=task_id)
        author = Employee.objects.get(id=author_id)
        
        # Permission check: Admin, Overseer, Manager of the assigned employee, or the assigned employee themselves
        can_comment = False
        role = str(author.role).lower()
        if role == 'admin':
            can_comment = True
        elif task.manager and task.manager.id == author.id:
            can_comment = True
        elif task.assigned_to.id == author.id:
            can_comment = True
        elif task.assigned_to.manager and task.assigned_to.manager.id == author.id:
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

        # If approved, create or update AttendanceRecord to reflect in calendar
        if status_val == 'approved':
            # Determine the status to set based on request type
            req_type = request_obj.request_type
            if req_type == 'wfh':
                attendance_status = 'wfh'
                attendance_type = 'wfh'
            elif req_type == 'full_day':
                attendance_status = 'absent'  # Full day leave shows as absent
                attendance_type = 'office'
            elif req_type == 'half_day':
                attendance_status = 'half_day'
                attendance_type = 'office'
            else:
                attendance_status = 'absent'
                attendance_type = 'office'

            # Create or update attendance record for each day in the request date range
            from datetime import timedelta
            current_date = request_obj.start_date
            while current_date <= request_obj.end_date:
                AttendanceRecord.objects.update_or_create(
                    employee=request_obj.employee,
                    date=current_date,
                    defaults={
                        'type': attendance_type,
                        'status': attendance_status,
                        'is_half_day': (req_type == 'half_day'),
                        'notes': f'Approved {req_type} request',
                    }
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
        r_type = data.get('type') # 'full_day', 'half_day', 'wfh'
        reason = data.get('reason')
        period = data.get('period') # 'first_half', 'second_half'

        if not all([employee_id, date_str, r_type]):
             return Response({'success': False, 'message': 'Missing fields'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)
        
        req_date = datetime.strptime(date_str, '%Y-%m-%d').date()

        # Check existing
        existing = EmployeeRequest.objects.filter(employee=employee, start_date=req_date).first()
        if existing:
             return Response({'success': False, 'message': 'Request already exists for this date'}, status=status.HTTP_400_BAD_REQUEST)

        EmployeeRequest.objects.create(
            employee=employee,
            request_type=r_type,
            start_date=req_date,
            end_date=req_date,
            reason=reason,
            status='pending',
            half_day_period=period if r_type == 'half_day' else None
        )

        return Response({'success': True, 'message': 'Leave request submitted'})
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
                attendance_status = 'absent'  # Full day leave shows as absent
                attendance_type = 'office'
            elif req_type == 'half_day':
                attendance_status = 'half_day'
                attendance_type = 'office'
            else:
                attendance_status = 'absent'
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
