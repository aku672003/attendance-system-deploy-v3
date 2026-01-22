from django.urls import path
from . import views

urlpatterns = [
    # Authentication
    path('login', views.login, name='login'),
    path('register', views.register, name='register'),
    
    # Offices
    path('offices', views.offices_list, name='offices_list'),
    path('offices-all', views.offices_list, name='offices_all'),
    path('office', views.create_office, name='create_office'),
    path('office/<str:office_id>', views.office_detail, name='office_detail'),
    path('check-location', views.check_location, name='check_location'),
    
    # Attendance
    path('mark-attendance', views.mark_attendance, name='mark_attendance'),
    path('check-out', views.check_out, name='check_out'),
    path('today-attendance', views.today_attendance, name='today_attendance'),
    path('attendance-records', views.attendance_records, name='attendance_records'),
    path('monthly-stats', views.monthly_stats, name='monthly_stats'),
    path('wfh-eligibility', views.wfh_eligibility, name='wfh_eligibility'),
    path('wfh-request', views.wfh_request, name='wfh_request'),
    path('leave-request', views.leave_request, name='leave_request'),
    path('leave-request-approve', views.leave_request_approve, name='leave_request_approve'),
    path('wfh-request-approve', views.wfh_request_approve, name='wfh_request_approve'),
    
    # Profile
    path('employee-profile', views.employee_profile, name='employee_profile'),  # GET and POST
    path('admin-profiles', views.admin_profiles_list, name='admin_profiles_list'),
    path('admin-profile/<int:employee_id>', views.employee_profile, name='admin_profile_detail'),
    
    # Admin - Users
    path('admin-users', views.admin_users, name='admin_users'),
    path('admin-user/<int:user_id>', views.admin_user_detail, name='admin_user_detail'),
    
    # Admin - Attendance Records
    path('attendance-record/<int:record_id>', views.attendance_record_detail, name='attendance_record_detail'),
    
    # Documents
    path('upload-documents', views.upload_documents, name='upload_documents'),
    path('delete-documents', views.delete_documents, name='delete_documents'),
    path('admin-user-docs-list/<int:employee_id>', views.admin_user_docs_list, name='admin_user_docs_list'),
    path('admin-user-docs/<int:employee_id>', views.admin_user_docs_zip, name='admin_user_docs_zip'),

    # Admin Dashboard
    path('admin-summary', views.admin_summary, name='admin_summary'),
    path('upcoming-birthdays', views.upcoming_birthdays, name='upcoming_birthdays'),
    path('pending-requests', views.pending_requests, name='pending_requests'),
    path('active-tasks', views.active_tasks, name='active_tasks'),

    # Task Management
    path('employees-simple', views.employees_simple_list, name='employees_simple_list'),
    path('tasks', views.tasks_api, name='tasks_api'),
    path('tasks/<int:task_id>', views.task_detail_api, name='task_detail_api'),

    # Request Management
    path('wfh-request-reject', views.wfh_request_reject, name='wfh_request_reject'),
]
