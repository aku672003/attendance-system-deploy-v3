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

from ..intelligence_hub import (
    IndividualPredictor, AttendanceMLModel, SLMInsightGenerator, train_forecast_model,
    calculate_forecast, calculate_hybrid_forecast
)

# --- Function: predict_attendance ---
@api_view(['GET'])
@require_gated_token_api
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




# --- Function: employee_performance_analysis ---
@api_view(['GET'])
@require_gated_token_api
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

        history = []
        now_local = timezone.localtime(timezone.now())
        
        for r in records:
            hours = float(r.total_hours)
            
            # If currently checked in but not checked out, calculate hours so far
            if not r.check_out_time and r.check_in_time and r.date == now_local.date():
                try:
                    check_in_t = datetime.strptime(str(r.check_in_time), '%H:%M:%S').time()
                    check_in_dt = timezone.make_aware(datetime.combine(r.date, check_in_t))
                    # Calculate hours since check-in
                    hours = round((now_local - check_in_dt).total_seconds() / 3600, 2)
                    # Cap at a reasonable max (e.g. 14h) to avoid outliers if they forgot to check out yesterday 
                    # (though r.date == now_local.date() handles today)
                    hours = max(0.0, min(hours, 14.0))
                except Exception:
                    pass
            
            history.append({
                'date': r.date.strftime('%Y-%m-%d'),
                'status': r.status,
                'type': r.type,
                'hours': hours
            })

        # 2. Performance Metrics
        num_days = (end_date - start_date).days + 1
        num_weeks = max(num_days / 7.0, 0.1) # Avoid division by zero, min 0.1 weeks
        
        # Calculate working days passed for regularity
        calc_end_date = min(end_date, today)
        if start_date <= calc_end_date:
            passed_days = (calc_end_date - start_date).days + 1
            working_days_passed = sum(1 for d in range(passed_days) if Holiday.is_date_working(start_date + timedelta(days=d)))
        else:
            working_days_passed = 0

        weekday_present_days = records.filter(
            date__week_day__in=[2, 3, 4, 5, 6, 7],
            status__in=['present', 'half_day', 'wfh', 'client']
        ).count()

        
        # Calculate Mon-Fri Avg
        weekday_records = records.filter(
            date__week_day__in=[2, 3, 4, 5, 6, 7] # Mon-Sat (2=Mon... 7=Sat)
        ).aggregate(
            sum_hours=Sum('total_hours')
        )
        # Fixed denominator logic as per user request: (num_weeks * 5)
        total_weekday_hours = float(weekday_records['sum_hours'] or 0)
        weekday_avg = total_weekday_hours / (num_weeks * 6)

        # Calculate Sat-Sun Avg
        weekend_records = records.filter(
            date__week_day__in=[1] # Sun (1) only
        ).aggregate(
            sum_hours=Sum('total_hours')
        )
        # Fixed denominator logic: (num_weeks * 1)
        total_weekend_hours = float(weekend_records['sum_hours'] or 0)
        saturday_avg = total_weekend_hours / (num_weeks * 1)



        summary_stats = records.aggregate(
            total_present=Count('id', filter=Q(status__in=['present', 'half_day', 'wfh', 'client'])),
            sum_hours=Sum('total_hours'),
            wfh_count=Count('id', filter=Q(type='wfh', status__in=['present', 'half_day', 'wfh', 'client'])),
            office_count=Count('id', filter=Q(type='office', status__in=['present', 'half_day', 'wfh', 'client']))
        )

        # Sanitize: cap each present record's hours at 14h before computing any
        # hour-based metric.  This prevents corrupted checkout records (where the
        # fallback logic picked up an unclosed record from a previous day and
        # computed hours spanning multiple calendar days, capped at 99.90h in the
        # DB) from inflating weekly/daily averages into the hundreds.
        MAX_HOURS_PER_DAY = 14.0
        capped_hours_sum = sum(
            min(float(r.total_hours or 0), MAX_HOURS_PER_DAY)
            for r in records
            if r.status in ['present', 'half_day', 'wfh', 'client']
        )
        # Keep the raw DB sum available for other uses (regular/OT split below)
        total_hours_sum = float(summary_stats['sum_hours'] or 0)

        # Weekly average uses the sanitized sum and the actual number of weeks
        # in the filtered period (never hardcoded 4).
        if is_monthly_view:
            weekly_avg_hours = capped_hours_sum / 4.33
        elif is_weekly_view:
            weekly_avg_hours = capped_hours_sum  # Single week: total IS the average
        else:
            weekly_avg_hours = capped_hours_sum / num_weeks

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

        # Create predictive graph data for individual
        predict_days = int(request.GET.get('predict_days', 3))
        history_days = 3
        history_points = []

        graph_dates = []
        for i in range(history_days, 0, -1):
            graph_dates.append(today - timedelta(days=i))
        graph_dates.append(today)

        for d in graph_dates:
            r = AttendanceRecord.objects.filter(employee=employee, date=d).first()
            if r:
                hours = float(r.total_hours or 0)
                if not r.check_out_time and r.check_in_time and r.date == now_local.date():
                    try:
                        check_in_t = datetime.strptime(str(r.check_in_time), '%H:%M:%S').time()
                        check_in_dt = timezone.make_aware(datetime.combine(r.date, check_in_t))
                        hours = round((now_local - check_in_dt).total_seconds() / 3600, 2)
                        hours = max(0.0, min(hours, 14.0))
                    except: pass
                
                if r.status == 'half_day' or getattr(r, 'is_half_day', False):
                    hours = max(hours, 4.5)
            else:
                hours = 0.0

            if d == today:
                day_name = 'Today'
            elif d == today - timedelta(days=1):
                day_name = 'Yesterday'
            else:
                day_name = d.strftime('%A')
            
            history_points.append({
                'date': d.strftime('%Y-%m-%d'),
                'day_name': day_name,
                'hours': hours,
                'is_prediction': False
            })

        # Calculate Prediction Peak scaling from history to avoid "stuck at 9h"
        max_seen = max([p['hours'] for p in history_points] + [9.0])
        limit_hours = min(12.0, max_seen)

        from ..intelligence_hub import calculate_multi_day_forecast, IndividualPredictor
        multi_forecast = calculate_multi_day_forecast(predict_days)
        org_forecast_map = {f['date']: f['rate'] for f in multi_forecast}
        individual_engine = IndividualPredictor()

        graph_data = history_points.copy()

        for i in range(1, predict_days + 1):
            target_date = today + timedelta(days=i)
            target_date_str = target_date.strftime('%Y-%m-%d')
            current_org_forecast = org_forecast_map.get(target_date_str, 85.0)
            
            base_prob = individual_engine.predict(employee, current_org_forecast, target_date=target_date)
            
            if target_date.weekday() >= 5:
                pred_hours = 0.0
            else:
                # Real-time logic: Predict hours based on DOW historical pattern + attendance probability
                pred_hours = individual_engine.predict_hours(employee, base_prob, target_date)
            
            graph_data.append({
                'date': target_date_str,
                'day_name': target_date.strftime('%A'),
                'hours': round(pred_hours, 1),
                'is_prediction': True
            })

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
        # Improved: Include tasks that were either created in this range, completed in this range, OR are currently active
        tasks_base = Task.objects.filter(assignees=employee).filter(
            Q(created_at__date__range=[start_date, end_date]) |
            Q(completed_at__date__range=[start_date, end_date]) |
            Q(status__in=['todo', 'in_progress'])
        ).distinct()
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

            # Blend with manual Mentor accuracy if it exists (50/50 balance)
            if t.accuracy:
                task_score = (task_score + t.accuracy) / 2

            total_accuracy_points += task_score
            tasks_evaluated += 1

        avg_accuracy = total_accuracy_points / tasks_evaluated if tasks_evaluated > 0 else (70.0 if tasks_base.filter(status='in_progress').exists() else 0.0)
        avg_span_h = total_span_hours / (spans_counted or 1)
        
        total_assigned = tasks_base.count()
        completed_count = completed_tasks.count()
        in_progress_count = tasks_base.filter(status='in_progress').count()

        # Weighted Completion logic: Completed tasks (1.0) + In Progress (0.5)
        weighted_completion = completed_count + (in_progress_count * 0.5)
        completion_rate = (weighted_completion / total_assigned * 100) if total_assigned > 0 else 100.0
        
        work_efficiency = (completion_rate * 0.4) + (avg_accuracy * 0.6)

        task_stats = {
            'total_assigned': total_assigned,
            'todo': tasks_base.filter(status='todo').count(),
            'in_progress': tasks_base.filter(status='in_progress').count(),
            'completed': completed_count,
            'avg_accuracy': round(float(avg_accuracy), 1),
            'work_efficiency': round(float(work_efficiency), 1),
            'avg_span_hours': round(float(avg_span_h), 1)
        }

        # Calculate Regular vs Overtime Hours (Standard 8h)
        total_reg_h = 0
        total_ot_h = 0
        for r in records:
            h = float(r.total_hours or 0)
            reg = min(h, 9.0)
            ot = max(0.0, h - 9.0)
            total_reg_h += reg
            total_ot_h += ot
        
        total_all_h = total_reg_h + total_ot_h
        ot_ratio = round((total_ot_h / total_all_h) * 100, 1) if total_all_h > 0 else 0
        reg_ratio = round((total_reg_h / total_all_h) * 100, 1) if total_all_h > 0 else 0

        profile = employee.profile if hasattr(employee, 'profile') else None

        # Calculate Peak Day (Best Day) based on history (Mon-Fri only)
        dow_counts = {0:0, 1:0, 2:0, 3:0, 4:0, 5:0} # Mon-Sat
        for r in records:
            if r.status in ['present', 'half_day', 'wfh', 'client'] and r.date.weekday() < 6:
                dow_counts[r.date.weekday()] += 1
        
        best_dow = max(dow_counts, key=dow_counts.get) if any(dow_counts.values()) else 0
        day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        peak_day_individual = day_names[best_dow]

        # Advanced Predictions from Engine
        from ..attendance_prediction import AttendancePredictionEngine
        engine = AttendancePredictionEngine(employee.id)
        leave_probs = engine.predict_leaves()
        tomorrow_leave_prob = leave_probs.get(tomorrow.weekday(), 0)
        predicted_hrs = engine.predict_working_hours()

        return Response({
            'success': True,
            'employee_name': employee.name,
            'department': employee.department,
            'email': employee.email,
            'avatar_emoji': profile.avatar_emoji if profile else "👤",
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
                'avg_hours_present': round(capped_hours_sum / (summary_stats['total_present'] or 1), 1),
                'weekday_avg': round(weekday_avg, 1),
                'saturday_avg': round(saturday_avg, 1),

                'wfh_ratio': round((summary_stats['wfh_count'] / (summary_stats['total_present'] or 1)) * 100, 1) if summary_stats['total_present'] else 0,
                'office_ratio': round((summary_stats['office_count'] / (summary_stats['total_present'] or 1)) * 100, 1) if summary_stats['total_present'] else 0,
                'ot_ratio': ot_ratio,
                'reg_ratio': reg_ratio,
                'total_reg_h': round(total_reg_h, 1),
                'total_ot_h': round(total_ot_h, 1),
                'weekly_avg_hours': round(weekly_avg_hours, 1),
                'avg_check_in': avg_check_in,
                'avg_check_out': avg_check_out,
                'working_days_passed': working_days_passed,
                'weekday_present_days': weekday_present_days
            },
            'tasks': task_stats,
            'prediction': {
                'likelihood': round(prediction_score, 1),
                'tomorrow_day': tomorrow.strftime('%A'),
                'peak_day': peak_day_individual,
                'habit_summary': f"Usually present on {tomorrow.strftime('%A')}s" if prediction_score > 70 else f"Irregular pattern on {tomorrow.strftime('%A')}s",
                'graph_data': graph_data,
                'leave_probability': tomorrow_leave_prob,
                'predicted_daily_hours': predicted_hrs
            }
        })
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: request_new_task ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def request_new_task(request):
    """Employee requests a new task from their mentor"""
    user_id = request.data.get('user_id')
    if not user_id:
        return Response({'success': False, 'message': 'User ID required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        user = Employee.objects.get(id=user_id)
        
        # Check if already has a pending task request
        existing = EmployeeRequest.objects.filter(
            employee=user,
            request_type='task_request',
            status='pending'
        ).exists()
        
        if existing:
            return Response({'success': False, 'message': 'You already have a pending task request sent to your mentor.'})
            
        req = EmployeeRequest.objects.create(
            employee=user,
            request_type='task_request',
            start_date=timezone.now().date(),
            end_date=timezone.now().date(),
            reason='New task request from Task Manager V2',
            status='pending'
        )

        # Notify mentors or admins
        mentors = user.mentors.all()
        if not mentors.exists():
            # Fallback to admins
            mentors = Employee.objects.filter(role='admin', is_active=True)
        
        notif_msg = f"{user.name} has requested a new task assignment."
        for mentor in mentors:
            _send_task_notification(
                user=mentor,
                message=notif_msg,
                task_id=f"req_{req.id}",
                type="request"
            )
        
        return Response({'success': True, 'message': 'Task request sent successfully to your mentor/admin!'})
        
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# --- Function: attendance_predictions ---
@api_view(['GET'])
@require_gated_token_api
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
        from ..attendance_prediction import get_all_employees_predictions
        
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


# ========== Company Predictive Report API ==========



# --- Function: company_predictive_report ---
@api_view(['GET'])
@require_gated_token_api
def company_predictive_report(request):
    """
    Generate a company-wide predictive attendance report.
    Query params:
        start_date  (YYYY-MM-DD)  — default 30 days ago
        end_date    (YYYY-MM-DD)  — default today
    Returns summary + per-employee predictive metrics.
    """
    try:
        from datetime import date, timedelta, datetime as dt
        from ..models import Employee, AttendanceRecord

        today = timezone.localtime(timezone.now()).date()

        start_str = request.GET.get('start_date')
        end_str   = request.GET.get('end_date')

        try:
            start_date = dt.strptime(start_str, '%Y-%m-%d').date() if start_str else today - timedelta(days=30)
            end_date   = dt.strptime(end_str,   '%Y-%m-%d').date() if end_str   else today
        except ValueError:
            return Response({'success': False, 'message': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)

        # Enforce max 30-day window
        if (end_date - start_date).days > 30:
            return Response({'success': False, 'message': 'Date range cannot exceed 30 days.'}, status=400)
        if end_date > today:
            end_date = today

        total_days   = (end_date - start_date).days + 1
        working_days = sum(1 for i in range(total_days)
                           if Holiday.is_date_working(start_date + timedelta(days=i)))

        employees = Employee.objects.filter(is_active=True).exclude(role='admin').order_by('department', 'name')

        # Aggregate all records in range in one query
        records_qs = AttendanceRecord.objects.filter(
            date__range=[start_date, end_date],
            employee__is_active=True
        ).select_related('employee').values(
            'employee_id', 'employee__name', 'employee__department',
            'date', 'status', 'type', 'check_in_time', 'check_out_time', 'total_hours'
        )

        # Group by employee
        from collections import defaultdict
        emp_records = defaultdict(list)
        for r in records_qs:
            emp_records[r['employee_id']].append(r)

        # Company totals
        company_present = 0
        company_wfh     = 0
        company_absent  = 0
        company_leave   = 0
        company_half    = 0

        per_employee = []

        for emp in employees:
            recs = emp_records.get(emp.id, [])
            present  = sum(1 for r in recs if r['status'] == 'present')
            wfh      = sum(1 for r in recs if r['status'] == 'wfh')
            half_day = sum(1 for r in recs if r['status'] == 'half_day')
            leave    = sum(1 for r in recs if r['status'] == 'leave')
            absent   = sum(1 for r in recs if r['status'] == 'absent')
            attended = present + wfh + half_day

            att_rate = round((attended / working_days) * 100) if working_days > 0 else 0

            # Check-in times for avg
            check_in_times = [r['check_in_time'] for r in recs if r['check_in_time']]
            avg_checkin = None
            if check_in_times:
                total_mins = sum(t.hour * 60 + t.minute for t in check_in_times)
                avg_m = total_mins // len(check_in_times)
                avg_checkin = f"{avg_m // 60:02d}:{avg_m % 60:02d}"

            # Total hours
            total_hours = sum(float(r['total_hours'] or 0) for r in recs)
            avg_hours   = round(total_hours / attended, 1) if attended > 0 else 0

            # Simple trend: compare first half vs second half of period
            mid = start_date + timedelta(days=total_days // 2)
            first_half  = sum(1 for r in recs if r['date'] < mid and r['status'] in ('present','wfh','half_day'))
            second_half = sum(1 for r in recs if r['date'] >= mid and r['status'] in ('present','wfh','half_day'))
            trend = 'up' if second_half > first_half else ('down' if second_half < first_half else 'stable')

            # Predictive likelihood (simple heuristic based on recent rate)
            likelihood = min(int(att_rate * 1.05), 100)

            # Daily attendance rate time-series (for mini chart)
            day_series = []
            for i in range(total_days):
                d = start_date + timedelta(days=i)
                if d.weekday() >= 6:  # skip Sunday
                    continue
                day_rec = next((r for r in recs if r['date'] == d), None)
                status  = day_rec['status'] if day_rec else 'absent'
                day_series.append({
                    'date':    str(d),
                    'day':     d.strftime('%a'),
                    'status':  status,
                    'present': 1 if status in ('present', 'wfh', 'half_day') else 0
                })

            company_present += present
            company_wfh     += wfh
            company_absent  += absent
            company_leave   += leave
            company_half    += half_day

            # Advanced Predictions from Engine
            from ..attendance_prediction import AttendancePredictionEngine
            engine = AttendancePredictionEngine(emp.id)
            leave_probs = engine.predict_leaves()
            # Average leave probability for this employee
            avg_leave_prob = round(sum(leave_probs.values()) / 7, 2)
            predicted_hrs_val = engine.predict_working_hours()

            per_employee.append({
                'id':          emp.id,
                'name':        emp.name,
                'department':  emp.department,
                'role':        emp.role,
                'att_rate':    att_rate,
                'attended':    attended,
                'present':     present,
                'wfh':         wfh,
                'half_day':    half_day,
                'leave':       leave,
                'absent':      absent,
                'avg_checkin': avg_checkin,
                'avg_hours':   avg_hours,
                'total_hours': round(total_hours, 1),
                'trend':       trend,
                'likelihood':  likelihood,
                'day_series':  day_series,
                'leave_probability': avg_leave_prob,
                'predicted_hours': predicted_hrs_val
            })

        total_emp  = len(per_employee)
        avg_att    = round(sum(e['att_rate'] for e in per_employee) / total_emp) if total_emp else 0

        return Response({
            'success': True,
            'period': {
                'start_date':    str(start_date),
                'end_date':      str(end_date),
                'total_days':    total_days,
                'working_days':  working_days,
            },
            'company_summary': {
                'total_employees': total_emp,
                'avg_attendance':  avg_att,
                'total_present':   company_present,
                'total_wfh':       company_wfh,
                'total_absent':    company_absent,
                'total_leave':     company_leave,
                'total_half_day':  company_half,
            },
            'employees': per_employee,
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return Response({'success': False, 'message': str(e)}, status=500)


# ========== Intelligence Hub API Endpoints ==========



# --- Function: intelligence_hub_forecast ---
@api_view(['GET'])
@require_gated_token_api
def intelligence_hub_forecast(request):
    """Get current attendance forecast with confidence and trend"""
    try:
        from ..intelligence_hub import calculate_forecast, get_current_day_name, load_model_state, SLMInsightGenerator
        
        forecast, confidence, trend = calculate_forecast()
        day_name = get_current_day_name()
        model_state = load_model_state()
        
        # Note: Model training is now handled by a system-level Cron job at 6:30 PM daily.
        # Check /scripts/train_model.sh for details.
        
        employee_id = request.GET.get('employee_id')
        if employee_id:
            try:
                from ..models import AttendanceRecord
                from datetime import date, timedelta
                
                today = date.today()
                start_date = today - timedelta(days=30)
                
                records = AttendanceRecord.objects.filter(
                    employee_id=employee_id,
                    date__range=[start_date, today]
                )
                
                passed_days = (today - start_date).days + 1
                # Optimization: Fetch all holidays in range once to avoid 30 queries in a loop
                holiday_map = {h.date: h for h in Holiday.objects.filter(date__range=[start_date, today])}
                working_days_passed = 0
                for d in range(passed_days):
                    curr_date = start_date + timedelta(days=d)
                    h = holiday_map.get(curr_date)
                    is_working = False
                    if h:
                        if h.is_working_day or h.is_optional:
                            is_working = True
                    else:
                        is_working = curr_date.weekday() < 6
                    if is_working:
                        working_days_passed += 1
                
                weekday_present_days = records.filter(
                    date__week_day__in=[2, 3, 4, 5, 6, 7],
                    status__in=['present', 'half_day', 'wfh', 'client']
                ).count()
                
                if working_days_passed > 0:
                    forecast = round((weekday_present_days / working_days_passed) * 100)
                else:
                    forecast = 0
            except Exception as e:
                import logging
                logging.getLogger('attendance').error(f"Error calculating personal forecast: {e}")
        
        return Response({
            'success': True,
            'forecast': {
                'percentage': forecast,
                'confidence': confidence,
                'trend': trend,
                'day_name': day_name,
                'subtitle': f"{day_name}'s Forecast",
                'model_state': model_state,
                'ai_insight': SLMInsightGenerator.generate_insight({
                    'forecast': forecast,
                    'confidence': confidence,
                    'trend': trend,
                    'attendance_streak': model_state.get('attendance_streak', 0) if model_state else 0
                })
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({
            'success': False,
            'message': f'Failed to calculate forecast: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: intelligence_hub_trends ---
@api_view(['GET'])
@require_gated_token_api
def intelligence_hub_trends(request):
    """Get 30-day trend data with comprehensive company overview"""
    try:
        from ..intelligence_hub import get_company_overview
        
        days = int(request.GET.get('days', 30))
        predict_days = int(request.GET.get('predict_days', 3))
        overview_data = get_company_overview(days, predict_days)
        
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




# --- Function: intelligence_hub_search ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def intelligence_hub_search(request):
    """Search personnel with attendance predictions"""
    try:
        from ..intelligence_hub import search_personnel
        
        data = request.data
        query = data.get('query')
        department = data.get('department')
        min_attendance = data.get('min_attendance')
        max_attendance = data.get('max_attendance')
        mentor_id = data.get('mentor_id')
        
        results = search_personnel(query, department, min_attendance, max_attendance, mentor_id)
        
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




# --- Function: employee_hr_report ---
@api_view(['GET'])
@require_gated_token_api
def employee_hr_report(request, employee_id):
    """
    Generate a comprehensive HR attendance report for a single employee
    over a given date range (max 31 days). Returns all the metrics
    needed for a professional PDF report.
    """
    try:
        employee = Employee.objects.get(id=employee_id)
        today = date.today()

        # Parse date range — max 31 days, default last 30 days
        start_str = request.GET.get('start_date')
        end_str   = request.GET.get('end_date')

        try:
            start_date = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else today - timedelta(days=30)
            end_date   = datetime.strptime(end_str,   '%Y-%m-%d').date() if end_str   else today
        except ValueError:
            start_date = today - timedelta(days=30)
            end_date   = today

        # Cap the range to 31 days
        if (end_date - start_date).days > 30:
            start_date = end_date - timedelta(days=30)

        # Clamp end_date to today
        if end_date > today:
            end_date = today

        # ── Attendance Records ──────────────────────────────────────────────
        records = AttendanceRecord.objects.filter(
            employee=employee,
            date__range=[start_date, end_date]
        ).order_by('date')

        now_local = timezone.localtime(timezone.now())

        # Count breakdown and build daily log
        daily_log   = []
        total_hours = 0.0
        status_counts = {
            'present': 0,
            'absent':  0,
            'leave':   0,
            'wfh':     0,
            'half_day':0,
        }

        check_in_seconds_list  = []
        check_out_seconds_list = []
        late_days = 0
        PUNCTUAL_THRESHOLD_H  = 10   # After 10:00 AM = late
        PUNCTUAL_THRESHOLD_M  = 0

        for r in records:
            hours = float(r.total_hours or 0)
            if not r.check_out_time and r.check_in_time and r.date == now_local.date():
                try:
                    ci = datetime.strptime(str(r.check_in_time), '%H:%M:%S').time()
                    ci_dt = timezone.make_aware(datetime.combine(r.date, ci))
                    hours = round(min(max(0.0, (now_local - ci_dt).total_seconds() / 3600), 14.0), 2)
                except Exception:
                    pass

            total_hours += hours

            # Status bucket
            if r.type == 'wfh' and r.status in ['present', 'half_day', 'wfh', 'client']:
                status_counts['wfh'] += 1
            elif r.status == 'present':
                status_counts['present'] += 1
            elif r.status == 'absent':
                status_counts['absent'] += 1
            elif r.status == 'leave':
                status_counts['leave'] += 1
            elif r.status == 'half_day':
                status_counts['half_day'] += 1
            else:
                status_counts['absent'] += 1

            # Punctuality
            if r.check_in_time:
                sec = r.check_in_time.hour * 3600 + r.check_in_time.minute * 60 + r.check_in_time.second
                check_in_seconds_list.append(sec)
                threshold_sec = PUNCTUAL_THRESHOLD_H * 3600 + PUNCTUAL_THRESHOLD_M * 60
                if sec > threshold_sec:
                    late_days += 1

            if r.check_out_time:
                sec = r.check_out_time.hour * 3600 + r.check_out_time.minute * 60 + r.check_out_time.second
                check_out_seconds_list.append(sec)

            daily_log.append({
                'date':        r.date.strftime('%d %b %Y'),
                'day':         r.date.strftime('%A'),
                'status':      r.status,
                'type':        r.type,
                'check_in':    str(r.check_in_time)[:5] if r.check_in_time else '—',
                'check_out':   str(r.check_out_time)[:5] if r.check_out_time else '—',
                'hours':       round(hours, 2),
            })

        # ── Summary Metrics ─────────────────────────────────────────────────
        total_days  = (end_date - start_date).days + 1
        working_days = sum(
            1 for i in range(total_days)
            if Holiday.is_date_working(start_date + timedelta(days=i))
        )

        raw_attended = status_counts['present'] + status_counts['wfh'] + status_counts['half_day']
        attended_days = min(working_days, raw_attended)
        attendance_rate = min(100.0, round((raw_attended / working_days * 100), 1)) if working_days else 0

        avg_check_in  = None
        avg_check_out = None
        if check_in_seconds_list:
            s = sum(check_in_seconds_list) / len(check_in_seconds_list)
            avg_check_in = f"{int(s//3600):02d}:{int((s%3600)//60):02d}"
        if check_out_seconds_list:
            s = sum(check_out_seconds_list) / len(check_out_seconds_list)
            avg_check_out = f"{int(s//3600):02d}:{int((s%3600)//60):02d}"

        punctual_days = attended_days - late_days
        punctuality_rate = round((punctual_days / attended_days * 100), 1) if attended_days else 0

        avg_hours_per_day = round(total_hours / attended_days, 2) if attended_days else 0

        # ── Task Performance (optional, best-effort) ────────────────────────
        try:
            tasks_qs = Task.objects.filter(assignees=employee).filter(
                Q(created_at__date__range=[start_date, end_date]) |
                Q(completed_at__date__range=[start_date, end_date]) |
                Q(status__in=['todo', 'in_progress'])
            ).distinct()
            total_tasks     = tasks_qs.count()
            completed_tasks = tasks_qs.filter(status='completed').count()
            task_completion_rate = round((completed_tasks / total_tasks * 100), 1) if total_tasks else 0
        except Exception:
            total_tasks = completed_tasks = task_completion_rate = 0

        # ── Profile ─────────────────────────────────────────────────────────
        profile = getattr(employee, 'profile', None)
        designation = getattr(profile, 'designation', '') or ''

        return Response({
            'success': True,
            'report': {
                'employee': {
                    'id':          employee.id,
                    'name':        employee.name,
                    'username':    employee.username,
                    'email':       employee.email,
                    'department':  employee.department,
                    'designation': designation,
                    'avatar_emoji': profile.avatar_emoji if profile else '👤',
                },
                'period': {
                    'start_date':  str(start_date),
                    'end_date':    str(end_date),
                    'total_days':  total_days,
                    'working_days': working_days,
                },
                'summary': {
                    'present':          status_counts['present'],
                    'wfh':              status_counts['wfh'],
                    'half_day':         status_counts['half_day'],
                    'leave':            status_counts['leave'],
                    'absent':           status_counts['absent'],
                    'attended_days':    attended_days,
                    'attendance_rate':  attendance_rate,
                    'total_hours':      round(total_hours, 1),
                    'avg_hours_per_day': avg_hours_per_day,
                    'avg_check_in':     avg_check_in or '—',
                    'avg_check_out':    avg_check_out or '—',
                    'late_days':        late_days,
                    'punctual_days':    punctual_days,
                    'punctuality_rate': punctuality_rate,
                    'task_total':       total_tasks,
                    'task_completed':   completed_tasks,
                    'task_completion_rate': task_completion_rate,
                },
                'daily_log': daily_log,
            }
        })

    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: intelligence_hub_train ---
@api_view(['POST'])
@require_gated_token_api
def intelligence_hub_train(request):
    """Trigger training of the forecast model using all historical data"""
    try:
        from ..intelligence_hub import train_forecast_model
        
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




# --- Function: intelligence_hub_training_history ---
@api_view(['GET'])
@require_gated_token_api
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



# --- Function: clear_training_history ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def clear_training_history(request):
    """Clear all model training history"""
    try:
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'success': False, 'message': 'User ID required'}, status=status.HTTP_400_BAD_REQUEST)
        
        user = Employee.objects.filter(id=user_id).first()
        if not user or user.role != 'admin':
            return Response({'success': False, 'message': 'Unauthorized to clear history'}, status=status.HTTP_403_FORBIDDEN)
        
        # Delete all training logs
        TrainingLog.objects.all().delete()
        
        return Response({
            'success': True,
            'message': 'Training history cleared successfully'
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Failed to clear history: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)





# --- Function: temporary_tags_api ---
@api_view(['GET', 'POST', 'DELETE'])
@require_gated_token_api
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




