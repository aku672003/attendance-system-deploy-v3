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

# --- Function: _get_s3_client ---
def _get_s3_client():
    """Returns (s3_client, bucket, prefix, use_s3).
    If AWS creds are configured returns a real boto3 client.
    If not, returns (None, None, None, False) so callers fall back to local disk.
    """
    import boto3
    aws_key    = getattr(settings, 'AWS_ACCESS_KEY_ID', None)
    aws_secret = getattr(settings, 'AWS_SECRET_ACCESS_KEY', None)
    S3_BUCKET  = getattr(settings, 'S3_BUCKET_NAME', 'attendance-g37k8w69fo65xagoo39ek3g58hc14aps3a-s3alias')
    S3_REGION  = getattr(settings, 'AWS_DEFAULT_REGION', 'ap-south-1')
    S3_PREFIX  = 'Employee_docs/'

    boto3_kwargs = {'region_name': S3_REGION}
    if aws_key and aws_secret:
        boto3_kwargs['aws_access_key_id']     = aws_key
        boto3_kwargs['aws_secret_access_key'] = aws_secret

    # Only attempt S3 when at least one credential signal is present
    use_s3 = bool(aws_key and aws_secret)
    if not use_s3:
        return None, S3_BUCKET, S3_PREFIX, False

    try:
        client = boto3.client('s3', **boto3_kwargs)
        return client, S3_BUCKET, S3_PREFIX, True
    except Exception:
        return None, S3_BUCKET, S3_PREFIX, False




# --- Function: upload_documents ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([MultiPartParser, FormParser])
def upload_documents(request):
    """Upload employee documents — S3 when credentials are set, local disk otherwise."""
    employee_id = request.POST.get('employee_id')
    username    = request.POST.get('username')

    if not employee_id or not username:
        return Response({'success': False, 'message': 'employee_id and username are required'},
                        status=status.HTTP_400_BAD_REQUEST)

    # Ownership check: ensure caller can only upload for themselves (or admin for anyone)
    caller = get_current_user(request, requested_id=employee_id)
    if not caller:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)

    try:
        employee = Employee.objects.get(id=employee_id)
    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'Employee not found'},
                        status=status.HTTP_404_NOT_FOUND)

    MAX_PHOTO_SIZE = 2 * 1024 * 1024  # 2 MB
    MAX_PDF_SIZE   = 5 * 1024 * 1024  # 5 MB

    saved_files = []
    s3_client, S3_BUCKET, S3_PREFIX, use_s3 = _get_s3_client()

    # --- local-disk fallback setup ---
    import os
    storage_root   = getattr(settings, 'DOCUMENT_STORAGE_ROOT', settings.MEDIA_ROOT)
    safe_name      = "".join(c if c.isalnum() or c in ' _-' else '' for c in employee.name).strip().replace(' ', '_')
    employee_folder = f"{safe_name}_{employee.id}"
    upload_dir     = os.path.join(storage_root, 'Documents', employee_folder)
    if not use_s3:
        os.makedirs(upload_dir, exist_ok=True)

    def _save_file(file, filename, doc_type, content_type):
        """Save to S3 or local disk; return the file_path string stored in DB."""
        if use_s3:
            s3_key = f"{S3_PREFIX}{username}/{filename}"
            s3_client.upload_fileobj(file, S3_BUCKET, s3_key,
                                     ExtraArgs={'ContentType': content_type})
            return s3_key
        else:
            local_path = os.path.join(upload_dir, filename)
            with open(local_path, 'wb') as fh:
                for chunk in file.chunks():
                    fh.write(chunk)
            return f'Documents/{employee_folder}/{filename}'

    # ── Photo / Signature ──────────────────────────────────────────────────────
    image_docs = {'user_photo': 'photo', 'user_signature': 'signature'}
    for input_name, doc_type in image_docs.items():
        if input_name not in request.FILES:
            continue
        file = request.FILES[input_name]
        if file.size > MAX_PHOTO_SIZE:
            return Response({'success': False,
                             'message': f'{doc_type.capitalize()} size exceeds 2 MB limit'},
                            status=status.HTTP_400_BAD_REQUEST)
        if file.content_type not in ['image/jpeg', 'image/png', 'image/jpg']:
            continue

        ext      = os.path.splitext(file.name)[1].lower()
        filename = f"{username}_{doc_type}{ext}"
        EmployeeDocument.objects.filter(employee_id=employee_id, doc_type=doc_type).delete()
        try:
            file_path = _save_file(file, filename, doc_type, file.content_type)
        except Exception as e:
            return Response({'success': False, 'message': f'Upload failed: {str(e)}'}, status=500)

        EmployeeDocument.objects.create(
            employee_id=employee_id, doc_type=doc_type,
            doc_name=doc_type.capitalize(), file_name=filename, file_path=file_path)
        saved_files.append(filename)

    # ── PDF documents ──────────────────────────────────────────────────────────
    pdf_docs = ['aadhar', 'pan', 'other_id', 'highest_qualification',
                'professional_certificate', 'other_qualification']
    for doc_type in pdf_docs:
        file_key = f'file_{doc_type}'
        if file_key not in request.FILES:
            continue
        file = request.FILES[file_key]
        if file.size > MAX_PDF_SIZE:
            return Response({'success': False,
                             'message': f'{doc_type.capitalize()} file exceeds 5 MB limit'},
                            status=status.HTTP_400_BAD_REQUEST)
        if file.content_type != 'application/pdf':
            continue

        filename = request.POST.get(f'{file_key}_filename', f"{username}_{doc_type}.pdf")
        filename = ''.join(c if c.isalnum() or c in '._-' else '_' for c in filename)
        EmployeeDocument.objects.filter(employee_id=employee_id, doc_type=doc_type).delete()
        try:
            file_path = _save_file(file, filename, doc_type, 'application/pdf')
        except Exception as e:
            return Response({'success': False, 'message': f'Upload failed: {str(e)}'}, status=500)

        EmployeeDocument.objects.create(
            employee_id=employee_id, doc_type=doc_type,
            doc_name=doc_type.replace('_', ' ').title(),
            doc_number=request.POST.get(f'doc{doc_type.capitalize()}Number', ''),
            file_name=filename, file_path=file_path)
        saved_files.append(filename)

    if not saved_files:
        return Response({'success': False, 'message': 'No valid documents uploaded'},
                        status=status.HTTP_400_BAD_REQUEST)

    return Response({'success': True, 'uploaded': saved_files,
                     'message': 'Documents uploaded successfully'})




# --- Function: delete_documents ---
@api_view(['POST'])
@require_gated_token_api
@parser_classes([JSONParser])
def delete_documents(request):
    """Delete selected documents (admin only)"""
    # Verify caller is admin
    caller = get_current_user(request, require_admin=True)
    if not caller:
        return Response({'success': False, 'message': 'Admin access required'}, status=403)

    data    = request.data
    doc_ids = data.get('document_ids', [])

    if not doc_ids:
        return Response({'success': False, 'message': 'No documents selected'},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        documents = EmployeeDocument.objects.filter(id__in=doc_ids)
        s3_client, S3_BUCKET, S3_PREFIX, use_s3 = _get_s3_client()

        for doc in documents:
            if doc.file_path.startswith(S3_PREFIX) and use_s3:
                try:
                    s3_client.delete_object(Bucket=S3_BUCKET, Key=doc.file_path)
                except Exception:
                    pass
            elif not doc.file_path.startswith(S3_PREFIX):
                import os
                storage_root = getattr(settings, 'DOCUMENT_STORAGE_ROOT', settings.MEDIA_ROOT)
                file_path = os.path.join(storage_root, doc.file_path)
                if os.path.exists(file_path):
                    os.remove(file_path)

        documents.delete()
        return Response({'success': True, 'message': 'Documents deleted successfully'})
    except Exception as e:
        return Response({'success': False, 'message': 'Failed to delete documents'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: admin_user_docs_list ---
@api_view(['GET'])
@require_gated_token_api
def admin_user_docs_list(request, employee_id):
    """List documents for a user (admin only)"""
    # Verify caller is admin or the employee themselves
    caller = get_current_user(request, requested_id=employee_id)
    if not caller:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)

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
                'url': request.build_absolute_uri(f'/api/serve-document/{doc.id}'),
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




# --- Function: admin_user_docs_zip ---
@api_view(['GET'])
@require_gated_token_api
def admin_user_docs_zip(request, employee_id):
    """Download all documents as ZIP (admin only)"""
    # Verify caller is admin
    caller = get_current_user(request, require_admin=True)
    if not caller:
        return Response({'success': False, 'message': 'Admin access required'}, status=403)

    try:
        employee  = Employee.objects.get(id=employee_id)
        documents = EmployeeDocument.objects.filter(employee_id=employee_id)

        if not documents.exists():
            return Response({'success': False, 'message': 'No documents found'},
                            status=status.HTTP_404_NOT_FOUND)

        import tempfile, zipfile, os
        zip_name  = f"{employee.username}_documents.zip"
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')

        s3_client, S3_BUCKET, S3_PREFIX, use_s3 = _get_s3_client()

        with zipfile.ZipFile(temp_file.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for doc in documents:
                if doc.file_path.startswith(S3_PREFIX) and use_s3:
                    try:
                        s3_obj = s3_client.get_object(Bucket=S3_BUCKET, Key=doc.file_path)
                        zipf.writestr(doc.file_name, s3_obj['Body'].read())
                    except Exception:
                        pass
                elif not doc.file_path.startswith(S3_PREFIX):
                    storage_root = getattr(settings, 'DOCUMENT_STORAGE_ROOT', settings.MEDIA_ROOT)
                    file_path = os.path.join(storage_root, doc.file_path)
                    if os.path.exists(file_path):
                        zipf.write(file_path, doc.file_name)

        response = FileResponse(open(temp_file.name, 'rb'), content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{zip_name}"'
        # Schedule temp file cleanup after response is sent
        import atexit
        atexit.register(lambda path=temp_file.name: os.unlink(path) if os.path.exists(path) else None)
        return response

    except Employee.DoesNotExist:
        return Response({'success': False, 'message': 'User not found'},
                        status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'success': False, 'message': 'Failed to create ZIP'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)




# --- Function: serve_document ---
@api_view(['GET'])
@require_gated_token_api
def serve_document(request, doc_id):
    """Serve a document — from S3 if configured, otherwise from local disk."""
    # Verify caller is authenticated
    caller = get_current_user(request)
    if not caller:
        return Response({'success': False, 'message': 'Unauthorized'}, status=403)

    try:
        doc = EmployeeDocument.objects.get(id=doc_id)
        
        # Ownership check: only the doc owner or admin can access
        if doc.employee_id != caller.id and caller.role != 'admin':
            return Response({'success': False, 'message': 'Unauthorized'}, status=403)

        S3_PREFIX = 'Employee_docs/'
        if doc.file_path.startswith(S3_PREFIX):
            # Try S3 first
            s3_client, S3_BUCKET, _, use_s3 = _get_s3_client()
            if use_s3:
                from urllib.parse import quote
                try:
                    s3_obj     = s3_client.get_object(Bucket=S3_BUCKET, Key=doc.file_path)
                    ctype      = s3_obj.get('ContentType', 'application/octet-stream')
                    response   = FileResponse(s3_obj['Body'], content_type=ctype)
                    response['Content-Disposition'] = f'inline; filename="{quote(doc.file_name)}"'
                    return response
                except Exception:
                    return Response({'error': 'File not found in S3'}, status=404)
            else:
                return Response({'error': 'S3 not configured and file is stored in S3'}, status=404)
        else:
            import os, mimetypes
            storage_root = getattr(settings, 'DOCUMENT_STORAGE_ROOT', settings.MEDIA_ROOT)
            file_path    = os.path.join(storage_root, doc.file_path)
            if not os.path.exists(file_path):
                return Response({'error': 'File not found'}, status=404)
            ctype, _ = mimetypes.guess_type(file_path)
            return FileResponse(open(file_path, 'rb'),
                                content_type=ctype or 'application/octet-stream')
    except EmployeeDocument.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)
    except Exception as e:
        return Response({'error': str(e)}, status=500)


# Admin Dashboard API Views


