from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager
from django.core.validators import RegexValidator


class EmployeeManager(BaseUserManager):
    def create_user(self, username, password=None, **extra_fields):
        if not username:
            raise ValueError('The Username field must be set')
        user = self.model(username=username, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, password=None, **extra_fields):
        extra_fields.setdefault('role', 'admin')
        extra_fields.setdefault('is_active', True)
        return self.create_user(username, password, **extra_fields)


class Employee(models.Model):
    DEPARTMENT_CHOICES = [
        ('IT', 'IT'),
        ('HR', 'HR'),
        ('Surveyors', 'Surveyors'),
        ('Accounts', 'Accounts'),
        ('Growth', 'Growth'),
        ('Others', 'Others'),
    ]
    
    ROLE_CHOICES = [
        ('employee', 'Employee'),
        ('manager', 'Manager'),
        ('admin', 'Admin'),
    ]

    username = models.CharField(max_length=50, unique=True)
    password = models.CharField(max_length=255)  # Hashed password
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20)
    department = models.CharField(max_length=20, choices=DEPARTMENT_CHOICES)
    primary_office = models.CharField(max_length=10)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='employee')
    manager = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='subordinates')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employees'
        indexes = [
            models.Index(fields=['username']),
            models.Index(fields=['email']),
            models.Index(fields=['department']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return self.username

    def get_current_assignment(self):
        """Check for active temporary tags and return current department and role"""
        from django.utils import timezone
        today = timezone.localtime(timezone.now()).date()
        
        active_tag = TemporaryTag.objects.filter(
            employee=self,
            start_date__lte=today,
            end_date__gte=today
        ).first()
        
        if active_tag:
            return {
                'department': active_tag.department,
                'role': active_tag.role,
                'is_temporary': True
            }
            
        return {
            'department': self.department,
            'role': self.role,
            'is_temporary': False
        }


class EmployeeProfile(models.Model):
    MARITAL_STATUS_CHOICES = [
        ('single', 'Single'),
        ('married', 'Married'),
        ('divorced', 'Divorced'),
        ('widowed', 'Widowed'),
        ('other', 'Other'),
    ]
    
    GENDER_CHOICES = [
        ('male', 'Male'),
        ('female', 'Female'),
        ('other', 'Other'),
        ('prefer_not_to_say', 'Prefer not to say'),
    ]

    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name='profile')
    emergency_contact_name = models.CharField(max_length=100, null=True, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, null=True, blank=True)
    alternate_number = models.CharField(max_length=20, null=True, blank=True)
    bank_account_number = models.CharField(max_length=50, null=True, blank=True)
    bank_ifsc = models.CharField(max_length=20, null=True, blank=True)
    bank_bank_name = models.CharField(max_length=100, null=True, blank=True)
    pan_number = models.CharField(max_length=20, null=True, blank=True)
    aadhar_number = models.CharField(max_length=20, null=True, blank=True)
    qualification = models.CharField(max_length=255, null=True, blank=True)
    certificates_summary = models.TextField(null=True, blank=True)
    home_address = models.TextField(null=True, blank=True)
    current_address = models.TextField(null=True, blank=True)
    date_of_joining = models.DateField(null=True, blank=True)
    skill_set = models.TextField(null=True, blank=True)
    reporting_manager = models.CharField(max_length=100, null=True, blank=True)
    planned_leaves = models.IntegerField(default=0)
    unplanned_leaves = models.IntegerField(default=0)
    professional_training = models.TextField(null=True, blank=True)
    family_details = models.TextField(null=True, blank=True)
    marital_status = models.CharField(max_length=20, choices=MARITAL_STATUS_CHOICES, null=True, blank=True)
    personal_email = models.EmailField(null=True, blank=True)
    gender = models.CharField(max_length=20, choices=GENDER_CHOICES, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    documents_pdf_path = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employee_profiles'

    def __str__(self):
        return f"{self.employee.username} - Profile"


class OfficeLocation(models.Model):
    id = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=100)
    address = models.TextField()
    latitude = models.DecimalField(max_digits=10, decimal_places=8)
    longitude = models.DecimalField(max_digits=11, decimal_places=8)
    radius_meters = models.IntegerField(default=50)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'office_locations'

    def __str__(self):
        return self.name


class DepartmentOfficeAccess(models.Model):
    DEPARTMENT_CHOICES = [
        ('IT', 'IT'),
        ('HR', 'HR'),
        ('Surveyors', 'Surveyors'),
        ('Accounts', 'Accounts'),
        ('Growth', 'Growth'),
        ('Others', 'Others'),
    ]

    department = models.CharField(max_length=20, choices=DEPARTMENT_CHOICES)
    office = models.ForeignKey(OfficeLocation, on_delete=models.CASCADE, related_name='department_access')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'department_office_access'
        unique_together = [['department', 'office']]

    def __str__(self):
        return f"{self.department} - {self.office.name}"


class AttendanceRecord(models.Model):
    TYPE_CHOICES = [
        ('office', 'Office'),
        ('wfh', 'Work From Home'),
        ('client', 'Client'),
    ]
    
    STATUS_CHOICES = [
        ('present', 'Present'),
        ('half_day', 'Half Day'),
        ('wfh', 'Work From Home'),
        ('client', 'Client'),
        ('absent', 'Absent'),
        ('leave', 'Leave'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='attendance_records')
    date = models.DateField()
    check_in_time = models.TimeField(null=True, blank=True)
    check_out_time = models.TimeField(null=True, blank=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    office = models.ForeignKey(OfficeLocation, on_delete=models.SET_NULL, null=True, blank=True, related_name='attendance_records')
    check_in_location = models.JSONField(null=True, blank=True)
    check_out_location = models.JSONField(null=True, blank=True)
    check_in_photo = models.TextField(null=True, blank=True)  # Base64 or file path
    check_out_photo = models.TextField(null=True, blank=True)  # Base64 or file path
    lunch_start_time = models.TimeField(null=True, blank=True)
    lunch_end_time = models.TimeField(null=True, blank=True)
    lunch_start_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lunch_start_lon = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lunch_end_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lunch_end_lon = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    total_hours = models.DecimalField(max_digits=4, decimal_places=2, default=0.00)
    is_half_day = models.BooleanField(default=False)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'attendance_records'
        unique_together = [['employee', 'date']]
        indexes = [
            models.Index(fields=['employee', 'date']),
            models.Index(fields=['date']),
            models.Index(fields=['type']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"{self.employee.username} - {self.date}"


class EmployeeRequest(models.Model):
    REQUEST_TYPE_CHOICES = [
        ('wfh', 'Work From Home'),
        ('full_day', 'Full Day Leave'),
        ('half_day', 'Half Day Leave'),
    ]

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='requests')
    request_type = models.CharField(max_length=20, choices=REQUEST_TYPE_CHOICES)
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    half_day_period = models.CharField(max_length=20, choices=[('first_half', 'First Half'), ('second_half', 'Second Half')], null=True, blank=True)
    
    admin_response = models.TextField(null=True, blank=True)
    reviewed_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='reviewed_requests')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employee_requests'
        indexes = [
            models.Index(fields=['employee']),
            models.Index(fields=['status']),
            models.Index(fields=['start_date']),
            models.Index(fields=['request_type']),
        ]

    def __str__(self):
        return f"{self.employee.username} - {self.request_type} - {self.start_date}"


class EmployeeDocument(models.Model):
    DOC_TYPE_CHOICES = [
        ('photo', 'Photo'),
        ('signature', 'Signature'),
        ('aadhar', 'Aadhaar Card'),
        ('pan', 'PAN Card'),
        ('other_id', 'Other ID'),
        ('highest_qualification', 'Highest Qualification'),
        ('professional_certificate', 'Professional Certificate'),
        ('other_qualification', 'Other Qualification'),
    ]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='documents')
    doc_type = models.CharField(max_length=50, choices=DOC_TYPE_CHOICES)
    doc_name = models.CharField(max_length=100)
    doc_number = models.CharField(max_length=100, null=True, blank=True)
    file_name = models.CharField(max_length=255)
    file_path = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'employee_documents'
        indexes = [
            models.Index(fields=['employee', 'doc_type']),
        ]

    def __str__(self):
        return f"{self.employee.username} - {self.doc_type}"


class Task(models.Model):
    STATUS_CHOICES = [
        ('todo', 'To Do'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
    ]

    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ]

    title = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='todo')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')

    manager = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='supervised_tasks')
    created_by = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='created_tasks')
    due_date = models.DateField(null=True, blank=True)
    accuracy = models.IntegerField(null=True, blank=True) # Task accuracy score (0-100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    assignees = models.ManyToManyField(Employee, related_name='assigned_tasks')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'tasks'
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['created_by']),
            models.Index(fields=['due_date']),
        ]

    def __str__(self):
        return f"{self.title} (Team Task)"


class TaskComment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='task_comments')
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'task_comments'
        ordering = ['created_at']

    def __str__(self):
        return f"Comment by {self.author.name} on {self.task.title}"


class BirthdayWish(models.Model):
    sender = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='sent_wishes')
    receiver = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='received_wishes')
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'birthday_wishes'
        indexes = [
            models.Index(fields=['receiver']),
            models.Index(fields=['is_read']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"Wish from {self.sender.name} to {self.receiver.name}"


class Team(models.Model):
    name = models.CharField(max_length=100)
    manager = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='managed_teams')
    members = models.ManyToManyField(Employee, related_name='teams')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'teams'
        unique_together = [['name', 'manager']]

    def __str__(self):
        return f"{self.name} (Manager: {self.manager.username})"


class TemporaryTag(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='temporary_tags')
    department = models.CharField(max_length=20, choices=Employee.DEPARTMENT_CHOICES)
    role = models.CharField(max_length=20, choices=Employee.ROLE_CHOICES)
    start_date = models.DateField()
    end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'temporary_tags'
        indexes = [
            models.Index(fields=['employee', 'start_date', 'end_date']),
        ]

    def __str__(self):
        return f"Temp Tag: {self.employee.username} ({self.department}/{self.role})"


class TrainingLog(models.Model):
    trained_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, related_name='training_logs')
    timestamp = models.DateTimeField(auto_now_add=True)
    data_points = models.IntegerField()
    average_rate = models.FloatField()
    stability_factor = models.FloatField()
    logs = models.JSONField(null=True, blank=True)
    summary = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = 'training_logs'
        ordering = ['-timestamp']

    def __str__(self):
        return f"Training Log {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')} - Accuracy: {self.stability_factor}"
