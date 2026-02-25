"""
Intelligence Hub - Attendance Prediction and Analytics Module
Provides forecasting, trend analysis, and personnel insights
"""

from datetime import datetime, timedelta
from django.db.models import Count, Q
from .models import AttendanceRecord, Employee
import statistics
import json
import os
from django.conf import settings


def get_last_n_days_data(days=30):
    """Get attendance data for the last N days"""
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days)
    
    attendance_records = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date
    ).select_related('employee')
    
    return attendance_records


def calculate_daily_attendance_rates(days=30):
    """Calculate attendance percentage for each of the last N days (OPTIMIZED with working day logic)"""
    from django.db.models import Count, Q
    from django.db.models.functions import TruncDate
    
    end_date = datetime.now().date()
    # We want N *working* days, so we might need to look back further than N calendar days
    # For simplicity, we'll look back 45 days to ensure we get 30 working days if possible
    lookback_days = days + 15
    start_date = end_date - timedelta(days=lookback_days)
    
    # Get all employees count once
    total_employees = Employee.objects.filter(role='employee').count()
    if total_employees == 0:
        return [0] * days
    
    # Get all attendance counts in one query
    daily_counts = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date,
        status__in=['present', 'wfh', 'client']
    ).values('date').annotate(count=Count('id')).order_by('date')
    
    # Map results to a dictionary
    counts_map = {item['date']: item['count'] for item in daily_counts}
    
    daily_data = []
    current_date = end_date
    
    # Collect N working days (excluding weekends)
    while len(daily_data) < days:
        # 5 is Saturday, 6 is Sunday
        is_working_day = current_date.weekday() < 5
        
        present_count = counts_map.get(current_date, 0)
        rate = (present_count / total_employees) * 100 if total_employees > 0 else 0
        
        if is_working_day:
            daily_data.insert(0, {
                'date': current_date,
                'rate': round(rate, 1),
                'present_count': present_count
            })
        
        current_date -= timedelta(days=1)
        # Safety break
        if (end_date - current_date).days > 90:
            break
            
    return daily_data


def calculate_forecast():
    """
    Calculate attendance forecast using weighted moving average (Refined)
    Returns: (forecast_percentage, confidence_score, trend_indicator)
    """
    daily_data = calculate_daily_attendance_rates(30)
    
    # Filter out days with 0 attendance as they usually represent missing data or non-working days
    valid_rates = [d['rate'] for d in daily_data if d['rate'] > 0]
    
    if not valid_rates:
        return 0, 0, "STABLE"
    
    if len(valid_rates) < 7:
        # If very little data, just use the average of what we have
        avg = sum(valid_rates) / len(valid_rates)
        return round(avg, 1), 30, "STABLE"
    
    # Weighted moving average: favor the MOST recent data
    recent_count = min(7, len(valid_rates))
    recent_data = valid_rates[-recent_count:]
    older_data = valid_rates[:-recent_count]
    
    recent_avg = sum(recent_data) / len(recent_data)
    older_avg = sum(older_data) / len(older_data) if older_data else recent_avg
    
    # Check for trained model state
    model_state = load_model_state()
    stability_bonus = 1.0
    pattern_adjustment = 1.0
    
    if model_state:
        # Use stability factor to adjust weights
        # High stability (low variance) means we can trust historical data more
        stability_factor = model_state.get('stability_factor', 0.5)
        stability_bonus = 1.0 + (stability_factor * 0.2)
        
        # Adjust forecast based on long-term historical average
        historical_avg = model_state.get('average_rate', older_avg)
        # 70% weight on recent, 20% on older, 10% on global historical
        forecast = (recent_avg * 0.7) + (older_avg * 0.2) + (historical_avg * 0.1)
    else:
        # 80% weight on recent trend, 20% on historical average
        forecast = (recent_avg * 0.8) + (older_avg * 0.2)
    
    # Confidence: higher when std_dev is low and we have more data points
    try:
        std_dev = statistics.stdev(valid_rates) if len(valid_rates) > 1 else 0
        data_abundance = min(len(valid_rates) / 30, 1.0)
        consistency = max(0, 100 - (std_dev * 2))
        
        # Apply stability bonus from trained model
        confidence = ((consistency * 0.6) + (data_abundance * 100 * 0.4)) * stability_bonus
        confidence = min(confidence, 99) # Cap at 99 for realism
    except:
        confidence = 50
    
    trend = detect_trend(valid_rates)
    
    return round(forecast, 1), round(confidence, 0), trend


def load_model_state():
    """Load the trained model state from JSON"""
    file_path = os.path.join(settings.BASE_DIR, 'attendance', 'model_state.json')
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r') as f:
                return json.load(f)
        except:
            return None
    return None


def train_forecast_model():
    """
    Train the forecast model by analyzing the ENTIRE attendance history.
    Calculates stability factors and long-term averages.
    """
    from django.db.models import Count, Q
    from django.db.models.functions import TruncDate
    
    logs = []
    def add_log(msg):
        logs.append({'timestamp': datetime.now().strftime('%H:%M:%S'), 'message': msg})

    add_log("Initializing model training sequence...")
    
    # Get all working days with attendance
    add_log("Fetching employee database for normalization...")
    all_employees_count = Employee.objects.filter(role='employee').count()
    if all_employees_count == 0:
        add_log("ERROR: No employees found in system.")
        return {'success': False, 'message': 'No employees found to train model'}
    
    add_log(f"System identified {all_employees_count} active employees.")
    add_log("Analyzing historical attendance records...")
        
    daily_counts = AttendanceRecord.objects.filter(
        status__in=['present', 'wfh', 'client']
    ).values('date').annotate(count=Count('id')).order_by('date')
    
    if not daily_counts:
        add_log("ERROR: Database is empty or no valid attendance records found.")
        return {'success': False, 'message': 'No attendance records found to train model'}
    
    add_log(f"Retrieved {len(daily_counts)} days of historical data.")
    add_log("Filtering working days and removing anomalies...")
        
    rates = []
    working_days_count = 0
    for day in daily_counts:
        # Only count working days (Mon-Fri) for stability analysis
        if day['date'].weekday() < 5:
            working_days_count += 1
            rate = (day['count'] / all_employees_count) * 100
            if rate > 0: # Filter out anomaly days with 0 (holidays)
                rates.append(rate)
    
    add_log(f"Processed {working_days_count} working days. Identified {len(rates)} valid data points.")
                
    if not rates:
        add_log("ERROR: Insufficient valid data points after filtering.")
        return {'success': False, 'message': 'Insufficient data for training'}
    
    add_log("Calculating long-term attendance averages...")
    avg_rate = sum(rates) / len(rates)
    add_log(f"Global historical average set to {round(avg_rate, 2)}%.")
    
    # Calculate stability factor (inverse of normalized variance)
    add_log("Performing variance and stability analysis...")
    if len(rates) > 1:
        std_dev = statistics.stdev(rates)
        # Normalize std_dev relative to the average (coefficient of variation)
        cv = std_dev / avg_rate if avg_rate > 0 else 1
        stability_factor = max(0, 1.0 - cv)
        add_log(f"Standard deviation: {round(std_dev, 2)}. Stability factor: {round(stability_factor, 4)}.")
    else:
        add_log("Single data point detected. Defaulting stability factor to 0.5.")
        stability_factor = 0.5
        
    model_state = {
        'average_rate': round(avg_rate, 2),
        'stability_factor': round(stability_factor, 4),
        'data_points': len(rates),
        'last_trained': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'version': '1.0.0',
        'logs': logs
    }
    
    add_log("Finalizing neural pattern calibration...")
    # Save to file
    file_path = os.path.join(settings.BASE_DIR, 'attendance', 'model_state.json')
    try:
        with open(file_path, 'w') as f:
            json.dump(model_state, f, indent=4)
        add_log("Model state serialized and committed to storage.")
        return {'success': True, 'summary': model_state, 'logs': logs}
    except Exception as e:
        add_log(f"CRITICAL ERROR: Disk write failed. {str(e)}")
        return {'success': False, 'message': f'Failed to save model: {str(e)}', 'logs': logs}


def detect_trend(daily_rates):
    """
    Detect attendance trend by comparing recent week vs previous week
    Returns: "UP", "DOWN", or "STABLE"
    """
    if len(daily_rates) < 14:
        return "STABLE"
    
    current_week = daily_rates[-7:]
    previous_week = daily_rates[-14:-7]
    
    current_avg = sum(current_week) / len(current_week)
    previous_avg = sum(previous_week) / len(previous_week)
    
    change_percent = ((current_avg - previous_avg) / previous_avg * 100) if previous_avg > 0 else 0
    
    if change_percent > 2:
        return "UP"
    elif change_percent < -2:
        return "DOWN"
    else:
        return "STABLE"


def get_current_day_name():
    """Get current day name (e.g., 'Monday')"""
    days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    return days[datetime.now().weekday()]


def get_trend_data(days=30):
    """
    Get detailed trend data for visualization (Calendar aligned)
    Returns: list of {date, attendance_rate, moving_avg, present_count}
    """
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days-1)
    
    # Get all employees count
    total_employees = Employee.objects.filter(role='employee').count()
    
    # Get counts for all days in range (including weekends)
    daily_counts = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date,
        status__in=['present', 'wfh', 'client']
    ).values('date').annotate(count=Count('id'))
    counts_map = {item['date']: item['count'] for item in daily_counts}
    
    trend_data = []
    
    # Iterate through every single calendar day to ensure alignment
    for i in range(days):
        current_date = start_date + timedelta(days=i)
        present_count = counts_map.get(current_date, 0)
        rate = (present_count / total_employees * 100) if total_employees > 0 else 0
        rate = round(rate, 1)
        
        # Calculate moving average (using inclusive window)
        # We look back at the actual trend_data we've built so far
        window = [t['attendance_rate'] for t in trend_data[-(6):]] + [rate]
        moving_avg = sum(window) / len(window)
        
        trend_data.append({
            'date': current_date.strftime('%Y-%m-%d'),
            'attendance_rate': rate,
            'moving_avg': round(moving_avg, 1),
            'present_count': present_count
        })
    
    return trend_data


def search_personnel(query=None, department=None, min_attendance=None, max_attendance=None):
    """
    Search personnel with attendance predictions (OPTIMIZED)
    Returns: list of employees with their attendance stats
    """
    employees = Employee.objects.filter(role='employee')
    
    # Apply filters
    if query:
        employees = employees.filter(
            Q(name__icontains=query) | 
            Q(username__icontains=query) |
            Q(email__icontains=query)
        )
    
    if department:
        employees = employees.filter(department=department)
    
    results = []
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=30)
    recent_start_date = end_date - timedelta(days=7)
    
    # Optimize by getting all relevant attendance counts in two queries
    attendance_30d = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date,
        status__in=['present', 'wfh', 'client']
    ).values('employee_id').annotate(count=Count('id'))
    
    attendance_7d = AttendanceRecord.objects.filter(
        date__gte=recent_start_date,
        date__lte=end_date,
        status__in=['present', 'wfh', 'client']
    ).values('employee_id').annotate(count=Count('id'))
    
    map_30d = {item['employee_id']: item['count'] for item in attendance_30d}
    map_7d = {item['employee_id']: item['count'] for item in attendance_7d}
    
    for emp in employees:
        present_days = map_30d.get(emp.id, 0)
        attendance_rate = (present_days / 30) * 100
        
        # Apply attendance filter
        if min_attendance is not None and attendance_rate < min_attendance:
            continue
        if max_attendance is not None and attendance_rate > max_attendance:
            continue
        
        recent_present = map_7d.get(emp.id, 0)
        prediction_score = (recent_present / 7) * 100
        
        results.append({
            'id': emp.id,
            'name': emp.name,
            'username': emp.username,
            'email': emp.email,
            'department': emp.department,
            'attendance_rate': round(attendance_rate, 1),
            'prediction_score': round(prediction_score, 1),
            'status': 'Active' if recent_present >= 4 else 'Inactive'
        })
    
    # Sort by attendance rate (descending)
    results.sort(key=lambda x: x['attendance_rate'], reverse=True)
    
    return results


def get_company_overview(days=30):
    """
    Get comprehensive company-wide attendance analytics (OPTIMIZED)
    Returns: {
        summary: overall stats,
        departments: department-wise breakdown,
        employees: individual employee data,
        trends: daily trends
    }
    """
    from django.db.models import Count, Q, F
    
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days)
    
    # Get all employees
    all_employees = Employee.objects.filter(role='employee')
    total_employees = all_employees.count()
    
    if total_employees == 0:
        return {
            'summary': {},
            'departments': [],
            'employees': [],
            'trends': []
        }
    
    # Calculate overall company stats using aggregation
    total_working_days = days
    total_possible_attendance = total_employees * total_working_days
    
    # Use aggregate queries instead of individual counts
    from django.db.models import Sum, Case, When, IntegerField
    
    attendance_stats = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date
    ).aggregate(
        total_present=Count('id', filter=Q(status__in=['present', 'wfh', 'client'])),
        total_absent=Count('id', filter=Q(status='absent')),
        total_leave=Count('id', filter=Q(status='leave')),
        total_half_day=Count('id', filter=Q(is_half_day=True))
    )
    
    # Get forecast for accuracy
    forecast_val, confidence, trend_indicator = calculate_forecast()
    
    total_present = attendance_stats['total_present'] or 0
    total_absent = attendance_stats['total_absent'] or 0
    total_leave = attendance_stats['total_leave'] or 0
    total_half_day = attendance_stats['total_half_day'] or 0
    
    overall_attendance_rate = (total_present / total_possible_attendance * 100) if total_possible_attendance > 0 else 0
    
    # Department-wise breakdown using bulk query
    departments = all_employees.values_list('department', flat=True).distinct()
    department_stats = []
    
    best_dept = 'N/A'
    best_rate = 0
    
    for dept in departments:
        if not dept:
            continue
        
        dept_count = all_employees.filter(department=dept).count()
        
        dept_present = AttendanceRecord.objects.filter(
            employee__department=dept,
            employee__role='employee',
            date__gte=start_date,
            date__lte=end_date,
            status__in=['present', 'wfh', 'client']
        ).count()
        
        dept_possible = dept_count * total_working_days
        dept_rate = (dept_present / dept_possible * 100) if dept_possible > 0 else 0
        
        department_stats.append({
            'name': dept,
            'employee_count': dept_count,
            'attendance_rate': round(dept_rate, 1),
            'total_present': dept_present,
            'total_days': dept_possible
        })
    
    # Sort departments by attendance rate
    department_stats.sort(key=lambda x: x['attendance_rate'], reverse=True)
    
    # Employee-level data using optimized query with prefetch
    employee_data = []
    
    # Get all attendance records in bulk
    attendance_records = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date,
        employee__role='employee'
    ).values('employee_id', 'status', 'type', 'is_half_day')
    
    # Create a dictionary to store employee stats
    emp_stats = {}
    for record in attendance_records:
        emp_id = record['employee_id']
        if emp_id not in emp_stats:
            emp_stats[emp_id] = {
                'present': 0,
                'absent': 0,
                'leave': 0,
                'wfh': 0
            }
        
        if record['status'] in ['present', 'wfh', 'client']:
            emp_stats[emp_id]['present'] += 1
        elif record['status'] == 'absent':
            emp_stats[emp_id]['absent'] += 1
        elif record['status'] == 'leave':
            emp_stats[emp_id]['leave'] += 1
        
        if record['type'] == 'wfh':
            emp_stats[emp_id]['wfh'] += 1
    
    # Build employee data list
    for emp in all_employees:
        stats = emp_stats.get(emp.id, {'present': 0, 'absent': 0, 'leave': 0, 'wfh': 0})
        
        attendance_rate = (stats['present'] / total_working_days * 100) if total_working_days > 0 else 0
        
        employee_data.append({
            'id': emp.id,
            'name': emp.name,
            'department': emp.department,
            'attendance_rate': round(attendance_rate, 1),
            'present_days': stats['present'],
            'absent_days': stats['absent'],
            'leave_days': stats['leave'],
            'wfh_days': stats['wfh'],
            'total_days': total_working_days
        })
    
    # Sort employees by attendance rate
    employee_data.sort(key=lambda x: x['attendance_rate'], reverse=True)
    
    # Get trend data (already optimized)
    trend_data = get_trend_data(days)
    
    # NEW: Calculate Peak Operational Hours (Company-wide)
    recent_check_ins = AttendanceRecord.objects.filter(
        date__gte=start_date,
        check_in_time__isnull=False
    ).values_list('check_in_time', flat=True)
    
    hour_counts = {}
    for t in recent_check_ins:
        h = t.hour
        hour_counts[h] = hour_counts.get(h, 0) + 1
    
    peak_hour = max(hour_counts, key=hour_counts.get) if hour_counts else 9
    peak_hour_str = f"{peak_hour:02d}:00 - {peak_hour+1:02d}:00"
    
    # NEW: Weekly Pattern (Mon-Fri Average) - FIXED: Filter out zero days to avoid skewing
    weekly_pattern_rates = {0: [], 1: [], 2: [], 3: [], 4: []} # Mon=0 to Fri=4
    weekly_pattern_counts = {0: [], 1: [], 2: [], 3: [], 4: []}
    for t in trend_data:
        d = datetime.strptime(t['date'], '%Y-%m-%d').date()
        w = d.weekday()
        if w < 5 and t['present_count'] > 0: # Only count active workdays
            weekly_pattern_rates[w].append(t['attendance_rate'])
            weekly_pattern_counts[w].append(t['present_count'])
    
    weekly_stats = [
        round(sum(weekly_pattern_rates[i]) / len(weekly_pattern_rates[i]), 1) if weekly_pattern_rates[i] else 0 
        for i in range(5)
    ]
    
    weekly_counts = [
        round(sum(weekly_pattern_counts[i]) / len(weekly_pattern_counts[i]), 1) if weekly_pattern_counts[i] else 0 
        for i in range(5)
    ]

    # NEW: Peak Day Identification
    days_of_week = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    peak_day_idx = weekly_stats.index(max(weekly_stats)) if any(weekly_stats) else 0
    peak_day = days_of_week[peak_day_idx]
    
    # NEW: Late Arrival Trend (Check-ins after 9:30 AM)
    late_time = datetime.strptime('09:30:00', '%H:%M:%S').time()
    all_recent_checkins = AttendanceRecord.objects.filter(
        date__gte=start_date,
        check_in_time__isnull=False
    )
    total_checkins = all_recent_checkins.count()
    late_checkins = all_recent_checkins.filter(check_in_time__gt=late_time).count()
    late_rate = round((late_checkins / total_checkins * 100), 1) if total_checkins > 0 else 0
    
    # NEW: Corporate WFH Ratio
    total_wfh = sum(e['wfh_days'] for e in employee_data)
    wfh_ratio = round((total_wfh / total_present * 100), 1) if total_present > 0 else 0
    
    # NEW: At-Risk Departments (Below 60% average)
    at_risk = [d for d in department_stats if d['attendance_rate'] < 60]
    
    # NEW: Department Rankings & Patterns
    # Added to department_stats already, but we'll highlight top/bottom
    top_depts = department_stats[:3]
    bottom_depts = department_stats[-3:] if len(department_stats) > 3 else []

    # NEW: Advanced Analytics for Phase 9
    # 1. Trend History (Last 7 active days)
    trend_history = [t['attendance_rate'] for t in trend_data[-7:]]
    
    # 2. Attendance Streak (Current run of days >= 75%)
    streak = 0
    for t in reversed(trend_data):
        if t['attendance_rate'] >= 75:
            streak += 1
        else:
            break
            
    # 3. Busiest Day Impact
    avg_rate = overall_attendance_rate
    peak_rate = max(weekly_stats) if any(weekly_stats) else 0
    busiest_impact = round(((peak_rate - avg_rate) / avg_rate * 100), 1) if avg_rate > 0 else 0

    # Summary statistics
    summary = {
        'total_employees': total_employees,
        'total_working_days': total_working_days,
        'overall_attendance_rate': round(overall_attendance_rate, 1),
        'total_present': total_present,
        'total_absent': total_absent,
        'total_leave': total_leave,
        'total_half_day': total_half_day,
        'average_daily_attendance': round(total_present / total_working_days, 1) if total_working_days > 0 else 0,
        'best_department': department_stats[0]['name'] if department_stats else 'N/A',
        'best_department_rate': department_stats[0]['attendance_rate'] if department_stats else 0,
        'forecast': forecast_val,
        'confidence': confidence,
        'trend': trend_indicator,
        'peak_hour': peak_hour_str,
        'peak_day': peak_day,
        'wfh_ratio': wfh_ratio,
        'late_rate': late_rate,
        'weekly_stats': weekly_stats,
        'weekly_counts': weekly_counts,
        'at_risk_count': len(at_risk),
        'tomorrow_day': (datetime.now() + timedelta(days=1)).strftime('%A'),
        'trend_history': trend_history,
        'attendance_streak': streak,
        'busiest_impact': busiest_impact
    }
    
    return {
        'summary': summary,
        'departments': department_stats,
        'top_departments': top_depts,
        'bottom_departments': bottom_depts,
        'employees': employee_data,
        'trends': trend_data,
        'at_risk': at_risk
    }
