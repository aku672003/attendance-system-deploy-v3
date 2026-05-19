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
    path('server-time', views.get_server_time, name='get_server_time'),
    path('today-attendance', views.today_attendance, name='today_attendance'),
    path('attendance-records', views.attendance_records, name='attendance_records'),
    path('monthly-stats', views.monthly_stats, name='monthly_stats'),
    path('wfh-eligibility', views.wfh_eligibility, name='wfh_eligibility'),
    path('wfh-request', views.wfh_request, name='wfh_request'),
    path('leave-request', views.leave_request, name='leave_request'),
    path('leave-request-approve', views.leave_request_approve, name='leave_request_approve'),
    path('wfh-request-approve', views.wfh_request_approve, name='wfh_request_approve'),
    path('my-requests', views.my_requests, name='my_requests'),
    path('mentor-status', views.mentor_status, name='mentor_status'),

    path('unblock-attendance', views.unblock_attendance, name='unblock_attendance'),
    
    # Profile
    path('employee-profile', views.employee_profile, name='employee_profile'),  # GET and POST
    path('check-profile-completeness', views.check_profile_completeness, name='check_profile_completeness'),
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
    path('serve-document/<int:doc_id>', views.serve_document, name='serve_document'),

    # Admin Dashboard
    path('admin-summary', views.admin_summary, name='admin_summary'),
    path('upcoming-birthdays', views.upcoming_birthdays, name='upcoming_birthdays'),
    path('pending-requests', views.pending_requests, name='pending_requests'),
    path('active-tasks', views.active_tasks, name='active_tasks'),

    # Project Management
    path('projects', views.projects_api, name='projects_api'),
    path('projects/<int:project_id>', views.project_detail_api, name='project_detail_api'),

    # Task Management
    path('employees-simple', views.employees_simple_list, name='employees_simple_list'),
    path('tasks', views.tasks_api, name='tasks_api'),
    path('tasks/create', views.create_task, name='create_task'), # Explicit create route
    path('tasks/<int:task_id>', views.task_detail_api, name='task_detail_api'),
    path('bulk-update-tasks', views.bulk_update_tasks, name='bulk_update_tasks'),
    path('task-comment', views.task_comment_api, name='task_comment_api'),
    path('tasks/attach', views.task_attach_api, name='task_attach_api'),
    
    # Team Management
    path('create-team', views.create_team, name='create_team'),
    path('update-team', views.update_team, name='update_team'),
    path('delete-team', views.delete_team, name='delete_team'),
    path('get-teams', views.get_teams, name='get_teams'),

    # Request Management
    path('wfh-request-reject', views.wfh_request_reject, name='wfh_request_reject'),
    
    # Notifications
    path('notifications', views.get_notifications, name='get_notifications'),
    path('mark-notifications-read', views.mark_notifications_read, name='mark_notifications_read'),
    path('send-wish', views.send_birthday_wish, name='send_birthday_wish'),
    path('get-vapid-public-key', views.get_vapid_public_key, name='get_vapid_public_key'),
    path('save-push-subscription', views.save_push_subscription, name='save_push_subscription'),
    
    # Attendance Predictions (Admin only)
    path('attendance-predictions', views.attendance_predictions, name='attendance_predictions'),
    
    # Intelligence Hub (Admin only)
    path('intelligence-hub-forecast', views.intelligence_hub_forecast, name='intelligence_hub_forecast'),
    path('intelligence-hub-trends', views.intelligence_hub_trends, name='intelligence_hub_trends'),
    path('intelligence-hub-search', views.intelligence_hub_search, name='intelligence_hub_search'),
    path('intelligence-hub-train', views.intelligence_hub_train, name='intelligence_hub_train'),
    path('intelligence-hub-training-history', views.intelligence_hub_training_history, name='intelligence_hub_training_history'),
    path('clear-training-history', views.clear_training_history, name='clear_training_history'),
    path('employee-performance-analysis/<int:employee_id>', views.employee_performance_analysis, name='employee_performance_analysis'),
    path('employee-hr-report/<int:employee_id>', views.employee_hr_report, name='employee_hr_report'),
    path('company-predictive-report', views.company_predictive_report, name='company_predictive_report'),
    path('temporary-tags', views.temporary_tags_api, name='temporary_tags_api'),

    # Forgot Password
    path('send-otp', views.send_otp, name='send_otp'),
    path('reset-password', views.reset_password, name='reset_password'),
    path('verify-token', views.verify_token, name='verify_token'),
    path('gated-dashboard', views.gated_dashboard, name='gated_dashboard'),
    path('employee-list-summary', views.employee_list_summary, name='employee_list_summary'),
    
    # Memoji System
    path('avatar-assets', views.avatar_assets_list, name='avatar_assets_list'),
    path('memoji', views.user_memoji_api, name='user_memoji_api'),
    path('memoji/<int:user_id>', views.user_memoji_api, name='user_memoji_api_detail'),
    path('upload-avatar', views.upload_avatar, name='upload_avatar'),
    path('request-new-task', views.request_new_task, name='request_new_task'),
    
    # Meeting Management
    path('meetings', views.meetings_api, name='meetings_api'),
    path('meetings/<int:meeting_id>', views.meeting_detail_api, name='meeting_detail_api'),

    # ── Holiday Management ─────────────────────────────────────────────────────
    path('holidays', views.get_holidays, name='get_holidays'),
    path('holiday-update', views.update_holiday, name='update_holiday'),
    path('holiday-delete', views.delete_holiday, name='delete_holiday'),
    path('holiday-upload-parse', views.holiday_upload_parse, name='holiday_upload_parse'),
    path('holiday-save', views.holiday_save, name='holiday_save'),
    path('holiday-select-optional', views.select_optional_holiday, name='select_optional_holiday'),
    path('holiday-export-ics', views.export_holidays_ics, name='export_holidays_ics'),
    path('holiday-upload-history', views.holiday_upload_history, name='holiday_upload_history'),
    path('manage-date', views.manage_date, name='manage_date'),
]
