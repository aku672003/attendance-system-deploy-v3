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

# --- Function: mark_attendance ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def mark_attendance(request):
    data = request.data
    employee_id = data.get('employee_id')
    
    # Secure identity: Use token user if available
    user = get_current_user(request, requested_id=employee_id)
    if not user:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)
        
    now_local = timezone.localtime(timezone.now())
    att_date = now_local.date()
    
    # 0. Restriction check: 9 AM - 6 PM for non-Surveyors
    assignment = user.get_current_assignment()
    is_admin = (user.role or '').lower() == 'admin'
    
    if assignment['department'] != 'Surveyors' and not is_admin:
        current_hour = now_local.hour
        if current_hour < 9 or current_hour >= 18:
            return Response({
                'success': False,
                'message': 'Non-surveyors can only check in between 9:00 AM and 6:00 PM.'
            }, status=status.HTTP_400_BAD_REQUEST)

    # 0.5 Missed Check-outs Penalty Check
    # Check the last 3 days where the user had a check-in
    past_3_records = list(AttendanceRecord.objects.filter(
        employee_id=user.id,
        date__lt=att_date,
        check_in_time__isnull=False
    ).exclude(status__in=['absent', 'leave']).order_by('-date')[:3])

    if len(past_3_records) == 3 and all(r.check_out_time is None for r in past_3_records):
        last_missed_date = past_3_records[0].date
        # Check if an unblock request exists that was created AFTER the last missed checkout
        unblock_req = EmployeeRequest.objects.filter(
            employee_id=user.id,
            request_type='unblock_attendance',
            created_at__date__gte=last_missed_date
        ).order_by('-created_at').first()
        
        if not unblock_req or unblock_req.status == 'rejected':
            return Response({
                'success': False,
                'error_code': 'ATTENDANCE_BLOCKED',
                'message': 'You have checked in but not checked out for 3 consecutive days. Please send a request to the Admin to unblock your attendance.'
            }, status=status.HTTP_403_FORBIDDEN)
        elif unblock_req.status == 'pending':
            return Response({
                'success': False,
                'error_code': 'ATTENDANCE_BLOCKED_PENDING',
                'message': 'Your request to unblock attendance is pending Admin approval.'
            }, status=status.HTTP_403_FORBIDDEN)
        # If unblock_req.status == 'approved', we allow check-in!

    # 0.7 Auto-close any unclosed records from previous days
    # This prevents sessions from spanning multiple days and causing "99+ hours" bugs.
    AttendanceRecord.objects.filter(
        employee_id=user.id,
        date__lt=att_date,
        check_in_time__isnull=False,
        check_out_time__isnull=True
    ).exclude(status__in=['absent', 'leave']).update(
        status='absent',
        notes="Auto-marked absent: New check-in started on a later date"
    )

    # 1. Check if ANY record exists for today to avoid unique constraint violations
    existing_record = AttendanceRecord.objects.filter(employee_id=user.id, date=att_date).first()

    if existing_record and existing_record.check_in_time:
        return Response({
            'success': False,
            'message': 'Attendance already marked for today'
        }, status=status.HTTP_400_BAD_REQUEST)

    # 1.5 WFH/Half Day Approval & Verification Check
    is_wfh = (data.get('status') == 'wfh' or data.get('type') == 'wfh')
    is_half = (data.get('status') == 'half_day')
    
    wfh_check = check_wfh_eligibility(user.id, att_date.isoformat())
    has_approved = False
    
    if is_wfh:
        has_approved = wfh_check.get('has_approved_request')
    elif is_half:
        has_approved = EmployeeRequest.objects.filter(
            employee_id=user.id,
            start_date=att_date,
            request_type='half_day',
            status='approved'
        ).exists()

    # Strictly block if WFH/Half Day is attempted without approval
    if (is_wfh or is_half) and not has_approved:
        return Response({
            'success': False, 
            'message': f'Your {data.get("status", "WFH/Half Day").replace("_", " ")} request must be approved by a Mentor or Admin first.'
        }, status=status.HTTP_403_FORBIDDEN)
    
    # Enforce camera and geolocation for WFH and Half Day
    if (is_wfh or is_half) and (not data.get('location') or not data.get('photo')):
        return Response({
            'success': False, 
            'message': 'Camera photo and Geolocation are mandatory for this attendance type.'
        }, status=status.HTTP_400_BAD_REQUEST)

    status_note = "Pre-approved" if has_approved else "Self-marked"
    record_note = f"{status_note} {data.get('status')}"

    try:
        check_in_time = now_local.time().strftime('%H:%M:%S')
        if existing_record:
            # Update existing record (placeholder like 'absent', 'leave', or 'holiday')
            existing_record.check_in_time = check_in_time
            existing_record.status = data.get('status')
            existing_record.type = data.get('type')
            existing_record.check_in_location = data.get('location')
            existing_record.check_in_photo = data.get('photo')
            existing_record.office_id = data.get('office_id')
            existing_record.is_half_day = is_half
            existing_record.notes = record_note
            existing_record.save()
        else:
            # Create New
            AttendanceRecord.objects.create(
                employee_id=user.id,
                date=att_date,
                check_in_time=check_in_time,
                type=data.get('type'),
                status=data.get('status'),
                check_in_location=data.get('location'),
                check_in_photo=data.get('photo'),
                office_id=data.get('office_id'),
                is_half_day=is_half,
                notes=record_note
            )
        return Response({'success': True, 'message': 'Checked in successfully'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=500)



# --- Function: get_server_time ---
@api_view(['GET'])
@require_gated_token_api
def get_server_time(request):
    """Return the current server time in IST for frontend synchronization"""
    now_local = timezone.localtime(timezone.now())
    
    # 9 Hours completion reminder logic
    if hasattr(request, 'user') and request.user:
        try:
            today = now_local.date()
            record = AttendanceRecord.objects.filter(
                employee=request.user, 
                date=today, 
                check_out_time__isnull=True
            ).first()
            
            if record and record.check_in_time:
                # Combine date and time for comparison
                check_in_dt = timezone.make_aware(datetime.combine(today, record.check_in_time))
                diff_hours = (now_local - check_in_dt).total_seconds() / 3600
                
                if diff_hours >= 9.0:
                    # Check if notification already sent for this specific session reminder today
                    notif_exists = Notification.objects.filter(
                        user=request.user,
                        type='attendance_reminder',
                        created_at__date=today
                    ).exists()
                    
                    if not notif_exists:
                        msg = "You have completed 9 hours of working hours. Don't forget to check out!"
                        Notification.objects.create(
                            user=request.user,
                            type='attendance_reminder',
                            message=msg
                        )
                        # Attempt push notification
                        try:
                            _trigger_push_notification(request.user, "9 Hours Completed", msg)
                        except: pass
        except Exception as e:
            # Silent fail for background logic to avoid breaking main API
            print(f"Error in 9-hour reminder logic: {e}")

    return Response({
        'success': True,
        'timestamp': now_local.timestamp() * 1000, # Milliseconds
        'formatted': now_local.strftime('%Y-%m-%d %H:%M:%S'),
        'timezone': 'Asia/Kolkata'
    })







# --- Function: check_wfh_eligibility ---
def check_wfh_eligibility(employee_id, check_date):
    """Check WFH eligibility for an employee"""
    try:
        check_date_obj = datetime.strptime(check_date, '%Y-%m-%d').date()
        
        # Check if there is any WFH request for this date
        wfh_request = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='wfh',
            start_date__lte=check_date_obj,
            end_date__gte=check_date_obj
        ).first()

        has_approved_request = wfh_request.status == 'approved' if wfh_request else False
        request_status = wfh_request.status if wfh_request else None

        # Count approved WFH requests for the current month (for dashboard stats)
        current_month_requests = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='wfh',
            status='approved',
            start_date__year=check_date_obj.year,
            start_date__month=check_date_obj.month
        ).count()

        # Check for half day requests
        half_day_request = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='half_day',
            start_date__lte=check_date_obj,
            end_date__gte=check_date_obj
        ).first()

        return {
            'has_approved_request': has_approved_request,
            'request_status': request_status,
            'can_request': not wfh_request or request_status == 'rejected', 
            'current_count': current_month_requests,
            'max_limit': 2, # User mentioned 2 in dashboard earlier
            'half_day': {
                'requested': half_day_request is not None,
                'status': half_day_request.status if half_day_request else None,
                'approved': half_day_request.status == 'approved' if half_day_request else False
            }
        }
    except Exception as e:
        print(f"Error checking WFH eligibility: {e}")
        return {'has_approved_request': False, 'request_status': None, 'can_request': True, 'current_count': 0, 'max_limit': 2}




# --- Function: check_out ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def check_out(request):
    data = request.data
    employee_id = data.get('employee_id')
    
    # Secure identity: Use token user if available
    user = get_current_user(request, requested_id=employee_id)
    if not user:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)
        
    now_local = timezone.localtime(timezone.now())
    
    try:
        # 1. Try to find the specific record for the date provided by the frontend
        target_date = data.get('date')
        if target_date:
            record = AttendanceRecord.objects.filter(
                employee_id=user.id,
                date=target_date,
                check_in_time__isnull=False,
                check_out_time__isnull=True
            ).first()
        else:
            record = None

        # 2. Fallback to the latest unclosed record if not found for specific date
        if not record:
            record = AttendanceRecord.objects.filter(
                employee_id=user.id, 
                check_in_time__isnull=False,
                check_out_time__isnull=True
            ).exclude(status__in=['absent', 'leave']).order_by('-date', '-check_in_time').first()

        # 3. Extra fallback: If today's record was auto-marked absent (forgot to check out earlier)
        if not record:
            record = AttendanceRecord.objects.filter(
                employee_id=user.id,
                date=now_local.date(),
                check_in_time__isnull=False,
                check_out_time__isnull=True,
                status='absent'
            ).first()

        if not record:
            return Response({'success': False, 'message': 'No active session found.'}, status=404)

        check_in_t = datetime.strptime(str(record.check_in_time), '%H:%M:%S').time()
        check_in_dt = timezone.make_aware(datetime.combine(record.date, check_in_t))
        
        # Calculate hours and cap at a reasonable maximum to prevent "99+ hours" bug
        # We enforce a hard cap of 14 hours per day.
        raw_hours = (now_local - check_in_dt).total_seconds() / 3600
        
        # If check-out is on a different day, or hours are excessive (>14h), cap it.
        # This handles cases where user forgets to check out for days.
        if record.date != now_local.date() or raw_hours > 14.0:
            worked_hours = 14.0
        else:
            worked_hours = round(max(0.0, raw_hours), 2)
        
        # Min hours requirement (e.g. 4.5h for a valid day)
        if worked_hours < 4.5:
             return Response({'success': False, 'message': 'Minimum 4.5 hours of work required for check-out.'}, status=400)

        record.check_out_time = now_local.time().strftime('%H:%M:%S')
        record.total_hours = worked_hours
        
        if record.type == 'wfh':
            # 9 Hours strict for Full WFH Day. Between 4.5 and 9 is marked as half_day.
            record.status = 'wfh' if worked_hours >= 9.0 else 'half_day'
            record.is_half_day = True if worked_hours < 9.0 else False
            
            # Check tasks completed for today
            from ..models import Task
            today_tasks = Task.objects.filter(assignees=record.employee.id, due_date=record.date)
            total_tasks = today_tasks.count()
            completed_tasks = today_tasks.filter(status='completed').count()
            
            task_status_msg = f'Tasks: {completed_tasks}/{total_tasks} completed.'
            if total_tasks > 0:
                percent = round((completed_tasks / total_tasks * 100), 1)
                task_status_msg += f' ({percent}% completion)'
                if completed_tasks == total_tasks:
                    task_status_msg += ' - ALL TASKS CLEAR!'
                else:
                    task_status_msg += ' - PENDING TASKS!'
            else:
                task_status_msg = 'Tasks: No tasks assigned/due for today.'
                
            # Automate an approval request for Mentor/Admin to verify tasks at the end of the day
            # If a manual request already exists, update its reason to include task status
            wfh_req, created = EmployeeRequest.objects.get_or_create(
                employee_id=record.employee.id,
                request_type='wfh',
                start_date=record.date,
                end_date=record.date,
                defaults={
                    'status': 'pending', 
                    'reason': f'WFH Session Log ({worked_hours}h worked). {task_status_msg}'
                }
            )
            if not created and wfh_req.status == 'pending':
                wfh_req.reason = f'WFH Session Log ({worked_hours}h worked). {task_status_msg}'
                wfh_req.save()
            
            # Notify mentors if a request was created or task status was updated
            notification_msg = f"{record.employee.name}: WFH Log ({worked_hours}h). {task_status_msg}"
            for mentor in record.employee.mentors.all():
                _send_task_notification(mentor, notification_msg, wfh_req.id, type="request")
        elif record.type == 'client':
            record.status = 'half_day' if worked_hours < 9.0 else 'client'
            record.is_half_day = True if worked_hours < 9.0 else False
        else:
            # 9 Hours strict: Less than 9 hours is marked as half day
            # (requested half_day is also naturally caught here or handled by backend)
            record.status = 'half_day' if worked_hours < 9.0 else 'present'
            record.is_half_day = True if worked_hours < 9.0 else False
            
        record.save()
        
        return Response({'success': True, 'message': 'Checked out successfully'})
    except AttendanceRecord.DoesNotExist:
        return Response({'success': False, 'message': 'No active session found.'}, status=404)
    except Exception as e:
        return Response({'success': False, 'message': f'Check-out failed: {str(e)}'}, status=500)



# --- Function: today_attendance ---
@api_view(['GET'])
@require_gated_token_api
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
                'check_out_photo_url': record.check_out_photo if record.check_out_photo and not record.check_out_photo.startswith('data:') else None,
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




# --- Function: attendance_records ---
@api_view(['GET'])
@require_gated_token_api
def attendance_records(request):
    """Get attendance records with filters"""
    employee_id = request.GET.get('employee_id')
    start_date = request.GET.get('start_date')
    end_date = request.GET.get('end_date')
    att_type = request.GET.get('type')
    days_limit = request.GET.get('days_limit')
    days_offset = int(request.GET.get('days_offset', 0))

    user = getattr(request, 'user', None)
    requested_user_id = request.GET.get('user_id')
    
    # Prefer user from token (request.user) over query param
    if not isinstance(user, Employee):
        user = Employee.objects.filter(id=requested_user_id).first() if requested_user_id else None
    elif requested_user_id and str(requested_user_id) != str(user.id) and user.role != 'admin':
        # Security: if a specific user_id was requested but doesn't match token, only allow for admins
        return Response({'success': False, 'message': 'Unauthorized user_id access'}, status=403)

    # Include de-facto mentors (any user who has subordinates)
    is_mentor = user and (user.role == 'mentor' or (user.role != 'admin' and user.subordinates.exists()))

    search = request.GET.get('search', '').strip().lower()

    # Auto-mark absentees only after 7 PM (scheduler handles the main trigger)
    now = timezone.localtime(timezone.now())
    today = now.date()
    if now.hour >= 19:
        mark_absentees_for_date(today)

    try:
        records_qs = AttendanceRecord.objects.select_related('employee', 'office').all()

        # Apply global search if provided
        if search:
            from django.db.models import Q
            
            # Month mapping for searching by month name
            months = {
                'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
                'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
                'aug': 8, 'august': 8, 'sep': 9, 'september': 9, 'oct': 10, 'october': 10,
                'nov': 11, 'november': 11, 'dec': 12, 'december': 12
            }
            
            # Check if search term is a month name
            month_val = months.get(search)
            
            search_filter = Q(employee__name__icontains=search) | \
                            Q(employee__username__icontains=search) | \
                            Q(employee__department__icontains=search) | \
                            Q(office__name__icontains=search) | \
                            Q(status__icontains=search) | \
                            Q(type__icontains=search)
            
            if month_val:
                search_filter |= Q(date__month=month_val)
                
            # Handle specific date formats (e.g. 23-04-2026 or 2026-04-23)
            import re
            if re.match(r'^\d{2}-\d{2}-\d{4}$', search):
                try:
                    from datetime import datetime
                    d_obj = datetime.strptime(search, '%d-%m-%Y').date()
                    search_filter |= Q(date=d_obj)
                except: pass
            elif re.match(r'^\d{4}-\d{2}-\d{2}$', search):
                search_filter |= Q(date=search)
            elif search.isdigit() and len(search) == 4:
                search_filter |= Q(date__year=int(search))
            
            records_qs = records_qs.filter(search_filter)

        if is_mentor:
            from django.db.models import Q
            records_qs = records_qs.filter(Q(employee__mentors=user) | Q(employee=user)).distinct()

        if employee_id:
            records_qs = records_qs.filter(employee_id=employee_id)
        if start_date:
            records_qs = records_qs.filter(date__gte=start_date)
        if end_date:
            records_qs = records_qs.filter(date__lte=end_date)
        elif not search:
            # Default: only show records up to today (hide future-dated records)
            # But if searching, don't restrict to today by default unless requested
            records_qs = records_qs.filter(date__lte=today)

        if att_type:
            records_qs = records_qs.filter(type=att_type)

        records_qs = records_qs.distinct()

        has_more = False
        if days_limit:
            days_limit = int(days_limit)
            # Get unique dates in DESC order
            unique_dates = records_qs.values_list('date', flat=True).distinct().order_by('-date')
            total_days = unique_dates.count()
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
                'status': str(record.status or '').lower(),
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
                'role': record.employee.role,
                'date_of_joining': str(record.employee.profile.date_of_joining) if hasattr(record.employee, 'profile') and record.employee.profile.date_of_joining else None,
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



# --- Function: mark_absentees_for_date ---
def mark_absentees_for_date(target_date):
    try:

        all_employees = Employee.objects.filter(is_active=True).values_list('id', flat=True)
        existing_records = AttendanceRecord.objects.filter(date=target_date).values_list('employee_id', flat=True)

        absentees = set(all_employees) - set(existing_records)

        if absentees:
            new_records = [
                AttendanceRecord(
                    employee_id=emp_id,
                    date=target_date,
                    status='absent',
                    type='office',
                    total_hours=0
                ) for emp_id in absentees
            ]
            AttendanceRecord.objects.bulk_create(new_records, ignore_conflicts=True)

        # 2. Mark employees who checked in but forgot to check out as 'absent'
        # This applies if the day has ended (7 PM for today, or any past day)
        now = timezone.localtime(timezone.now())
        if target_date < now.date() or (target_date == now.date() and now.hour >= 19):
            AttendanceRecord.objects.filter(
                date=target_date,
                check_in_time__isnull=False,
                check_out_time__isnull=True
            ).exclude(
                status__in=['absent', 'leave']
            ).exclude(
                notes__icontains="Approved by Admin"
            ).update(
                status='absent',
                notes="Absent marked: Forgot to check out"
            )
        elif target_date == now.date() and now.hour < 19:
            # RESTORE logic: If they were accidentally marked absent (e.g. by the old 6 PM rule)
            # but it's not 7 PM yet, restore them to 'present' so they can check out.
            AttendanceRecord.objects.filter(
                date=target_date,
                status='absent',
                notes__icontains="Forgot to check out",
                check_in_time__isnull=False,
                check_out_time__isnull=True
            ).update(status='present', notes="Status restored (Workday ongoing)")
    except Exception as e:
        print(f"Error marking absentees: {e}")




# --- Function: monthly_stats ---
@api_view(['GET'])
@require_gated_token_api
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

        # Get employee profile for joining date and leave settings
        from attendance.models import EmployeeProfile
        profile = EmployeeProfile.objects.filter(employee_id=employee_id).first()
        joining_date = profile.date_of_joining if profile else None
        
        # Calculate monthly allowance and rollover
        # Logic: 1 CL per month. Jan-Dec cycle.
        current_year = int(year)
        current_month = int(month)
        
        # Determine start month (either January or joining month if in the same year)
        start_month = 1
        if joining_date and joining_date.year == current_year:
            start_month = joining_date.month
        elif joining_date and joining_date.year > current_year:
            # Not yet joined in the requested year
            start_month = 13 # Impossible month to show 0 balance
            
        # Total allowed leaves up to current viewed month
        # If viewed month < start_month, allowed = 0
        months_active_ytd = max(0, current_month - start_month + 1) if current_month >= start_month else 0
        total_allowed_upto_now = months_active_ytd # 1 per month
        
        # Yearly allowance (total for the year based on joining date)
        yearly_allowance = max(0, 12 - start_month + 1) if start_month <= 12 else 0
        
        # Total taken leaves in the WHOLE year (Full = 1, Half = 0.5)
        yearly_leaves_qs = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type__in=['full_day', 'half_day'],
            status='approved',
            start_date__year=current_year
        ).order_by('start_date')
        
        yearly_taken = 0.0
        yearly_leave_dates = []
        for req in yearly_leaves_qs:
            val = 1.0 if req.request_type == 'full_day' else 0.5
            yearly_taken += val
            yearly_leave_dates.append({
                'date': req.start_date.strftime('%Y-%m-%d'),
                'type': req.request_type
            })

        # Total taken leaves in this year up to the viewed month
        # ... and so on
        full_ytd = EmployeeRequest.objects.filter(
            employee_id=employee_id, request_type='full_day', status='approved',
            start_date__year=current_year, start_date__month__lte=current_month
        ).count()
        half_ytd = EmployeeRequest.objects.filter(
            employee_id=employee_id, request_type='half_day', status='approved',
            start_date__year=current_year, start_date__month__lte=current_month
        ).count()
        taken_leaves_ytd = float(full_ytd) + (float(half_ytd) * 0.5)
        
        # Taken in the current viewed month
        leaves_qs = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type__in=['full_day', 'half_day'],
            status='approved',
            start_date__year=current_year,
            start_date__month=current_month
        ).order_by('start_date')
        
        taken_this_month = 0.0
        leave_dates = []
        for req in leaves_qs:
            val = 1.0 if req.request_type == 'full_day' else 0.5
            taken_this_month += val
            leave_dates.append({
                'date': req.start_date.strftime('%Y-%m-%d'),
                'type': req.request_type
            })
        
        # Rollover from previous months in the same year
        allowance_this_month = 1 if current_month >= start_month else 0
        rollover = max(0, (total_allowed_upto_now - allowance_this_month) - (taken_leaves_ytd - taken_this_month))
        
        total_left_ytd = max(0, float(total_allowed_upto_now) - taken_leaves_ytd)
        yearly_left = max(0, float(yearly_allowance) - yearly_taken)

        from django.db.models import Count, Case, When, Sum, Q
        stats_data = records.aggregate(
            total_working_days=Count(Case(When(status__in=['present', 'half_day', 'wfh', 'client'], then=1))),
            weekday_present_days=Count(Case(When(Q(status__in=['present', 'half_day', 'wfh', 'client']) & Q(date__week_day__in=[2, 3, 4, 5, 6, 7]), then=1))),
            total_hours_sum=Sum('total_hours'),
            half_day_records=Count(Case(When(is_half_day=True, then=1))),
            wfh_days=Count(Case(When(type='wfh', then=1))),
            office_days=Count(Case(When(type='office', status='present', then=1))),
            client_days=Count(Case(When(type='client', then=1))),
            leave_records=Count(Case(When(status='leave', then=1))),
        )

        half_day_requests = EmployeeRequest.objects.filter(
            employee_id=employee_id,
            request_type='half_day',
            status='approved',
            start_date__year=year,
            start_date__month=month
        ).count()

        total_half_days = max(stats_data['half_day_records'], half_day_requests)

        # Count optional holidays for the year (Max 2)
        optional_holidays_count = UserHoliday.objects.filter(
            user_id=employee_id,
            holiday__year=year
        ).count()

        stats = {
            'total_working_days': stats_data['total_working_days'],
            'weekday_present_days': stats_data['weekday_present_days'],
            'total_hours': float(stats_data['total_hours_sum'] or 0),
            'half_days': total_half_days,
            'wfh_days': stats_data['wfh_days'],
            'office_days': stats_data['office_days'],
            'client_days': stats_data['client_days'],
            'leave_days': taken_this_month,
            'leave_allowance': allowance_this_month,
            'leave_rollover': rollover,
            'leave_total_left': total_left_ytd,
            'yearly_taken': yearly_taken,
            'yearly_allowance': yearly_allowance,
            'yearly_left': yearly_left,
            'optional_holidays': optional_holidays_count,
            'max_optional': 2,
            'leave_dates': leave_dates,
            'yearly_leave_dates': yearly_leave_dates,
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




# --- Function: wfh_eligibility ---
@api_view(['GET'])
@require_gated_token_api
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




# --- Function: wfh_request ---
@api_view(['POST'])
@require_gated_token_api
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
        req = EmployeeRequest.objects.create(
            employee_id=employee_id,
            request_type='wfh',
            start_date=requested_date,
            end_date=requested_date,
            reason=reason,
            status='pending'
        )
        
        # Notify mentors
        emp = Employee.objects.get(id=employee_id)
        for mentor in emp.mentors.all():
            _send_task_notification(mentor, f"{emp.name} requested WFH for {requested_date}", req.id, type="request")

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


# --- Function: attendance_record_detail ---
@api_view(['GET', 'POST', 'DELETE'])
@require_gated_token_api
@parser_classes([JSONParser])
def attendance_record_detail(request, record_id):
    """Get, update, or delete an attendance record (admin only)"""
    # Verify caller is an admin
    caller = get_current_user(request, require_admin=True)
    if not caller:
        return Response({'success': False, 'message': 'Admin access required'}, status=403)

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

        if record.status in ['present', 'half_day', 'wfh', 'client']:
            if not record.notes:
                record.notes = "Approved by Admin"
            elif "Approved by Admin" not in record.notes:
                record.notes = f"{record.notes} - Approved by Admin"

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



# --- Function: wfh_request_reject ---
@api_view(['POST'])
@require_gated_token_api
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
        from ..models import EmployeeRequest
        wfh_request = EmployeeRequest.objects.get(id=request_id)
        wfh_request.status = 'rejected'
        wfh_request.admin_response = reason
        wfh_request.reviewed_at = timezone.now()
        # Set reviewed_by to current authenticated user
        request_user = getattr(request, 'user', None)
        if isinstance(request_user, Employee):
            wfh_request.reviewed_by = request_user
        else:
            admin_user = Employee.objects.filter(role='admin').first()
            if admin_user:
                wfh_request.reviewed_by = admin_user
        wfh_request.save()

        # Notify Employee of rejection
        reviewer_name = wfh_request.reviewed_by.name if wfh_request.reviewed_by else "Admin"
        notif_msg = f"Your WFH request for {wfh_request.start_date} has been rejected by {reviewer_name}."
        if reason:
            notif_msg += f" Note: {reason}"
        _send_task_notification(wfh_request.employee, notif_msg, wfh_request.id, type="request")

        return Response({
            'success': True,
            'message': 'WFH request rejected'
        })
    except EmployeeRequest.DoesNotExist:
        return Response({
            'success': False,
            'message': 'WFH request not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to reject request'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# --- Function: wfh_request_approve ---
@api_view(['POST'])
@require_gated_token_api
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
            request_user = getattr(request, 'user', None)
            if isinstance(request_user, Employee):
                request_obj.reviewed_by = request_user
            else:
                admin_user = Employee.objects.filter(role='admin').first()
                if admin_user:
                    request_obj.reviewed_by = admin_user

        request_obj.save()

        # Notify Employee of the decision
        reviewer_name = request_obj.reviewed_by.name if request_obj.reviewed_by else "Admin"
        notif_msg = f"Your {request_obj.request_type.upper()} request for {request_obj.start_date} has been {status_val} by {reviewer_name}."
        if admin_response:
            notif_msg += f" Note: {admin_response}"
        _send_task_notification(request_obj.employee, notif_msg, request_obj.id, type="request")

        # If approved, handle based on request type
        if status_val == 'approved':
            req_type = request_obj.request_type
            
            # 1. Determine attendance record settings
            if req_type == 'wfh':
                attendance_status = 'wfh'
                attendance_type = 'wfh'
                is_half = False
            elif req_type == 'full_day':
                attendance_status = 'leave'
                attendance_type = 'office'
                is_half = False
            elif req_type == 'half_day':
                attendance_status = 'half_day'
                attendance_type = 'office'
                is_half = True
            elif req_type == 'optional_holiday':
                # 'holiday' is not in STATUS_CHOICES, use 'leave' with notes
                attendance_status = 'leave'
                attendance_type = 'office'
                is_half = False
            else:
                attendance_status = 'leave'
                attendance_type = 'office'
                is_half = False

            # 2. Update attendance records for the date range
            if req_type != 'unblock_attendance' and req_type != 'task_request':
                from datetime import timedelta
                current_date = request_obj.start_date
                while current_date <= request_obj.end_date:
                    AttendanceRecord.objects.update_or_create(
                        employee=request_obj.employee,
                        date=current_date,
                        defaults={
                            'type': attendance_type,
                            'status': attendance_status,
                            'is_half_day': is_half,
                            'notes': f'Approved request ({req_type})',
                        }
                    )
                    current_date += timedelta(days=1)
            
            # 3. Update Leave Balance for CL if applicable
            if req_type in ['full_day', 'half_day']:
                try:
                    profile = request_obj.employee.profile
                    increment = 1.0 if req_type == 'full_day' else 0.5
                    num_days = (request_obj.end_date - request_obj.start_date).days + 1
                    profile.taken_cl += (increment * num_days)
                    profile.save()
                except Exception as e:
                    print(f"Error updating leave balance: {e}")

        elif status_val == 'rejected':
            # Revert attendance records for the range if they were previously auto-created/updated
            req_type = request_obj.request_type
            if req_type != 'unblock_attendance' and req_type != 'task_request':
                from datetime import timedelta
                current_date = request_obj.start_date
                while current_date <= request_obj.end_date:
                    # Only revert if it matches the current request's expected approved status
                    # to avoid accidentally reverting a 'present' record if someone worked anyway
                    AttendanceRecord.objects.filter(
                        employee=request_obj.employee,
                        date=current_date,
                        status__in=['wfh', 'leave', 'half_day']
                    ).update(status='absent', notes=f'Request rejected ({req_type})')
                    current_date += timedelta(days=1)

        return Response({
            'success': True,
            'message': f'Request {status_val}'
        })
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return Response({
            'success': False,
            'message': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: unblock_attendance ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def unblock_attendance(request):
    """Create a request to unblock attendance after 3 consecutive missed checkouts"""
    try:
        data = request.data
        employee_id = data.get('employee_id')
        
        if not employee_id:
            return Response({'success': False, 'message': 'Missing employee ID'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)

        # Check if an active pending/approved request already exists
        now_local = timezone.localtime(timezone.now()).date()
        recent_req = EmployeeRequest.objects.filter(
            employee=employee,
            request_type='unblock_attendance'
        ).order_by('-created_at').first()

        if recent_req and recent_req.status == 'pending':
            return Response({'success': False, 'message': 'An unblock request is already pending.'}, status=status.HTTP_400_BAD_REQUEST)
        if recent_req and recent_req.status == 'approved' and recent_req.created_at.date() == now_local:
            return Response({'success': False, 'message': 'Attendance is already unblocked for today.'}, status=status.HTTP_400_BAD_REQUEST)

        # Create request using today's date for start and end date as placeholders
        req = EmployeeRequest.objects.create(
            employee=employee,
            request_type='unblock_attendance',
            start_date=now_local,
            end_date=now_local,
            reason='Automated request: 3 consecutive missed check-outs.',
            status='pending'
        )

        # Notify admins
        admins = Employee.objects.filter(role='admin')
        for admin in admins:
            _send_task_notification(admin, f"Unblock request for {employee.name} (Missed Check-outs)", req.id, type="request")

        return Response({'success': True, 'message': 'Unblock request submitted to Admin successfully.'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# --- Function: leave_request ---
@api_view(['POST'])
@require_gated_token_api
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

                req = EmployeeRequest.objects.create(
                    employee=employee,
                    request_type=r_type,
                    start_date=req_date,
                    end_date=req_date,
                    reason=reason,
                    status='pending',
                    half_day_period=period if r_type == 'half_day' else None
                )
                
                # Notify mentors
                for mentor in employee.mentors.all():
                    _send_task_notification(mentor, f"{employee.name} requested {r_type.replace('_', ' ')} for {req_date}", req.id, type="request")
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




# --- Function: leave_request_approve ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def leave_request_approve(request):
    """Approve or reject a leave request (admin/mentor only)"""
    # Verify caller is admin or mentor
    caller = get_current_user(request)
    if not caller or caller.role not in ('admin', 'mentor'):
        # Also allow de-facto mentors who have subordinates
        if not caller or not caller.subordinates.exists():
            return Response({'success': False, 'message': 'Admin or Mentor access required'}, status=403)

    try:
        data = request.data
        request_id = data.get('request_id')
        status_val = data.get('status', 'approved') # approved or rejected
        admin_response = data.get('admin_response', '')
        reviewer_id = data.get('reviewed_by')

        try:
            req = EmployeeRequest.objects.get(id=request_id)
        except EmployeeRequest.DoesNotExist:
            return Response({'success': False, 'message': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

        req.status = status_val
        req.admin_response = admin_response
        req.reviewed_at = timezone.now()
        
        if reviewer_id:
            try:
                req.reviewed_by = Employee.objects.get(id=reviewer_id)
            except:
                pass

        if not req.reviewed_by:
            request_user = getattr(request, 'user', None)
            if isinstance(request_user, Employee):
                req.reviewed_by = request_user
            else:
                admin_user = Employee.objects.filter(role='admin').first()
                if admin_user:
                    req.reviewed_by = admin_user

        req.save()

        # Notify Employee of the decision
        reviewer_name = req.reviewed_by.name if req.reviewed_by else "Admin"
        notif_msg = f"Your {req.request_type.upper()} request for {req.start_date} has been {status_val} by {reviewer_name}."
        if admin_response:
            notif_msg += f" Note: {admin_response}"
        _send_task_notification(req.employee, notif_msg, req.id, type="request")

        # If approved, create or update AttendanceRecord to reflect in calendar
        if status_val == 'approved':
            req_type = req.request_type
            
            # Unblock requests do not create attendance records, they just lift the check-in block
            if req_type != 'unblock_attendance' and req_type != 'task_request':
                if req_type == 'wfh':
                    attendance_status = 'wfh'
                    attendance_type = 'wfh'
                elif req_type == 'full_day':
                    attendance_status = 'leave'
                    attendance_type = 'office'
                elif req_type == 'half_day':
                    attendance_status = 'half_day'
                    attendance_type = 'office'
                elif req_type == 'optional_holiday':
                    attendance_status = 'leave' # 'holiday' is not in STATUS_CHOICES
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

                # Update Leave Balance for CL
                if req_type in ['full_day', 'half_day']:
                    try:
                        profile = req.employee.profile
                        increment = 1.0 if req_type == 'full_day' else 0.5
                        num_days = (req.end_date - req.start_date).days + 1
                        profile.taken_cl += (increment * num_days)
                        profile.save()
                    except Exception as e:
                        print(f"Error updating leave balance: {e}")
        
        elif status_val == 'rejected':
            # Revert attendance records if previously approved
            req_type = req.request_type
            if req_type != 'unblock_attendance' and req_type != 'task_request':
                from datetime import timedelta
                current_date = req.start_date
                while current_date <= req.end_date:
                    AttendanceRecord.objects.filter(
                        employee=req.employee,
                        date=current_date,
                        status__in=['wfh', 'leave', 'half_day']
                    ).update(status='absent', notes=f'Request rejected ({req_type})')
                    current_date += timedelta(days=1)

        return Response({'success': True, 'message': f'Request {status_val}'})
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)





# --- Function: mentor_status ---
@api_view(['GET'])
@require_gated_token_api
@parser_classes([JSONParser])
def mentor_status(request):
    """Get today's attendance status for all mentors of the current employee"""
    employee_id = request.query_params.get('employee_id')
    
    if not employee_id:
        return Response({'success': False, 'message': 'Employee ID is required'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        employee = Employee.objects.get(id=employee_id)
        mentors = employee.mentors.all()
        
        mentor_data = []
        today = timezone.localtime(timezone.now()).date()
        
        for mentor in mentors:
            status = 'Absent'
            record = AttendanceRecord.objects.filter(employee=mentor, date=today).first()
            if record:
                status = record.status
                
            try:
                profile = EmployeeProfile.objects.get(employee=mentor)
                avatar = profile.avatar_url or profile.avatar_emoji or '👤'
                bg = profile.theme_settings.get('avatarTextBg', '#2563eb') if profile.theme_settings else '#2563eb'
            except EmployeeProfile.DoesNotExist:
                avatar = '👤'
                bg = '#2563eb'
                
            mentor_data.append({
                'id': mentor.id,
                'name': mentor.name,
                'role': mentor.role,
                'status': status,
                'avatar': avatar,
                'bg': bg
            })
            
        return Response({
            'success': True,
            'mentors': mentor_data
        })
        
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ========== Web Push Notification API ==========



# --- Function: manage_date ---
@api_view(['POST'])
@require_gated_token_api
def manage_date(request):
    """
    Directly manage a date's holiday/working status.
    Admin only.
    """
    user_id = request.data.get('user_id')
    employee = Employee.objects.filter(id=user_id, role='admin').first()
    if not employee:
        return Response({'success': False, 'message': 'Admin access required.'}, status=403)

    date_str = request.data.get('date')
    date_type = request.data.get('type') # 'working', 'holiday', 'optional'
    reason = request.data.get('reason', '')

    if not date_str:
        return Response({'success': False, 'message': 'Date is required.'}, status=400)

    try:
        from datetime import datetime
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        
        # Determine status flags
        is_optional = (date_type == 'optional')
        is_working = (date_type == 'working')
        
        existing_holiday = Holiday.objects.filter(date=target_date).first()
        
        msg = ""
        import calendar as cal_mod
        day_name = cal_mod.day_name[target_date.weekday()]

        if date_type == 'working':
            Holiday.objects.update_or_create(
                date=target_date,
                defaults={
                    'name': reason or "Working Day",
                    'is_optional': False,
                    'is_working_day': True,
                    'day': day_name,
                    'year': target_date.year
                }
            )
            msg = f"marked as Working Day: {reason or 'Regular'}"
        else:
            # Set as Holiday or Optional
            Holiday.objects.update_or_create(
                date=target_date,
                defaults={
                    'name': reason or ('Optional Holiday' if is_optional else 'Public Holiday'),
                    'is_optional': is_optional,
                    'is_working_day': False,
                    'day': day_name,
                    'year': target_date.year
                }
            )
            type_label = "Optional Holiday" if is_optional else "Mandatory Holiday"
            msg = f"set as {type_label}: {reason or 'Scheduled'}"

        # Notify EVERYONE
        all_employees = Employee.objects.filter(is_active=True)
        notifications = []
        for emp in all_employees:
            notifications.append(Notification(
                user=emp,
                type='holiday_update',
                message=f"Admin updated calendar for {date_str}: Now {msg}."
            ))
        Notification.objects.bulk_create(notifications)

        return Response({'success': True, 'message': f"Date {date_str} {msg}."})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=500)




# --- Function: select_optional_holiday ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def select_optional_holiday(request):
    """
    Employee selects / deselects an optional holiday.
    Enforces max 2 optional selections per year.
    Body: { user_id, holiday_id, action: 'select'|'deselect' }
    """
    MAX_OPTIONAL = 2

    user_id = request.data.get('user_id')
    holiday_id = request.data.get('holiday_id')
    action = request.data.get('action', 'select')

    if not user_id or not holiday_id:
        return Response({'success': False, 'message': 'user_id and holiday_id are required.'}, status=400)

    try:
        employee = Employee.objects.get(id=user_id)
        holiday = Holiday.objects.get(id=holiday_id, is_optional=True)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found.'}, status=404)
    except Holiday.DoesNotExist:
        return Response({'success': False, 'message': 'Optional holiday not found.'}, status=404)

    if action == 'deselect':
        UserHoliday.objects.filter(user=employee, holiday=holiday).delete()
        return Response({'success': True, 'message': 'Holiday deselected.'})

    # Check limit
    existing_count = UserHoliday.objects.filter(
        user=employee, holiday__year=holiday.year
    ).count()
    if existing_count >= MAX_OPTIONAL:
        return Response({
            'success': False,
            'message': f'You can select at most {MAX_OPTIONAL} optional holidays per year.'
        }, status=400)

    uh, created = UserHoliday.objects.get_or_create(user=employee, holiday=holiday)
    if not created:
        return Response({'success': False, 'message': 'Holiday already selected.'}, status=400)

    return Response({'success': True, 'message': 'Optional holiday selected successfully.'})




