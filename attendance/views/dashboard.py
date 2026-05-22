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

# --- Function: admin_summary ---
@api_view(['GET'])
@require_gated_token_api
def admin_summary(request):
    """Get admin dashboard summary for a specific date (defaults to today)"""
    # Secure identity: use token user
    user = get_current_user(request, requested_id=request.GET.get('user_id'))
    if not user:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)
    
    date_param = request.GET.get('date')
    # Include de-facto Mentors (any user who has subordinates)
    is_mentor = user and (user.role == 'mentor' or (user.role != 'admin' and user.subordinates.exists()))

    try:
        # Determine the target date (default to today IST)
        if date_param:
            target_date = datetime.strptime(date_param, '%Y-%m-%d').date()
        else:
            target_date = timezone.localtime(timezone.now()).date()

        # Phase 1: Fetch all active employees (excluding admins)
        employees_qs = Employee.objects.filter(is_active=True).exclude(role='admin')
        if is_mentor:
            employees_qs = employees_qs.filter(mentors=user)
        
        all_employees = list(employees_qs.values('id', 'name', 'department'))
        total_employees = len(all_employees)
        employee_id_to_name = {e['id']: e['name'] for e in all_employees}
        employee_ids = set(employee_id_to_name.keys())

        # Phase 2: Fetch all attendance records for the target date
        records_qs = AttendanceRecord.objects.filter(date=target_date, employee_id__in=employee_ids)
        all_records = list(records_qs.values('employee_id', 'status', 'type', 'employee__name', 'employee__department'))

        # Phase 3: Categorize in memory (O(N) instead of multiple O(N) queries)
        present_names = []
        leave_names = []
        wfh_names = []
        marked_ids = set()

        surveyors_total = 0
        surveyors_office_names = []
        surveyors_client_names = []
        surveyors_wfh_names = []
        surveyors_leave_names = []
        surveyors_marked_ids = set()

        # Count total surveyors
        for e in all_employees:
            if e['department'] == 'Surveyors':
                surveyors_total += 1

        for r in all_records:
            emp_id = r['employee_id']
            status = r['status']
            att_type = r['type']
            name = r['employee__name']
            dept = r['employee__department']
            
            marked_ids.add(emp_id)
            
            if status in ['present', 'half_day', 'wfh', 'client']:
                present_names.append(name)
            
            if status == 'leave':
                leave_names.append(name)
            
            if status == 'wfh':
                wfh_names.append(name)
                
            # Surveyor specifics
            if dept == 'Surveyors':
                surveyors_marked_ids.add(emp_id)
                if status == 'leave':
                    surveyors_leave_names.append(name)
                elif status == 'client' or (status in ['present', 'half_day'] and att_type == 'client'):
                    surveyors_client_names.append(name)
                elif status == 'wfh' or (status in ['present', 'half_day'] and att_type == 'wfh'):
                    surveyors_wfh_names.append(name)
                elif status in ['present', 'half_day'] and att_type == 'office':
                    surveyors_office_names.append(name)

        # Calculate absent
        absent_names = [e['name'] for e in all_employees if e['id'] not in marked_ids]
        surveyors_absent_names = [e['name'] for e in all_employees if e['department'] == 'Surveyors' and e['id'] not in surveyors_marked_ids]

        surveyors_active = len(surveyors_office_names) + len(surveyors_client_names) + len(surveyors_wfh_names)

        # Project stats
        total_projects = Project.objects.count()
        running_projects = Project.objects.filter(status='running').count()
        completed_projects = Project.objects.filter(status='completed').count()

        return Response({
            'success': True,
            'date': str(target_date),
            'total_projects': total_projects,
            'running_projects': running_projects,
            'completed_projects': completed_projects,
            'total_employees': total_employees,
            'present_today': len(present_names),
            'present_names': present_names,
            'absent_today': len(absent_names),
            'absent_names': absent_names,
            'on_leave': len(leave_names),
            'leave_names': leave_names,
            'wfh_today': len(wfh_names),
            'wfh_names': wfh_names,
            'surveyors_total': surveyors_total,
            'surveyors_present': surveyors_active,
            'surveyors_office': len(surveyors_office_names),
            'surveyors_office_names': surveyors_office_names,
            'surveyors_client': len(surveyors_client_names),
            'surveyors_client_names': surveyors_client_names,
            'surveyors_wfh': len(surveyors_wfh_names),
            'surveyors_wfh_names': surveyors_wfh_names,
            'surveyors_leave': len(surveyors_leave_names),
            'surveyors_leave_names': surveyors_leave_names,
            'surveyors_absent': len(surveyors_absent_names),
            'surveyors_absent_names': surveyors_absent_names,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({
            'success': False,
            'message': f'Failed to fetch admin summary: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: upcoming_birthdays ---
@api_view(['GET'])
@require_gated_token_api
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




# --- Function: pending_requests ---
@api_view(['GET'])
@require_gated_token_api
def pending_requests(request):
    """Get pending or history (approved/rejected) WFH and leave requests"""
    user_id = request.GET.get('user_id')
    user = Employee.objects.filter(id=user_id).first() if user_id else None
    # Include de-facto Mentors (any user who has subordinates)
    is_mentor = user and (user.role == 'mentor' or (user.role != 'admin' and user.subordinates.exists()))

    try:
        status_param = request.GET.get('status', 'pending')
        
        # Buffer logic for WFH requests
        today = timezone.now().date()
        buffer_date = today - timedelta(days=2)
        
        if status_param == 'history':
            # Get approved and rejected requests, plus expired WFH requests
            requests_obj = EmployeeRequest.objects.filter(
                Q(status__in=['approved', 'rejected']) |
                Q(request_type='wfh', end_date__lt=buffer_date)
            ).select_related('employee').order_by('-start_date')
            
            # If we are specifically in history, we should exclude Approved WFH that are still within buffer
            # (since they are shown in Active)
            requests_obj = requests_obj.exclude(
                status='approved', request_type='wfh', end_date__gte=buffer_date
            )
        else:
            # Get pending requests, plus recently approved WFH requests
            requests_obj = EmployeeRequest.objects.filter(
                Q(status='pending') |
                Q(status='approved', request_type='wfh', end_date__gte=buffer_date)
            ).select_related('employee').order_by('start_date')
            
            # Exclude WFH requests that have expired (even if pending)
            requests_obj = requests_obj.exclude(
                request_type='wfh', end_date__lt=buffer_date
            )

        if is_mentor:
            requests_obj = requests_obj.filter(employee__mentors=user)

        requests_data = []
        from ..models import Task
        for req in requests_obj:
            task_info = None
            if req.request_type == 'wfh':
                today_tasks = Task.objects.filter(assignees=req.employee, due_date=req.start_date)
                total = today_tasks.count()
                completed = today_tasks.filter(status='completed').count()
                task_info = {
                    'total': total,
                    'completed': completed,
                    'percent': round((completed / total * 100), 1) if total > 0 else 0,
                    'summary': f"{completed}/{total} tasks completed" if total > 0 else "No tasks due"
                }

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
                'task_info': task_info,
                'reviewed_by_name': req.reviewed_by.name if req.reviewed_by else None,
                'is_mentor': req.reviewed_by in req.employee.mentors.all() if req.reviewed_by else False,
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





# --- Function: my_requests ---
@api_view(['GET'])
@require_gated_token_api
def my_requests(request):
    """Get request history for an employee"""
    try:
        employee_id = request.GET.get('employee_id')
        user = get_current_user(request, requested_id=employee_id)
        if not user:
            return Response({'success': False, 'message': 'Unauthorized'}, status=403)

        # Get all requests for employee
        requests_obj = EmployeeRequest.objects.filter(
            employee=user
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
                'reviewed_by_name': req.reviewed_by.name if req.reviewed_by else None,
                'is_mentor': req.reviewed_by in req.employee.mentors.all() if req.reviewed_by else False,
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




# --- Function: active_tasks ---
@api_view(['GET'])
@require_gated_token_api
def active_tasks(request):
    """Get count of in-progress tasks"""
    try:
        # Use request.user which is already validated by @require_gated_token_api
        caller = getattr(request, 'user', None)
        
        # Verify caller identity
        if not caller or not isinstance(caller, Employee):
            return Response({'success': False, 'message': 'Unauthorized or Session Expired'}, status=403)
            
        requested_id = request.GET.get('employee_id')
        
        # Determine which user's tasks we are looking at
        if caller.role.lower() == 'admin':
            # Admin can see any user's count, or all tasks if requested_id is missing or points to them
            if requested_id and str(requested_id) != str(caller.id):
                user = Employee.objects.filter(id=requested_id).first() or caller
            else:
                user = caller
        else:
            # Non-admins can ONLY see their own count
            user = caller

        query = Task.objects.filter(status='in_progress')
        
        # Safety check for role
        role = (user.role or '').lower()
        
        # Treat de-facto Mentors (employees with subordinates) like official Mentors
        is_emp_mentor = role == 'mentor' or (role != 'admin' and user.subordinates.exists())
        
        if role == 'admin':
            # Admin sees all in-progress tasks
            pass
        elif is_emp_mentor:
            query = query.filter(Q(assignees__mentors=user) | Q(mentors=user) | Q(created_by=user) | Q(assignees=user)).distinct()
        else:
            query = query.filter(Q(assignees=user) | Q(mentors=user)).distinct()

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




# --- Function: error_400_view ---
def error_400_view(request, exception=None):
    """Custom 400 Bad Request handler"""
    return render(request, '400.html', status=400)




# --- Function: error_403_view ---
def error_403_view(request, exception=None, message="None Provided"):
    """Custom 403 Forbidden handler with diagnostic info"""
    return render(request, '403.html', {'error_message': message}, status=403)




# --- Function: error_404_view ---
def error_404_view(request, exception=None):
    """Custom 404 Not Found handler"""
    return render(request, '404.html', status=404)




# --- Function: error_500_view ---
def error_500_view(request):
    """Custom 500 Server Error handler"""
    return render(request, '500.html', status=500)




# --- Function: spa_view ---
@require_valid_token
def spa_view(request):
    """Protected view to serve the SPA index.html."""
    host = request.get_host()
    # Check if we are running in development (localhost/127.0.0.1 or DEBUG mode)
    is_development = settings.DEBUG or '127.0.0.1' in host or 'localhost' in host
    
    # Check if user is attached by the decorator
    is_authenticated = hasattr(request, 'user') and isinstance(request.user, Employee)
    
    token_str = request.GET.get('token') or request.COOKIES.get('gated_token')
    context = {
        'maps_api_key': settings.MAPS_API_KEY,
        'gated_token': token_str,
        'is_development': is_development,
        'is_authenticated': is_authenticated
    }
    response = render(request, 'index.html', context)
    if token_str:
        # Set cookie to expire in 1 hour (3600 seconds)
        # Note: httponly=False to allow JS logout to clear it
        response.set_cookie('gated_token', token_str, max_age=3600, samesite='Lax')
    return response





# --- Function: gated_dashboard ---
@require_valid_token
def gated_dashboard(request):
    """Entry point for gated access with token from portal."""
    token_str = request.GET.get('token') or request.COOKIES.get('gated_token')
    from ..security import validate_gated_token
    success, data = validate_gated_token(token_str)
    
    host = request.get_host()
    is_development = settings.DEBUG or '127.0.0.1' in host or 'localhost' in host
    
    # User should already be attached by @require_valid_token
    is_authenticated = hasattr(request, 'user') and isinstance(request.user, Employee)

    context = {
        'maps_api_key': settings.MAPS_API_KEY,
        'gated_token': token_str,
        'is_development': is_development,
        'is_authenticated': is_authenticated
    }
    
    if success:
        context['gated_user_id'] = data.get('user_id')
        context['is_gated'] = True
        
    response = render(request, 'index.html', context)
    if success and token_str:
        # Set cookie to expire in 1 hour (3600 seconds)
        # Note: httponly=False to allow JS logout to clear it
        response.set_cookie('gated_token', token_str, max_age=3600, samesite='Lax')
    return response




# --- Function: service_worker_view ---
@csrf_exempt
def service_worker_view(request):
    """
    Serve the Service Worker script from the root with the required 
    Service-Worker-Allowed header to allow it to control the entire site scope.
    """
    try:
        #sw_path = os.path.join(settings.BASE_DIR, 'static', 'sw.js')
        # Optimized: use STATICFILES_DIRS if available
        if hasattr(settings, 'STATICFILES_DIRS') and settings.STATICFILES_DIRS:
            sw_path = os.path.join(settings.STATICFILES_DIRS[0], 'sw.js')
        else:
            sw_path = os.path.join(settings.BASE_DIR, 'static', 'sw.js')
            
        with open(sw_path, 'rb') as f:
            content = f.read()
        
        response = HttpResponse(content, content_type='application/javascript')
        response['Service-Worker-Allowed'] = '/'
        return response
    except Exception as e:
        return HttpResponse(f"Service Worker not found: {str(e)}", status=404)


# ─────────────────────────────────────────────────────────────────────────────
#  HOLIDAY MANAGEMENT VIEWS
# ─────────────────────────────────────────────────────────────────────────────

from ..models import Holiday, HolidayUpload, UserHoliday




