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

# --- Function: _send_task_notification ---
def _send_task_notification(user, message, task_id, type="task"):
    """Helper to create a persistent notification in the database and trigger push"""
    from ..models import Notification
    try:
        Notification.objects.create(
            user=user,
            type=type,
            message=message,
            link_id=str(task_id)
        )
        
        # Trigger Web Push Notification
        title = "Task Notification"
        if type == "task_comment":
            title = "Comment on Task"
        elif type == "meeting":
            title = "Meeting / MoM"
        elif type == "mentor_assigned":
            title = "Mentor Assigned"
            
        link = f"task_{task_id}" if task_id else "dashboard"
        _trigger_push_notification(user, title, message, link)
        
        return True
    except Exception as e:
        print(f"Error creating notification: {e}")
        return False



# --- Function: _get_admin_task_mentor_data ---
def _get_admin_task_mentor_data():
    """Helper: Get all tasks for Admin Task Mentor"""
    tasks = Task.objects.select_related(
        'created_by'
    ).prefetch_related(
        'assignees',
        'mentors',
        'overseers',
        'comments__author',
        'steps',
        'history__changed_by',
        'attachments'
    ).order_by('-created_at')
    return _serialize_tasks(tasks)



# --- Function: _get_employee_my_tasks_data ---
def _get_employee_my_tasks_data(employee):
    """Helper: Get assigned tasks + overseen tasks for Employee My Tasks"""
    tasks = Task.objects.filter(
        Q(assignees=employee) | Q(mentors=employee) | Q(overseers=employee)
    ).distinct().select_related(
        'created_by'
    ).prefetch_related(
        'assignees',
        'mentors',
        'overseers',
        'comments__author',
        'steps',
        'history__changed_by',
        'attachments'
    ).order_by('-created_at')
    return _serialize_tasks(tasks)



# --- Function: _get_mentor_employees_tasks_data ---
def _get_mentor_employees_tasks_data(mentor):
    """Helper: Get tasks for employees reporting to this mentor + tasks explicitly managed by them"""
    # Exclude tasks where the mentor themselves is an assignee to keep Team Tasks focused on management
    query = (Q(assignees__mentors=mentor) | Q(mentors=mentor) | Q(overseers=mentor))
    tasks = Task.objects.filter(query).exclude(
        assignees=mentor
    ).distinct().select_related(
        'created_by'
    ).prefetch_related(
        'assignees',
        'mentors',
        'overseers',
        'comments__author',
        'steps',
        'history__changed_by',
        'attachments'
    ).order_by('-created_at')
    return _serialize_tasks(tasks)



# --- Function: _serialize_tasks ---
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

        # Get steps
        steps = []
        for step in task.steps.all():
            steps.append({
                'id': step.id,
                'text': step.text,
                'is_completed': step.is_completed
            })

        # Get history
        history_log = []
        for h in task.history.all().select_related('changed_by'):
            history_log.append({
                'id': h.id,
                'field': h.field_changed,
                'old': h.old_value,
                'new': h.new_value,
                'by': h.changed_by.name if h.changed_by else 'System',
                'at': h.changed_at.isoformat()
            })

        # Get attachments
        attachments = []
        for a in task.attachments.all():
            attachments.append({
                'id': a.id,
                'name': a.file.name.split('/')[-1],
                'url': a.file.url
            })

        data.append({
            'id': task.id,
            'title': task.title,
            'description': task.description,
            'status': task.status,
            'priority': task.priority,
            'assignees': assignees_info,
            'overseers': [{'id': o.id, 'name': o.name} for o in task.overseers.all()],
            'mentors': [{'id': m.id, 'name': m.name} for m in task.mentors.all()],
            'mentor_id': task.mentors.first().id if task.mentors.exists() else None,
            'mentor_name': task.mentors.first().name if task.mentors.exists() else None,
            'Mentor_id': task.mentors.first().id if task.mentors.exists() else None,
            'Mentor_name': task.mentors.first().name if task.mentors.exists() else None,
            'created_by': task.created_by.id,
            'created_by_name': task.created_by.name,
            'start_date': str(task.start_date) if task.start_date else None,
            'due_date': str(task.due_date) if task.due_date else None,
            'started_at': task.started_at.isoformat() if task.started_at else None,
            'completed_at': task.completed_at.isoformat() if task.completed_at else None,
            'created_at': task.created_at.isoformat(),
            'updated_at': task.updated_at.isoformat(),
            'comments': comments,
            'steps': steps,
            'history': history_log,
            'attachments': attachments,
            'project_id': task.project_id,
            'project_name': task.project.name if task.project else None,
            'actual_total_hours': float(task.actual_total_hours or 0.0),
            'estimated_total_hours': float(task.estimated_total_hours or 0.0)
        })
    return data



# --- Function: _create_task_admin ---
def _create_task_admin(data, creator, files=None):
    """Helper: Create a task with multi-mentor and multi-assignee support"""
    required_fields = ['title']
    for field in required_fields:
        if not data.get(field):
            raise ValueError(f'{field} is required')

    import json
    # Process Assignees
    assigned_input = data.get('assignees') or data.get('assigned_to')
    if isinstance(assigned_input, str):
        try: assigned_input = json.loads(assigned_input)
        except: assigned_input = [assigned_input]
    assigned_ids = assigned_input if isinstance(assigned_input, list) else [assigned_input] if assigned_input else []
    
    # REQUIREMENT: Creator is auto-selected as employee (assignee)
    if str(creator.id) not in [str(aid) for aid in assigned_ids]:
        assigned_ids.append(creator.id)

    # Process Mentors
    mentor_input = data.get('mentor_ids') or data.get('overseer_ids') or data.get('mentor_id')
    if isinstance(mentor_input, str):
        try: mentor_input = json.loads(mentor_input)
        except: mentor_input = [mentor_input]
    mentor_ids = mentor_input if isinstance(mentor_input, list) else [mentor_input] if mentor_input else []
    priority = data.get('priority', 'medium').lower()
    
    # REQUIREMENT: P1 to P4 tags should be selected single time per task (per user active tasks)
    restricted_priorities = ['p1', 'p2', 'p3', 'p4']
    if priority in restricted_priorities:
        for emp_id in assigned_ids:
            if not emp_id: continue
            duplicate_exists = Task.objects.filter(
                assignees=emp_id,
                priority=priority,
            ).exclude(status='completed').exists()
            
            if duplicate_exists:
                emp_name = Employee.objects.filter(id=emp_id).values_list('name', flat=True).first() or "User"
                raise ValueError(f"{emp_name} already has an active {priority.upper()} task. Only one task of this priority level is allowed at a time.")

    mentor_ids = [mid for mid in mentor_ids if mid and mid != 'none']
    
    # REQUIREMENT: If mentor creates task for team, they get selected automatically as mentor
    creator_role = (creator.role or '').lower()
    if (creator_role == 'mentor' or creator_role == 'admin' or creator.subordinates.exists()):
        if str(creator.id) not in [str(mid) for mid in mentor_ids]:
            mentor_ids.append(creator.id)

    start_date = data.get('start_date') or None
    due_date = data.get('due_date') or None

    task = Task.objects.create(
        title=data['title'],
        description=data.get('description', ''),
        status=data.get('status', 'todo'),
        priority=data.get('priority', 'medium'),
        project_id=data.get('project_id'),
        created_by=creator,
        start_date=start_date,
        due_date=due_date
    )
    
    task.assignees.set(Employee.objects.filter(id__in=assigned_ids))
    task.mentors.set(Employee.objects.filter(id__in=mentor_ids))

    # Clean up pending task requests
    EmployeeRequest.objects.filter(
        employee_id__in=assigned_ids,
        request_type='task_request',
        status='pending'
    ).update(status='approved', admin_response=f'Task "{task.title}" assigned.')

    if files:
        attachments = files.getlist('attachments')
        for f in attachments:
            TaskAttachment.objects.create(task=task, file=f)

    # Notifications to Assignees
    task_title = str(task.title or "Untitled Task")
    is_mom = any(kw in task_title.upper() for kw in ["MOM", "MEETING"]) or task_title.startswith("MoM Tasks")
    assignee_objs = Employee.objects.filter(id__in=assigned_ids)
    for assignee in assignee_objs:
        if assignee.id == creator.id: continue # Skip creator
        msg = f"New Minutes/Task: {task_title}" if is_mom else f"New task assigned: {task_title}"
        notif_type = "meeting" if is_mom else "task"
        Notification.objects.create(user_id=assignee.id, type=notif_type, message=msg, link_id=str(task.id))
        _trigger_push_notification(assignee, "Meeting MoM" if is_mom else "Task Assignment", msg, f"task_{task.id}")

    return task



# --- Function: tasks_api ---
@api_view(['GET', 'POST'])
@require_gated_token_api
@parser_classes([JSONParser, MultiPartParser, FormParser])
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

                # Direct Project-based task retrieval (bypassing scope restrictions for project team members)
                p_filter_id = request.GET.get('project_id')
                if p_filter_id:
                    try:
                        p_filter_id = int(p_filter_id)
                        tasks = Task.objects.filter(project_id=p_filter_id).select_related(
                            'created_by'
                        ).prefetch_related(
                            'assignees',
                            'mentors',
                            'overseers',
                            'comments__author',
                            'steps',
                            'history__changed_by',
                            'attachments'
                        ).order_by('-created_at')
                        tasks_data = _serialize_tasks(tasks)
                        return Response({
                            'success': True,
                            'tasks': tasks_data
                        })
                    except ValueError:
                        pass

                if (emp.role or '').lower() == 'admin':
                    # ADMIN PATH - Now respects scope for consistency with Mentor view
                    scope = request.GET.get('scope')
                    if scope == 'my':
                        # Tasks assigned TO the admin
                        tasks = Task.objects.filter(assignees=emp).distinct().select_related(
                            'created_by'
                        ).prefetch_related(
                            'assignees',
                            'mentors',
                            'overseers',
                            'comments__author',
                            'steps',
                            'history__changed_by',
                            'attachments'
                        ).order_by('-created_at')
                        tasks_data = _serialize_tasks(tasks)
                    else:
                        # Full view for admin (Team/All)
                        tasks_data = _get_admin_task_mentor_data()
                elif emp.role == 'mentor':
                    # Mentor PATH - Separated based on scope
                    scope = request.GET.get('scope')
                    if scope == 'my':
                        # Strictly tasks assigned TO the mentor
                        tasks = Task.objects.filter(assignees=emp).distinct().select_related(
                            'created_by'
                        ).prefetch_related(
                            'assignees',
                            'mentors',
                            'overseers',
                            'comments__author',
                            'steps',
                            'history__changed_by',
                            'attachments'
                        ).order_by('-created_at')
                        tasks_data = _serialize_tasks(tasks)
                    elif scope == 'team':
                        # Subordinates' tasks (Excludes mentor's personal tasks)
                        tasks_data = _get_mentor_employees_tasks_data(emp)
                    else:
                        # Legacy merged view (if no scope provided)
                        own_tasks = _get_employee_my_tasks_data(emp)
                        subordinate_tasks = _get_mentor_employees_tasks_data(emp)
                        tasks_data = own_tasks + [t for t in subordinate_tasks if t['id'] not in [ot['id'] for ot in own_tasks]]
                else:
                    # EMPLOYEE PATH
                    scope = request.GET.get('scope')
                    if scope == 'my':
                        # Strictly tasks assigned TO the employee
                        tasks = Task.objects.filter(assignees=emp).distinct().select_related(
                            'created_by'
                        ).prefetch_related(
                            'assignees',
                            'mentors',
                            'overseers',
                            'comments__author',
                            'steps',
                            'history__changed_by',
                            'attachments'
                        ).order_by('-created_at')
                        tasks_data = _serialize_tasks(tasks)
                    else:
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
                'message': f'Failed to fetch tasks: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    elif request.method == 'POST':
        try:
            data = request.data
            task_id = data.get('task_id')
            creator_id = data.get('created_by')

            # Security: Prefer the authenticated user from the gated token
            user = getattr(request, 'user', None)
            if not isinstance(user, Employee):
                if creator_id:
                    user = Employee.objects.get(id=creator_id)
                else:
                    return Response({'success': False, 'message': 'User session not found'}, status=status.HTTP_400_BAD_REQUEST)

            if task_id:
                # UPDATE PATH
                task = Task.objects.get(id=task_id)
                _update_task_admin(task, data, user)
                return Response({
                    'success': True,
                    'message': 'Task updated successfully',
                    'task_id': task.id
                })
            else:
                # CREATE PATH
                task = _create_task_admin(data, user, request.FILES)
                return Response({
                    'success': True,
                    'message': 'Task created successfully',
                    'task_id': task.id
                })

        except ValueError as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'Assigned employee or Mentor not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            # More helpful error for debugging
            return Response({
                'success': False,
                'message': f'Failed to create task: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Alias: URL conf references 'views.create_task' for the explicit create endpoint
create_task = tasks_api



# --- Function: _update_task_admin ---
def _update_task_admin(task, data, user=None):
    """Helper: Admin/Overseer/Reporting Mentor updates task details"""
    user_role = str(user.role).lower() if user else 'none'
    is_admin = user_role == 'admin'
    is_overseer = user and task.mentors.filter(id=user.id).exists()
    
    # Mentor check: user manages at least one of the assignees
    is_reporting_mentor = False
    if user:
        is_reporting_mentor = task.assignees.filter(mentors=user).exists()

    if task.status == 'completed' and not (is_admin or is_overseer or is_reporting_mentor):
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
        old_priority = str(task.priority).lower() if task.priority else 'medium'
        new_priority = str(data['priority']).lower()
        if old_priority != new_priority:
            # REQUIREMENT: P1 to P4 tags should be selected single time per task (per user active tasks)
            restricted_priorities = ['p1', 'p2', 'p3', 'p4']
            if new_priority in restricted_priorities:
                assignees = task.assignees.all()
                for emp in assignees:
                    duplicate_exists = Task.objects.filter(
                        assignees=emp,
                        priority=new_priority,
                    ).exclude(id=task.id).exclude(status='completed').exists()
                    
                    if duplicate_exists:
                        raise ValueError(f"{emp.name} already has an active {new_priority.upper()} task. Only one task of this priority level is allowed at a time.")

            from ..models import TaskHistory
            
            last_24h = timezone.now() - timedelta(hours=24)
            recent_change = TaskHistory.objects.filter(
                task=task, field_changed='priority', changed_at__gte=last_24h
            ).order_by('-changed_at').first()
            
            if recent_change:
                recent_change.new_value = new_priority
                recent_change.changed_by = user
                recent_change.changed_at = timezone.now()
                recent_change.save()
            else:
                TaskHistory.objects.create(
                    task=task,
                    field_changed='priority',
                    old_value=old_priority,
                    new_value=new_priority,
                    changed_by=user
                )
        task.priority = new_priority
    if 'title' in data:
        old_title = str(task.title) if task.title else ''
        new_title = str(data['title'])
        if old_title != new_title:
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='title',
                old_value=old_title,
                new_value=new_title,
                changed_by=user
            )
        task.title = new_title
    if 'description' in data:
        old_desc = str(task.description) if task.description else ''
        new_desc = str(data['description'])
        if old_desc != new_desc:
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='description',
                old_value=old_desc,
                new_value=new_desc,
                changed_by=user
            )
        task.description = new_desc
    if 'start_date' in data:
        old_start = str(task.start_date) if task.start_date else 'None'
        new_start = str(data['start_date'])
        if old_start != new_start:
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='start_date',
                old_value=old_start,
                new_value=new_start,
                changed_by=user
            )
        task.start_date = data['start_date']
    if 'due_date' in data:
        old_due = str(task.due_date) if task.due_date else 'None'
        new_due = str(data['due_date'])
        if old_due != new_due:
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='due_date',
                old_value=old_due,
                new_value=new_due,
                changed_by=user
            )
        task.due_date = data['due_date']
        
    if 'steps' in data:
        from ..models import TaskStep
        # Expecting data['steps'] to be a list of {id?: int, text: string, is_completed: bool}
        # Simplified: overwrite OR update. Let's do update logic.
        incoming_steps = data['steps']
        current_step_ids = []
        for s_data in incoming_steps:
            if s_data.get('id'):
                step = TaskStep.objects.get(id=s_data['id'], task=task)
                step.text = s_data['text']
                step.is_completed = s_data['is_completed']
                step.save()
                current_step_ids.append(step.id)
            else:
                new_step = TaskStep.objects.create(
                    task=task,
                    text=s_data['text'],
                    is_completed=s_data.get('is_completed', False)
                )
                current_step_ids.append(new_step.id)
        # Remove steps not in incoming data? For now keep them simple unless requested.
        
    import json
    if 'assignees' in data or 'assigned_to' in data:
        assigned_input = data.get('assignees') or data.get('assigned_to')
        if isinstance(assigned_input, str):
            try: assigned_input = json.loads(assigned_input)
            except: assigned_input = [assigned_input]
        assigned_ids = assigned_input if isinstance(assigned_input, list) else [assigned_input] if assigned_input else []
        
        # History Logging for Assignees
        old_assignees = task.assignees.all()
        old_names = ", ".join([a.name for a in old_assignees])
        
        new_assignee_objs = Employee.objects.filter(id__in=assigned_ids)
        new_names = ", ".join([a.name for a in new_assignee_objs])

        if set(old_assignees.values_list('id', flat=True)) != set([int(aid) for aid in assigned_ids]):
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='assignees',
                old_value=old_names or "None",
                new_value=new_names or "None",
                changed_by=user
            )
            task.assignees.set(new_assignee_objs)

    if 'mentor_ids' in data or 'overseer_ids' in data or 'mentor_id' in data:
        mentor_input = data.get('mentor_ids') or data.get('overseer_ids') or data.get('mentor_id')
        if isinstance(mentor_input, str):
            try: mentor_input = json.loads(mentor_input)
            except: mentor_input = [mentor_input]
        new_mentor_ids = mentor_input if isinstance(mentor_input, list) else [mentor_input] if mentor_input else []
        new_mentor_ids = [mid for mid in new_mentor_ids if mid and mid != 'none']
        
        # History Logging for Mentors
        old_mentors = task.mentors.all()
        old_names = ", ".join([m.name for m in old_mentors])
        
        new_mentors = Employee.objects.filter(id__in=new_mentor_ids)
        new_names = ", ".join([m.name for m in new_mentors])

        if set(old_mentors.values_list('id', flat=True)) != set([int(mid) for mid in new_mentor_ids]):
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='mentors',
                old_value=old_names or "None",
                new_value=new_names or "None",
                changed_by=user
            )
            task.mentors.set(new_mentors)

    task.save()

    # REQUIREMENT: Mentors get notification of the edited task
    task_title = str(task.title or "Untitled Task")
    editor_name = user.name if user else "Someone"
    mentor_objs = task.mentors.all()
    for mnt in mentor_objs:
        if user and mnt.id == user.id: continue # Skip if editor is the mentor
        msg = f"Task '{task_title}' was updated by {editor_name}"
        Notification.objects.create(user_id=mnt.id, type="task", message=msg, link_id=str(task.id))
        _trigger_push_notification(mnt, "Task Updated", msg, f"task_{task.id}")

    return True



# --- Function: _update_task_employee ---
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

    if 'title' in data:
        old_title = str(task.title) if task.title else ''
        new_title = str(data['title'])
        if old_title != new_title:
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='title',
                old_value=old_title,
                new_value=new_title,
                changed_by=user
            )
        task.title = new_title

    if 'description' in data:
        old_desc = str(task.description) if task.description else ''
        new_desc = str(data['description'])
        if old_desc != new_desc:
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='description',
                old_value=old_desc,
                new_value=new_desc,
                changed_by=user
            )
        task.description = new_desc

    if 'due_date' in data:
        old_due = str(task.due_date) if task.due_date else 'None'
        new_due = str(data['due_date'])
        if old_due != new_due:
            from ..models import TaskHistory
            TaskHistory.objects.create(
                task=task,
                field_changed='due_date',
                old_value=old_due,
                new_value=new_due,
                changed_by=user
            )
        task.due_date = data['due_date']
        
    if 'priority' in data:
        old_priority = str(task.priority).lower() if task.priority else 'medium'
        new_priority = str(data['priority']).lower()
        if old_priority != new_priority:
            # REQUIREMENT: P1 to P4 tags should be selected single time per task (per user active tasks)
            restricted_priorities = ['p1', 'p2', 'p3', 'p4']
            if new_priority in restricted_priorities:
                assignees = task.assignees.all()
                for emp in assignees:
                    duplicate_exists = Task.objects.filter(
                        assignees=emp,
                        priority=new_priority,
                    ).exclude(id=task.id).exclude(status='completed').exists()
                    
                    if duplicate_exists:
                        raise ValueError(f"{emp.name} already has an active {new_priority.upper()} task. Only one task of this priority level is allowed at a time.")

            from ..models import TaskHistory
            
            last_24h = timezone.now() - timedelta(hours=24)
            recent_change = TaskHistory.objects.filter(
                task=task, field_changed='priority', changed_at__gte=last_24h
            ).order_by('-changed_at').first()
            
            if recent_change:
                recent_change.new_value = new_priority
                recent_change.changed_by = user
                recent_change.changed_at = timezone.now()
                recent_change.save()
            else:
                TaskHistory.objects.create(
                    task=task,
                    field_changed='priority',
                    old_value=old_priority,
                    new_value=new_priority,
                    changed_by=user
                )
        task.priority = new_priority

    if 'status' in data:
        new_status = data['status']
        if new_status == 'in_progress' and not task.started_at:
            task.started_at = timezone.now()
        elif new_status == 'completed' and not task.completed_at:
            task.completed_at = timezone.now()
        task.status = new_status

    if 'steps' in data:
        from ..models import TaskStep
        incoming_steps = data['steps']
        for s_data in incoming_steps:
            if s_data.get('id'):
                try:
                    step = TaskStep.objects.get(id=s_data['id'], task=task)
                    step.text = s_data['text']
                    step.is_completed = s_data['is_completed']
                    step.save()
                except TaskStep.DoesNotExist:
                    pass
            else:
                TaskStep.objects.create(
                    task=task,
                    text=s_data['text'],
                    is_completed=s_data.get('is_completed', False)
                )

    task.save()
    return True



# --- Function: task_detail_api ---
@api_view(['GET', 'POST', 'PATCH', 'DELETE'])
@require_gated_token_api
@parser_classes([JSONParser, MultiPartParser, FormParser])
def task_detail_api(request, task_id):
    """Update, delete or fetch a task (Separated Admin/Employee Logic)"""
    try:
        task = Task.objects.prefetch_related('assignees').prefetch_related('mentors').get(id=task_id)
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
    requesting_user_id = data.get('user_id')

    # Security: Prefer the authenticated user from the gated token
    requesting_user = getattr(request, 'user', None)
    if not isinstance(requesting_user, Employee):
        if not requesting_user_id:
            return Response({'success': False, 'message': 'User verification required'}, status=status.HTTP_403_FORBIDDEN)
        try:
            requesting_user = Employee.objects.get(id=requesting_user_id)
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': 'User not found'}, status=status.HTTP_403_FORBIDDEN)
    
    # Check permissions and dispatch
    try:
        if request.method in ['POST', 'PATCH']:
            # Check for DELETE method simulation
            if data.get('_method') == 'DELETE':
                if str(requesting_user.role).lower() != 'admin':
                    return Response({'success': False, 'message': 'Only administrators can delete tasks'}, status=status.HTTP_403_FORBIDDEN)

                task.delete()
                return Response({'success': True, 'message': 'Task deleted'})

            # Update Logic
            role = str(requesting_user.role).lower()
            is_assignee = task.assignees.filter(id=requesting_user.id).exists()
            is_mentor_of_assignee = task.assignees.filter(mentors=requesting_user).exists()
            is_task_mentor = task.mentors.filter(id=requesting_user.id).exists()

            if role == 'admin':
                _update_task_admin(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Admin)'})

            elif is_task_mentor:
                # Task Overseer can also perform full updates
                _update_task_admin(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Overseer)'})

            elif is_mentor_of_assignee:
                # Assignee's Reporting Mentor can also perform full updates
                _update_task_admin(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Mentor)'})

            elif is_assignee:
                _update_task_employee(task, data, requesting_user)
                return Response({'success': True, 'message': 'Task updated (Employee)'})

            else:
                return Response({'success': False, 'message': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)

    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'User not found'}, status=status.HTTP_403_FORBIDDEN)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: bulk_update_tasks ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def bulk_update_tasks(request):
    """Update multiple tasks at once (primarily for priority ranking or step toggling)"""
    data = request.data
    updates = data.get('updates', [])
    user_id = data.get('user_id')
    task_ids = data.get('task_ids', [])

    # Security: Prefer the authenticated user from the gated token
    user = getattr(request, 'user', None)
    if not isinstance(user, Employee):
        user_id = data.get('user_id')
        if not user_id:
            return Response({'success': False, 'message': 'Authentication required. No user identity found.'}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            user = Employee.objects.get(id=user_id)
        except Employee.DoesNotExist:
            return Response({'success': False, 'message': f'Employee with ID {user_id} not found.'}, status=status.HTTP_404_NOT_FOUND)

    try:
        if isinstance(updates, dict):
            if not task_ids:
                return Response({'success': False, 'message': 'task_ids required for this update type'}, status=status.HTTP_400_BAD_REQUEST)
            
            tasks = Task.objects.filter(id__in=task_ids)
            if not tasks.exists():
                return Response({'success': False, 'message': 'Tasks not found'}, status=status.HTTP_404_NOT_FOUND)

            for task in tasks:
                try:
                    # Permission check: Admin, Mentor, or Assignee
                    is_assignee = task.assignees.filter(id=user.id).exists()
                    role_str = str(user.role).lower()
                    has_subordinates = False
                    try:
                        has_subordinates = user.subordinates.exists()
                    except AttributeError:
                        pass
                    
                    is_admin_mentor = role_str in ['admin', 'mentor'] or has_subordinates
                    
                    if not (is_assignee or is_admin_mentor):
                        continue  # Skip tasks user has no permission for

                    # Loophole Fix: Prevent modifications to completed tasks by standard users
                    if task.status == 'completed' and not is_admin_mentor:
                        continue # Skip modifications for completed tasks if not admin/mentor

                    # Handle Step Toggles
                    if 'steps_toggle' in updates:
                        for step_data in updates['steps_toggle']:
                            step = TaskStep.objects.filter(id=step_data['id'], task=task).first()
                            if step:
                                old_val = "Completed" if step.is_completed else "Pending"
                                new_val = "Completed" if step_data['is_completed'] else "Pending"
                                if step.is_completed != step_data['is_completed']:
                                    step.is_completed = step_data['is_completed']
                                    step.save()
                                    TaskHistory.objects.create(
                                        task=task,
                                        field_changed=f"Step: {step.text[:30]}",
                                        old_value=old_val,
                                        new_value=new_val,
                                        changed_by=user
                                    )

                    # Handle Add Step
                    if 'add_step' in updates:
                        new_step = TaskStep.objects.create(task=task, text=updates['add_step'])
                        TaskHistory.objects.create(
                            task=task,
                            field_changed="Added Step",
                            old_value="",
                            new_value=new_step.text,
                            changed_by=user
                        )

                    # Handle Status Update
                    if 'status' in updates:
                        new_status = updates['status']
                        old_status = task.status
                        if old_status != new_status:
                            task.status = new_status
                            # Set timestamps on transition
                            if new_status == 'in_progress' and not task.started_at:
                                task.started_at = timezone.now()
                            elif new_status == 'completed' and not task.completed_at:
                                task.completed_at = timezone.now()
                            task.save()
                            TaskHistory.objects.create(
                                task=task,
                                field_changed="status",
                                old_value=old_status,
                                new_value=new_status,
                                changed_by=user
                            )

                    # Auto Status Transitions from step changes (only if status not manually set)
                    elif 'steps_toggle' in updates or 'add_step' in updates:
                        all_steps = list(task.steps.all())
                        if all_steps:
                            total_steps = len(all_steps)
                            completed_steps = sum(1 for s in all_steps if s.is_completed)
                            old_status = task.status
                            if completed_steps == total_steps:
                                task.status = 'completed'
                                if not task.completed_at:
                                    task.completed_at = timezone.now()
                            elif completed_steps > 0:
                                task.status = 'in_progress'
                                if not task.started_at:
                                    task.started_at = timezone.now()
                            if task.status != old_status:
                                task.save()
                                TaskHistory.objects.create(
                                    task=task,
                                    field_changed="status",
                                    old_value=old_status,
                                    new_value=task.status,
                                    changed_by=user
                                )

                except Exception as task_err:
                    print(f"Task Update Error (Task {task.id}): {str(task_err)}")
                    return Response({'success': False, 'message': 'An error occurred while updating the task. Please check your inputs and try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


            return Response({'success': True, 'message': 'Task(s) updated successfully'})

        # Legacy list-based updates (Priority ranking)
        # Only allow Admin/Mentor for this
        role_lower = str(user.role).lower()
        if role_lower != 'admin' and role_lower != 'mentor':
            return Response({'success': False, 'message': 'Admin or Mentor access required for priority updates'}, status=status.HTTP_403_FORBIDDEN)

        for item in updates:
            task_id = item.get('id')
            priority = item.get('priority')
            if task_id and priority:
                task = Task.objects.filter(id=task_id).first()
                if task and task.priority != priority:
                    old_p = task.priority
                    task.priority = priority
                    task.save()
                    TaskHistory.objects.create(
                        task=task,
                        field_changed="priority",
                        old_value=old_p,
                        new_value=priority,
                        changed_by=user
                    )
        
        return Response({'success': True, 'message': f'Updated {len(updates)} tasks'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: task_comment_api ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def task_comment_api(request):
    """Add a comment to a task"""
    data = request.data
    task_id = data.get('task_id')
    author_id = data.get('user_id') or data.get('author_id')
    content = data.get('content')

    if not all([task_id, author_id, content]):
        return Response({
            'success': False,
            'message': 'task_id, author_id, and content are required'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        task = Task.objects.prefetch_related('assignees').prefetch_related('mentors').get(id=task_id)
        author = Employee.objects.get(id=author_id)

        # Updated permission checks for hybrid assignment
        is_assignee = task.assignees.filter(id=author.id).exists()
        is_mentor_of_assignee = task.assignees.filter(mentors=author).exists()

        can_comment = False
        role = str(author.role).lower()
        if role == 'admin':
            can_comment = True
        elif task.mentors.filter(id=author.id).exists():
            can_comment = True
        elif is_assignee:
            can_comment = True
        elif is_mentor_of_assignee:
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

        # Trigger notifications for mentor and assignees
        try:
            # Notify assignees (if comment is not by them)
            for assignee in task.assignees.all():
                if assignee.id != author.id:
                    _send_task_notification(assignee, f"New comment by {author.name} on: {task.title}", task.id, "task_comment")
            
            # Notify overseers
            for overseer in task.overseers.all():
                if overseer.id != author.id:
                    _send_task_notification(overseer, f"New comment on task: {task.title}", task.id, "task_comment")
            
            # Notify all mentors except the author
            for m in task.mentors.all():
                if m.id != author.id:
                    _send_task_notification(m, f"New comment on task: {task.title}", task.id, "task_comment")

        except Exception as e:
            print(f"Notification error: {e}")

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



# --- Function: task_attach_api ---
@api_view(['POST'])
@require_gated_token_api
def task_attach_api(request):
    """Attach files to an existing task"""
    task_id = request.data.get('task_id')
    if not task_id:
        return Response({'success': False, 'message': 'task_id required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        task = Task.objects.get(id=task_id)
        files = request.FILES.getlist('attachments')
        for f in files:
            TaskAttachment.objects.create(task=task, file=f)
        return Response({'success': True, 'message': f'Attached {len(files)} files'})
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)







# --- Function: employees_simple_list ---
@api_view(['GET'])
@require_gated_token_api
def employees_simple_list(request):
    """Get simple list of employees for dropdowns"""
    try:
        employees_qs = Employee.objects.filter(is_active=True).order_by('name')
        employees_data = []
        for emp in employees_qs:
            employees_data.append({
                'id': emp.id,
                'name': emp.name,
                'role': emp.role,
                'mentor_ids': [m.id for m in emp.mentors.all()],
                'is_mentor': emp.subordinates.exists()
            })
            
        return Response({
            'success': True,
            'employees': employees_data
        })
    except Exception as e:
        return Response({
            'success': False,
            'message': 'Failed to fetch employees'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: projects_api ---
@api_view(['GET', 'POST'])
@require_gated_token_api
def projects_api(request):
    user = get_current_user(request)
    if not user:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)

    if request.method == 'GET':
        if (user.role or '').lower() == 'admin':
            projects = Project.objects.all().order_by('-created_at')
        else:
            from django.db.models import Q
            projects = Project.objects.filter(
                Q(project_owner=user) | Q(assignees=user)
            ).distinct().order_by('-created_at')
        data = [{
            'id': p.id,
            'name': p.name,
            'description': p.description,
            'status': p.status,
            'priority': p.priority,
            'client_facing': p.client_facing,
            'technologies': p.technologies,
            'project_owner': {'id': p.project_owner.id, 'name': p.project_owner.name} if p.project_owner else None,
            'assignees': [{'id': a.id, 'name': a.name} for a in p.assignees.all()],
            'escalation_level': p.escalation_level,
            'escalation_contacts': [{'id': ec.id, 'name': ec.name} for ec in p.escalation_contacts.all()],
            'sla_response_time': p.sla_response_time,
            'escalation_matrix': p.escalation_matrix,
            'start_date': p.start_date.strftime('%Y-%m-%d') if p.start_date else None,
            'end_date': p.end_date.strftime('%Y-%m-%d') if p.end_date else None,
            'created_by': p.created_by.name,
            'created_at': p.created_at.strftime('%Y-%m-%d %H:%M')
        } for p in projects]
        return Response({'success': True, 'projects': data})

    elif request.method == 'POST':
        name = request.data.get('name')
        description = request.data.get('description', '')
        status_val = request.data.get('status', 'running')
        
        if not name:
            return Response({'success': False, 'message': 'Project name is required'}, status=400)
            
        project = Project.objects.create(
            name=name,
            description=description,
            status=status_val,
            created_by=user,
            priority=request.data.get('priority', 'medium'),
            client_facing=request.data.get('client_facing', False),
            technologies=request.data.get('technologies', ''),
            escalation_level=request.data.get('escalation_level', ''),
            sla_response_time=request.data.get('sla_response_time', ''),
            escalation_matrix=request.data.get('escalation_matrix', ''),
            start_date=request.data.get('start_date') or None,
            end_date=request.data.get('end_date') or None,
        )
        
        project_owner_id = request.data.get('project_owner')
        if project_owner_id:
            try:
                project.project_owner = Employee.objects.get(id=project_owner_id)
                project.save()
            except Employee.DoesNotExist:
                pass
                
        escalation_contacts = request.data.get('escalation_contacts', [])
        if escalation_contacts:
            if isinstance(escalation_contacts, str):
                import json
                try: escalation_contacts = json.loads(escalation_contacts)
                except: escalation_contacts = []
            if isinstance(escalation_contacts, list):
                project.escalation_contacts.set(Employee.objects.filter(id__in=escalation_contacts))
                project.save()
                
        assignees = request.data.get('assignees', [])
        if assignees:
            if isinstance(assignees, str):
                import json
                try: assignees = json.loads(assignees)
                except: assignees = []
            if isinstance(assignees, list):
                project.assignees.set(Employee.objects.filter(id__in=assignees))

        return Response({
            'success': True, 
            'message': 'Project created',
            'project': {
                'id': project.id,
                'name': project.name,
                'status': project.status
            }
        })




# --- Function: project_detail_api ---
@api_view(['GET', 'PUT', 'DELETE'])
@require_gated_token_api
def project_detail_api(request, project_id):
    user = get_current_user(request)
    if not user:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)
        
    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        return Response({'success': False, 'message': 'Project not found'}, status=404)
        
    if request.method == 'GET':
        return Response({
            'success': True,
            'project': {
                'id': project.id,
                'name': project.name,
                'description': project.description,
                'status': project.status,
                'priority': project.priority,
                'client_facing': project.client_facing,
                'technologies': project.technologies,
                'project_owner': {'id': project.project_owner.id, 'name': project.project_owner.name} if project.project_owner else None,
                'assignees': [{'id': a.id, 'name': a.name} for a in project.assignees.all()],
                'escalation_level': project.escalation_level,
                'escalation_contacts': [{'id': ec.id, 'name': ec.name} for ec in project.escalation_contacts.all()],
                'sla_response_time': project.sla_response_time,
                'escalation_matrix': project.escalation_matrix,
                'start_date': project.start_date.strftime('%Y-%m-%d') if project.start_date else None,
                'end_date': project.end_date.strftime('%Y-%m-%d') if project.end_date else None,
                'created_by': project.created_by.name,
                'created_at': project.created_at.strftime('%Y-%m-%d %H:%M')
            }
        })
        
    elif request.method == 'PUT':
        if 'name' in request.data:
            project.name = request.data['name']
        if 'description' in request.data:
            project.description = request.data['description']
        if 'status' in request.data:
            project.status = request.data['status']
        if 'priority' in request.data:
            project.priority = request.data['priority']
        if 'client_facing' in request.data:
            project.client_facing = request.data['client_facing']
        if 'technologies' in request.data:
            project.technologies = request.data['technologies']
        if 'escalation_level' in request.data:
            project.escalation_level = request.data['escalation_level']
        if 'sla_response_time' in request.data:
            project.sla_response_time = request.data['sla_response_time']
        if 'escalation_matrix' in request.data:
            project.escalation_matrix = request.data['escalation_matrix']
        if 'start_date' in request.data:
            project.start_date = request.data['start_date'] or None
        if 'end_date' in request.data:
            project.end_date = request.data['end_date'] or None
            
        if 'project_owner' in request.data:
            try: project.project_owner = Employee.objects.get(id=request.data['project_owner']) if request.data['project_owner'] else None
            except: pass
            
        if 'escalation_contacts' in request.data:
            escalation_contacts = request.data['escalation_contacts']
            if isinstance(escalation_contacts, str):
                import json
                try: escalation_contacts = json.loads(escalation_contacts)
                except: escalation_contacts = []
            if isinstance(escalation_contacts, list):
                project.escalation_contacts.set(Employee.objects.filter(id__in=escalation_contacts))
            
        if 'assignees' in request.data:
            assignees = request.data['assignees']
            if isinstance(assignees, str):
                import json
                try: assignees = json.loads(assignees)
                except: assignees = []
            if isinstance(assignees, list):
                project.assignees.set(Employee.objects.filter(id__in=assignees))
                
        project.save()
        return Response({'success': True, 'message': 'Project updated'})
        
    elif request.method == 'DELETE':
        project.delete()
        return Response({'success': True, 'message': 'Project deleted'})


