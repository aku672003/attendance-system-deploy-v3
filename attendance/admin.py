from django.contrib import admin
from .models import (
    Employee, EmployeeProfile, OfficeLocation, DepartmentOfficeAccess,
    AttendanceRecord, WFHRequest, EmployeeDocument
)


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
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


@admin.register(WFHRequest)
class WFHRequestAdmin(admin.ModelAdmin):
    list_display = ['id', 'employee', 'requested_date', 'status']
    list_filter = ['status', 'requested_date']
    search_fields = ['employee__username']


@admin.register(EmployeeDocument)
class EmployeeDocumentAdmin(admin.ModelAdmin):
    list_display = ['id', 'employee', 'doc_type', 'doc_name', 'uploaded_at']
    list_filter = ['doc_type', 'uploaded_at']
    search_fields = ['employee__username', 'doc_name']

