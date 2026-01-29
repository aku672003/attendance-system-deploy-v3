from django.contrib import admin
from django import forms
from django.contrib.auth.hashers import make_password
from .models import (
    Employee, EmployeeProfile, OfficeLocation, DepartmentOfficeAccess,
    AttendanceRecord, EmployeeDocument, Task, EmployeeRequest
)


class EmployeeAdminForm(forms.ModelForm):
    class Meta:
        model = Employee
        fields = '__all__'

    def save(self, commit=True):
        user = super().save(commit=False)
        # Hash password if it's not already hashed (basic check)
        if user.password and not user.password.startswith('pbkdf2_sha256$'):
             user.password = make_password(user.password)
        if commit:
            user.save()
        return user


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    form = EmployeeAdminForm
    list_display = ['id', 'username', 'name', 'email', 'department', 'role', 'is_active']
    list_filter = ['department', 'role', 'is_active']
    search_fields = ['username', 'name', 'email']


@admin.register(EmployeeProfile)
class EmployeeProfileAdmin(admin.ModelAdmin):
    list_display = ['employee', 'date_of_joining', 'personal_email']
    search_fields = ['employee__username', 'employee__name']


@admin.register(OfficeLocation)
class OfficeLocationAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'address', 'is_active']
    list_filter = ['is_active']


@admin.register(DepartmentOfficeAccess)
class DepartmentOfficeAccessAdmin(admin.ModelAdmin):
    list_display = ['department', 'office']
    list_filter = ['department']


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ['id', 'employee', 'date', 'type', 'status', 'check_in_time', 'check_out_time']
    list_filter = ['type', 'status', 'date']
    search_fields = ['employee__username', 'employee__name']
    date_hierarchy = 'date'


@admin.register(EmployeeRequest)
class EmployeeRequestAdmin(admin.ModelAdmin):
    list_display = ['id', 'employee', 'request_type', 'start_date', 'status']
    list_filter = ['status', 'request_type', 'start_date']
    search_fields = ['employee__username']


@admin.register(EmployeeDocument)
class EmployeeDocumentAdmin(admin.ModelAdmin):
    list_display = ['id', 'employee', 'doc_type', 'doc_name', 'uploaded_at']
    list_filter = ['doc_type', 'uploaded_at']
    search_fields = ['employee__username', 'doc_name']


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'status', 'priority', 'assigned_to', 'due_date']
    list_filter = ['status', 'priority', 'due_date']
    search_fields = ['title', 'description', 'assigned_to__username']
    date_hierarchy = 'created_at'
