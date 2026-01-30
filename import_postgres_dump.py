import os
import sys
import traceback

def log(msg):
    with open("migration.log", "a") as f:
        f.write(str(msg) + "\n")
    print(msg, flush=True)

if __name__ == '__main__':
    try:
        log("Starting migration script...")
        import django
        import datetime
        from decimal import Decimal
        
        # Setup Django environment
        log(f"CWD: {os.getcwd()}")
        sys.path.append(os.getcwd())
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_system.settings')
        
        log("Calling django.setup()...")
        django.setup()
        log("Django setup complete.")

        from attendance.models import (
            Employee, 
            EmployeeProfile, 
            OfficeLocation, 
            DepartmentOfficeAccess, 
            AttendanceRecord, 
            EmployeeRequest, 
            EmployeeDocument
        )
        from django.db import transaction

        def parse_copy_value(val):
            if val == '\\N':
                return None
            return val

        def parse_bool(val):
            if val == 't':
                return True
            if val == 'f':
                return False
            return bool(val)

        def run_migration():
            sql_file = 'attendance_system_today.sql'
            
            table_map = {
                'public.employees': 'employees',
                'public.employee_profiles': 'employee_profiles',
                'public.office_locations': 'office_locations',
                'public.department_office_access': 'department_office_access',
                'public.attendance_records': 'attendance_records',
                'public.wfh_requests': 'wfh_requests',
                'public.employee_documents': 'employee_documents',
            }
            
            current_table = None
            
            data_store = {
                'employees': [],
                'employee_profiles': [],
                'office_locations': [],
                'department_office_access': [],
                'attendance_records': [],
                'wfh_requests': [],
                'employee_documents': [],
            }
            
            log(f"Reading {sql_file}...")
            with open(sql_file, 'r', encoding='utf-8') as f:
                in_copy = False
                for line in f:
                    line = line.strip()
                    if line.startswith('COPY '):
                        parts = line.split(' ')
                        table_name = parts[1]
                        if table_name in table_map:
                            current_table = table_map[table_name]
                            in_copy = True
                            log(f"Parsing table: {current_table}")
                        else:
                            current_table = None
                    elif line == r'\.':
                        in_copy = False
                        current_table = None
                    elif in_copy and current_table:
                        if not line or line.startswith('--'):
                            continue
                        row = line.split('\t')
                        
                        expected_counts = {
                            'employees': 12,
                            'employee_profiles': 28,
                            'office_locations': 9,
                            'department_office_access': 3,
                            'attendance_records': 17,
                            'wfh_requests': 10,
                            'employee_documents': 8,
                        }
                        
                        if len(row) < expected_counts.get(current_table, 0):
                            log(f"Skipping invalid row in {current_table}: len {len(row)} expected {expected_counts.get(current_table)}")
                            continue
                            
                        data_store[current_table].append(row)

            log("Data parsing complete. Starting insertion...")
            
            with transaction.atomic():
                log("Clearing existing data...")
                EmployeeRequest.objects.all().delete()
                AttendanceRecord.objects.all().delete()
                EmployeeDocument.objects.all().delete()
                DepartmentOfficeAccess.objects.all().delete()
                EmployeeProfile.objects.all().delete()
                # Determine deletion order for Employee vs OfficeLocation due to foreign keys?
                # Employee has no FK to OfficeLocation (only char field primary_office).
                # But DepartmentOfficeAccess has.
                # Task/etc will cascade delete when Employee is deleted.
                Employee.objects.all().delete()
                OfficeLocation.objects.all().delete()
                log("Data cleared.")

                # 1. Office Locations
                log(f"Inserting {len(data_store['office_locations'])} office locations...")
                for row in data_store['office_locations']:
                    OfficeLocation.objects.create(
                        id=parse_copy_value(row[0]),
                        name=parse_copy_value(row[1]),
                        address=parse_copy_value(row[2]),
                        latitude=parse_copy_value(row[3]),
                        longitude=parse_copy_value(row[4]),
                        radius_meters=parse_copy_value(row[5]),
                        is_active=parse_bool(parse_copy_value(row[6])),
                        created_at=parse_copy_value(row[7]),
                        updated_at=parse_copy_value(row[8])
                    )

                # 2. Employees
                log(f"Inserting {len(data_store['employees'])} employees...")
                for row in data_store['employees']:
                    Employee.objects.create(
                        id=parse_copy_value(row[0]),
                        username=parse_copy_value(row[1]),
                        password=parse_copy_value(row[2]),
                        name=parse_copy_value(row[3]),
                        email=parse_copy_value(row[4]),
                        phone=parse_copy_value(row[5]),
                        department=parse_copy_value(row[6]),
                        primary_office=parse_copy_value(row[7]),
                        role=parse_copy_value(row[8]) or 'employee',
                        is_active=parse_bool(parse_copy_value(row[9])),
                        created_at=parse_copy_value(row[10]),
                        updated_at=parse_copy_value(row[11])
                    )

                # 3. Employee Profiles
                log(f"Inserting {len(data_store['employee_profiles'])} profiles...")
                for row in data_store['employee_profiles']:
                    employee_id = parse_copy_value(row[1])
                    if not employee_id: continue
                    
                    EmployeeProfile.objects.create(
                        id=parse_copy_value(row[0]),
                        employee_id=employee_id,
                        emergency_contact_name=parse_copy_value(row[2]),
                        emergency_contact_phone=parse_copy_value(row[3]),
                        alternate_number=parse_copy_value(row[4]),
                        bank_account_number=parse_copy_value(row[5]),
                        bank_ifsc=parse_copy_value(row[6]),
                        bank_bank_name=parse_copy_value(row[7]),
                        pan_number=parse_copy_value(row[8]),
                        aadhar_number=parse_copy_value(row[9]),
                        qualification=parse_copy_value(row[10]),
                        certificates_summary=parse_copy_value(row[11]),
                        home_address=parse_copy_value(row[12]),
                        current_address=parse_copy_value(row[13]),
                        date_of_joining=parse_copy_value(row[14]),
                        skill_set=parse_copy_value(row[15]),
                        reporting_manager=parse_copy_value(row[16]),
                        planned_leaves=parse_copy_value(row[17]) or 0,
                        unplanned_leaves=parse_copy_value(row[18]) or 0,
                        professional_training=parse_copy_value(row[19]),
                        family_details=parse_copy_value(row[20]),
                        marital_status=parse_copy_value(row[21]),
                        personal_email=parse_copy_value(row[22]),
                        gender=parse_copy_value(row[23]),
                        date_of_birth=parse_copy_value(row[24]),
                        documents_pdf_path=parse_copy_value(row[25]),
                        created_at=parse_copy_value(row[26]),
                        updated_at=parse_copy_value(row[27])
                    )

                # 4. Department Office Access
                log(f"Inserting {len(data_store['department_office_access'])} department access records...")
                for row in data_store['department_office_access']:
                     DepartmentOfficeAccess.objects.create(
                        id=parse_copy_value(row[0]),
                        department=parse_copy_value(row[1]),
                        office_id=parse_copy_value(row[2])
                     )

                # 5. Employee Documents
                log(f"Inserting {len(data_store['employee_documents'])} documents...")
                for row in data_store['employee_documents']:
                    EmployeeDocument.objects.create(
                        id=parse_copy_value(row[0]),
                        employee_id=parse_copy_value(row[1]),
                        doc_type=parse_copy_value(row[2]),
                        doc_name=parse_copy_value(row[3]),
                        doc_number=parse_copy_value(row[4]),
                        file_name=parse_copy_value(row[5]),
                        file_path=parse_copy_value(row[6]),
                        uploaded_at=parse_copy_value(row[7])
                    )

                # 6. Attendance Records
                log(f"Inserting {len(data_store['attendance_records'])} attendance records...")
                for i, row in enumerate(data_store['attendance_records']):
                    try:
                         AttendanceRecord.objects.create(
                            id=parse_copy_value(row[0]),
                            employee_id=parse_copy_value(row[1]),
                            date=parse_copy_value(row[2]),
                            check_in_time=parse_copy_value(row[3]),
                            check_out_time=parse_copy_value(row[4]),
                            type=parse_copy_value(row[5]),
                            status=parse_copy_value(row[6]),
                            office_id=parse_copy_value(row[7]),
                            check_in_location=parse_copy_value(row[8]), 
                            check_out_location=parse_copy_value(row[9]), 
                            check_in_photo=parse_copy_value(row[10]),
                            check_out_photo=parse_copy_value(row[11]),
                            total_hours=parse_copy_value(row[12]),
                            is_half_day=parse_bool(parse_copy_value(row[13])),
                            notes=parse_copy_value(row[14]),
                            created_at=parse_copy_value(row[15]),
                            updated_at=parse_copy_value(row[16])
                         )
                    except IndexError:
                        log(f"Error at index {i}: Row len {len(row)}: {row}")
                        raise

                # 7. WFH Requests
                log(f"Inserting {len(data_store['wfh_requests'])} wfh requests...")
                for row in data_store['wfh_requests']:
                    EmployeeRequest.objects.create(
                        id=parse_copy_value(row[0]),
                        employee_id=parse_copy_value(row[1]),
                        request_type='wfh',
                        start_date=parse_copy_value(row[2]),
                        end_date=parse_copy_value(row[2]),
                        reason=parse_copy_value(row[3]),
                        status=parse_copy_value(row[4]),
                        reviewed_by_id=parse_copy_value(row[5]),
                        admin_response=parse_copy_value(row[6]),
                        reviewed_at=parse_copy_value(row[7]),
                        created_at=parse_copy_value(row[8]),
                        updated_at=parse_copy_value(row[9])
                    )
                    
            log("Migration completed successfully!")

        run_migration()

    except Exception as e:
        log(f"Fatal Error: {e}")
        traceback.print_exc()
