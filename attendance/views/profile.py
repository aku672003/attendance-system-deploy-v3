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

# --- Function: employee_profile ---
@api_view(['GET', 'POST', 'PATCH'])
@require_gated_token_api
@parser_classes([JSONParser])
def employee_profile(request, employee_id=None):
    """Get or save employee profile"""
    
    # Handle PATCH (partial update, e.g. for theme settings)
    if request.method == 'PATCH':
        data = request.data
        employee_id = employee_id or data.get('employee_id')

        if not employee_id:
            return Response({'success': False, 'message': 'Employee ID is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            employee = Employee.objects.get(id=employee_id)
            profile, created = EmployeeProfile.objects.get_or_create(employee=employee)
            if 'theme_settings' in data:
                profile.theme_settings = data.get('theme_settings')
                profile.save()
            return Response({'success': True, 'message': 'Profile updated successfully'})
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Handle POST (save profile)
    if request.method == 'POST':
        data = request.data
        employee_id = employee_id or data.get('employee_id')

        if not employee_id:
            return Response({
                'success': False,
                'message': 'Employee ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            employee = Employee.objects.get(id=employee_id)
            profile, created = EmployeeProfile.objects.get_or_create(employee=employee)

            # Update profile fields
            if 'emergency_contact_name' in data:
                profile.emergency_contact_name = data.get('emergency_contact_name')
            if 'emergency_contact_phone' in data:
                profile.emergency_contact_phone = data.get('emergency_contact_phone')
            if 'alternate_number' in data:
                profile.alternate_number = data.get('alternate_number')
            if 'bank_account_number' in data:
                profile.bank_account_number = data.get('bank_account_number')
            if 'bank_ifsc' in data:
                profile.bank_ifsc = data.get('bank_ifsc')
            if 'bank_name' in data:
                profile.bank_bank_name = data.get('bank_name')
            if 'pan_number' in data:
                profile.pan_number = data.get('pan_number')
            if 'aadhar_number' in data:
                profile.aadhar_number = data.get('aadhar_number')
            if 'highest_qualification' in data:
                profile.qualification = data.get('highest_qualification')
            if 'qualification_notes' in data:
                profile.certificates_summary = data.get('qualification_notes')
            if 'home_address' in data:
                profile.home_address = data.get('home_address')
            if 'current_address' in data:
                profile.current_address = data.get('current_address')
            if 'date_of_joining' in data:
                profile.date_of_joining = data.get('date_of_joining') or None
            if 'skill_set' in data:
                profile.skill_set = data.get('skill_set')
            if 'reporting_mentor' in data:
                profile.reporting_mentor = data.get('reporting_mentor')
            if 'professional_training' in data:
                profile.professional_training = data.get('professional_training')
            if 'family_details' in data:
                profile.family_details = data.get('family_details')
            if 'marital_status' in data:
                profile.marital_status = data.get('marital_status')
            if 'personal_email' in data:
                profile.personal_email = data.get('personal_email')
            if 'gender' in data:
                profile.gender = data.get('gender')
            if 'date_of_birth' in data:
                profile.date_of_birth = data.get('date_of_birth') or None
            
            # Personalization fields
            if 'avatar_emoji' in data:
                profile.avatar_emoji = data['avatar_emoji']
            if 'theme_settings' in data:
                profile.theme_settings = data['theme_settings']
            if 'avatar_url' in data and data['avatar_url']:
                profile.avatar_url = data['avatar_url']
                
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
    employee_id = employee_id or request.GET.get('employee_id')

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
                'url': request.build_absolute_uri(f'/api/serve-document/{doc.id}'),
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
            'reporting_mentor': ", ".join([m.name for m in employee.mentors.all()]) if employee.mentors.exists() else profile.reporting_mentor,
            'professional_training': profile.professional_training,
            'family_details': profile.family_details,
            'marital_status': profile.marital_status,
            'personal_email': profile.personal_email,
            'gender': profile.gender,
            'date_of_birth': str(profile.date_of_birth) if profile.date_of_birth else None,
            'avatar_emoji': profile.avatar_emoji,
            'avatar_url': profile.avatar_url,
            'theme_settings': profile.theme_settings,
            'documents': docs_data,
            'total_cl': profile.total_cl,
            'taken_cl': profile.taken_cl,
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




# --- Function: check_profile_completeness ---
@api_view(['GET'])
@require_gated_token_api
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




# --- Function: admin_profiles_list ---
@api_view(['GET'])
@require_gated_token_api
def admin_profiles_list(request):
    """List all employee profiles (admin)"""
    user = get_current_user(request, requested_id=request.GET.get('user_id'))
    if not user:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)
    
    # Include de-facto Mentors (any user who has subordinates)
    is_mentor = user and (user.role == 'mentor' or (user.role != 'admin' and user.subordinates.exists()))

    try:
        employees_qs = Employee.objects.filter(is_active=True)
        if is_mentor:
            employees_qs = employees_qs.filter(mentors=user)

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
                'reporting_mentor': profile.reporting_mentor if profile else None,
                'docs_count': emp.docs_count,
                'role': emp.role,
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


# --- Function: admin_users ---
@api_view(['GET'])
@require_gated_token_api
def admin_users(request):
    """Get all users (admin)"""
    user = get_current_user(request, requested_id=request.GET.get('user_id'))
    if not user:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)
    
    # Include de-facto Mentors (any user who has subordinates)
    is_mentor = user and (user.role == 'mentor' or (user.role != 'admin' and user.subordinates.exists()))

    try:
        # Include active task names and counts
        active_tasks_qs = Task.objects.filter(status__in=['todo', 'in_progress'])
        users = Employee.objects.all().order_by('-id').prefetch_related(
            'profile', 
            'mentors',
            Prefetch('assigned_tasks', queryset=active_tasks_qs, to_attr='active_tasks_list')
        ).annotate(
            active_tasks_count_db=Count('assigned_tasks', filter=Q(assigned_tasks__status__in=['todo', 'in_progress']), distinct=True)
        )
        
        if is_mentor:
            users = users.filter(mentors=user)
        
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
                'Mentor_name': ", ".join([m.name for m in u.mentors.all()]) if u.mentors.all() else None,
                'is_active': u.is_active,
                'date_of_birth': dob,
                'gender': gender,
                'active_tasks': [{'id': t.id, 'title': t.title} for t in u.active_tasks_list] if hasattr(u, 'active_tasks_list') else [],
                'active_tasks_count': getattr(u, 'active_tasks_count_db', 0)
            })

        return Response({
            'success': True,
            'users': users_data
        })
    except Exception as e:
        import logging; logging.getLogger('attendance').exception('Error in admin_users')
        return Response({
            'success': False,
            'message': f'Failed to fetch users: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: admin_user_detail ---
@api_view(['GET', 'POST', 'DELETE'])
@require_gated_token_api
@parser_classes([JSONParser])
def admin_user_detail(request, user_id):
    """Get, update, or delete a user (admin)"""
    # Verify caller is an admin
    caller = get_current_user(request, require_admin=True)
    if not caller:
        return Response({'success': False, 'message': 'Admin access required'}, status=403)

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
                'mentor_ids': [m.id for m in employee.mentors.all()],
                'Mentor_names': [m.name for m in employee.mentors.all()],
                'mentor_id': employee.mentors.all()[0].id if employee.mentors.exists() else None,
                'Mentor_name': employee.mentors.all()[0].name if employee.mentors.exists() else None,
                'is_active': employee.is_active,
                'total_cl': employee.profile.total_cl if hasattr(employee, 'profile') else 12,
                'taken_cl': employee.profile.taken_cl if hasattr(employee, 'profile') else 0,
                'date_of_joining': str(employee.profile.date_of_joining) if hasattr(employee, 'profile') and employee.profile.date_of_joining else None,
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
        mentor_changed = False
        new_mentor_names = ""
        if data.get('mentor_ids'):
            mentor_ids = data.get('mentor_ids')
            if isinstance(mentor_ids, list):
                if 'none' in mentor_ids:
                    employee.mentors.clear()
                else:
                    new_mentors = Employee.objects.filter(id__in=mentor_ids)
                    employee.mentors.set(new_mentors)
                    new_mentor_names = ", ".join([m.name for m in new_mentors])
                    mentor_changed = True
        elif data.get('mentor_id'):
            if data['mentor_id'] == 'none':
                employee.mentors.clear()
            else:
                try:
                    Mentor_emp = Employee.objects.get(id=data['mentor_id'])
                    employee.mentors.set([Mentor_emp])
                    new_mentor_names = Mentor_emp.name
                    mentor_changed = True
                except Employee.DoesNotExist:
                    pass
        elif 'mentor_id' in data and not data.get('mentor_id'):
            employee.mentors.clear()

        if mentor_changed:
            _send_task_notification(employee, f"Admin has assigned you new mentor(s): {new_mentor_names}", None, type="mentor_assigned")

        if 'is_active' in data:
            employee.is_active = bool(data['is_active'])
        
        # Update Profile fields
        profile, created = EmployeeProfile.objects.get_or_create(employee=employee)
        if 'total_cl' in data:
            profile.total_cl = int(data['total_cl'])
        if 'taken_cl' in data:
            profile.taken_cl = int(data['taken_cl'])
        if 'date_of_joining' in data:
            profile.date_of_joining = data['date_of_joining'] if data['date_of_joining'] else None
        profile.save()

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




# --- Function: employee_list_summary ---
@api_view(['GET'])
@require_gated_token_api
def employee_list_summary(request):
    """
    Returns a simplified list of active employees including:
    name, department, phone, and role.
    """
    try:
        employees = Employee.objects.filter(is_active=True).values(
            'name', 'department', 'phone', 'role'
        ).order_by('name')
        return Response({
            'success': True,
            'employees': list(employees)
        }, status=status.HTTP_200_OK)
    except Exception as e:
        return Response({
            'success': False,
            'message': f'Failed to fetch employee list: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



