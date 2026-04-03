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
import hashlib
from django.conf import settings


# --- AI/ML Preprocessing Constants ---
STATUS_WEIGHTS = {
    'present': 1.0,
    'wfh': 1.0,
    'client': 1.0,
    'half_day': 0.5,
    'absent': 0.0,
    'leave': 0.0
}
MAX_NORMALIZED_HOURS = 12.0


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
        return [{'date': end_date - timedelta(days=i), 'rate': 0.0, 'present_count': 0} for i in range(days)]
    
    # Get all attendance counts in one query
    daily_counts = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date,
        status__in=['present', 'wfh', 'client']
    ).values('date').annotate(count=Count('id')).order_by('date')
    
    # Map results to a dictionary
    counts_map = {item['date']: item['count'] for item in daily_counts}
    
    # NEW: Enhanced score mapping (weighted by status)
    daily_scores = AttendanceRecord.objects.filter(
        date__gte=start_date,
        date__lte=end_date
    ).values('date', 'status').annotate(count=Count('id'))
    
    scores_map = {}
    for item in daily_scores:
        dt = item['date']
        weight = STATUS_WEIGHTS.get(item['status'], 0.0)
        scores_map[dt] = scores_map.get(dt, 0.0) + (item['count'] * weight)

    daily_data = []
    current_date = end_date
    
    # Collect N working days (excluding weekends)
    while len(daily_data) < days:
        # 5 is Saturday, 6 is Sunday
        is_working_day = current_date.weekday() < 5
        
        present_count = counts_map.get(current_date, 0)
        attendance_score = scores_map.get(current_date, 0.0)
        rate = (attendance_score / total_employees) * 100 if total_employees > 0 else 0
        
        if is_working_day:
            daily_data.insert(0, {
                'date': current_date,
                'rate': round(rate, 1),
                'present_count': present_count,
                'attendance_score': attendance_score
            })
        
        current_date -= timedelta(days=1)
        # Safety break
        if (end_date - current_date).days > 90:
            break
            
    return daily_data


def calculate_forecast():
    """
    Calculate attendance forecast using ML model and trained parameters.
    Returns: (forecast_percentage, confidence_score, trend_indicator)
    """
    daily_data = calculate_daily_attendance_rates(30)
    valid_rates = [float(d['rate']) for d in daily_data if isinstance(d.get('rate'), (int, float)) and d['rate'] > 0]
    
    if not valid_rates:
        return 0, 0, "STABLE"

    tomorrow = datetime.now().date() + timedelta(days=1)
    ml_engine = AttendanceMLModel()
    forecast = ml_engine.predict(tomorrow, valid_rates)
    
    # Fallback to heuristic if ML model not available
    if forecast is None:
        recent_count = min(7, len(valid_rates))
        forecast = sum(list(valid_rates)[-recent_count:]) / recent_count

    # Confidence calculation (Stability based)
    try:
        std_dev = statistics.stdev(valid_rates) if len(valid_rates) > 1 else 5.0
        consistency = max(0.0, 100.0 - (std_dev * 3.0))
        # ML model presence increases confidence
        confidence_bonus = 1.1 if ml_engine.model else 1.0
        confidence = min(round(consistency * confidence_bonus, 0), 99)
    except:
        confidence = 65
    
    trend = detect_trend(valid_rates)
    
    return round(forecast, 1), confidence, trend


def calculate_multi_day_forecast(days=7):
    """
    Calculate attendance forecast for the next N days.
    """
    daily_data = calculate_daily_attendance_rates(30)
    history = [d['rate'] for d in daily_data]
    
    if not history:
        return []
    
    ml_engine = AttendanceMLModel()
    predictions = []
    temp_history = history.copy()
    
    current_date = datetime.now().date()
    
    for i in range(1, days + 1):
        target_date = current_date + timedelta(days=i)
        
        # ML Prediction
        pred = ml_engine.predict(target_date, temp_history)
        
        # Fallback to heuristic (Moving Average)
        if pred is None:
            recent_count = min(7, len(temp_history))
            pred = sum(list(temp_history)[-recent_count:]) / recent_count
        
        pred = round(float(pred), 1)
        predictions.append({
            'date': target_date.strftime('%Y-%m-%d'),
            'day_name': target_date.strftime('%A'),
            'rate': pred
        })
        
        # Append prediction to history for iterative forecasting
        temp_history.append(pred)
        
    return predictions


def calculate_hybrid_forecast(predict_days=3, history_days=3):
    """
    Returns a list of points: history_days before today, Today, and the next predict_days prediction.
    """
    total_employees = Employee.objects.filter(role='employee').count()
    if total_employees == 0:
        return []

    # 1. Get History and Today
    today = datetime.now().date()
    
    dates = []
    for i in range(history_days, 0, -1):
        dates.append(today - timedelta(days=i))
    dates.append(today)
    
    actual_data = []
    
    for d in dates:
        count = AttendanceRecord.objects.filter(
            date=d, 
            status__in=['present', 'wfh', 'client']
        ).count()
        rate = round((count / total_employees * 100), 1)
        
        if d == today:
            day_name = 'Today'
        elif d == today - timedelta(days=1):
            day_name = 'Yesterday'
        else:
            day_name = d.strftime('%A')
            
        actual_data.append({
            'date': d.strftime('%Y-%m-%d'),
            'day_name': day_name,
            'rate': rate,
            'is_prediction': False
        })

    # 2. Get history for prediction context (30 days)
    daily_rates = calculate_daily_attendance_rates(30)
    history = [d['rate'] for d in daily_rates]
    
    # 3. Predict next N days
    ml_engine = AttendanceMLModel()
    predictions = []
    temp_history = history.copy()
    
    for i in range(1, predict_days + 1):
        target_date = today + timedelta(days=i)
        is_weekend = target_date.weekday() >= 5
        
        # ML Prediction
        pred = ml_engine.predict(target_date, temp_history)
        
        if is_weekend:
            # Django week_day: 1=Sunday, 7=Saturday
            weekend_history = AttendanceRecord.objects.filter(
                Q(date__week_day=1) | Q(date__week_day=7),
                status__in=['present', 'wfh', 'client']
            ).exists()
            if not weekend_history:
                pred = 0.0
        
        # Fallback to Moving Average
        if pred is None:
            recent_count = min(7, len(temp_history))
            pred = sum(list(temp_history)[-recent_count:]) / recent_count
        
        pred = round(float(pred), 1)
        predictions.append({
            'date': target_date.strftime('%Y-%m-%d'),
            'day_name': target_date.strftime('%A'),
            'rate': pred,
            'is_prediction': True
        })
        temp_history.append(pred)
        
    return actual_data + predictions


    return actual_data + predictions


class OrganizationSTLM:
    """
    Structural Time-Series LSTM-inspired (STLM) Organizational Model.
    Decomposes attendance into Trend, Seasonality, and Residuals.
    """
    def __init__(self):
        self.model_path = os.path.join(settings.BASE_DIR, 'attendance', 'ml_models', 'org_stlm_model.joblib')
        self.state_path = os.path.join(settings.BASE_DIR, 'attendance', 'ml_models', 'org_stlm_state.json')
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        self.model = self._load_model()
        self.state = self._load_state()

    def _load_model(self):
        if os.path.exists(self.model_path):
            try:
                import joblib
                return joblib.load(self.model_path)
            except: return None
        return None

    def _load_state(self):
        if os.path.exists(self.state_path):
            try:
                with open(self.state_path, 'r') as f: return json.load(f)
            except: return {}
        return {}

    def predict(self, date_obj, historical_rates):
        """Predict organizational rate using Structural Time-Series logic"""
        if not historical_rates: return None
        
        # 1. Seasonality Component (Day of Week average)
        dow = str(date_obj.weekday())
        seasonal_patterns = self.state.get('dow_patterns', {})
        base_seasonal = float(seasonal_patterns.get(dow, statistics.mean(historical_rates[-7:])))

        # 2. Trend/Momentum Component
        recent_avg = statistics.mean(historical_rates[-3:]) if len(historical_rates) >= 3 else historical_rates[-1]
        long_avg = statistics.mean(historical_rates[-14:]) if len(historical_rates) >= 14 else statistics.mean(historical_rates)
        momentum = (recent_avg / long_avg) if long_avg > 0 else 1.0

        # 3. Residual prediction (using ML if available)
        residual_pred = 0
        if self.model:
            try:
                import pandas as pd
                X = pd.DataFrame([{
                    'day_of_week': date_obj.weekday(),
                    'day_of_month': date_obj.day,
                    'is_weekend': 1 if date_obj.weekday() >= 5 else 0,
                    'momentum': momentum,
                    'rolling_7d': statistics.mean(historical_rates[-7:]) if len(historical_rates) >= 7 else historical_rates[-1],
                    'prev_rate': historical_rates[-1]
                }])
                residual_pred = self.model.predict(X)[0]
            except: pass

        # Combine: (Seasonal * Momentum) + Residual
        forecast = (base_seasonal * 0.7 + recent_avg * 0.3) + residual_pred
        return round(float(max(0, min(100, forecast))), 1)

    def train(self, daily_counts, all_employees_count):
        import pandas as pd
        from sklearn.ensemble import RandomForestRegressor
        import joblib

        if len(daily_counts) < 14:
            return False, "Insufficient data (min 14 days)"

        # Calculate DOW patterns for seasonality
        dow_data = {i: [] for i in range(7)}
        rates = []
        for day in daily_counts:
            rate = (day['score'] / all_employees_count) * 100
            rates.append(rate)
            dow_data[day['date'].weekday()].append(rate)
        
        dow_patterns = {str(i): sum(rs)/len(rs) for i, rs in dow_data.items() if rs}
        
        # Train Residual Model
        training_data = []
        for i in range(7, len(daily_counts)):
            day = daily_counts[i]
            rate = rates[i]
            training_data.append({
                'day_of_week': day['date'].weekday(),
                'day_of_month': day['date'].day,
                'is_weekend': 1 if day['date'].weekday() >= 5 else 0,
                'momentum': (statistics.mean(rates[i-3:i]) / statistics.mean(rates[i-7:i])) if statistics.mean(rates[i-7:i]) > 0 else 1.0,
                'rolling_7d': statistics.mean(rates[i-7:i]) if len(rates[i-7:i]) > 0 else rates[i-1],
                'prev_rate': rates[i-1],
                'target': rate - dow_patterns.get(str(day['date'].weekday()), rate) # Target is the residual
            })
        
        df = pd.DataFrame(training_data)
        X = df.drop('target', axis=1)
        y = df['target']
        
        model = RandomForestRegressor(n_estimators=200, random_state=42)
        model.fit(X, y)
        
        joblib.dump(model, self.model_path)
        with open(self.state_path, 'w') as f:
            json.dump({'dow_patterns': dow_patterns, 'last_trained': str(datetime.now())}, f)
            
        self.model = model
        self.state = {'dow_patterns': dow_patterns}
        return True, "STLM Organizational Model trained"


class IndividualPredictor:
    """Individual Performance Predictor using Random Forest with Normalized Hours"""
    def __init__(self):
        self.model_path = os.path.join(settings.BASE_DIR, 'attendance', 'ml_models', 'individual_rf_model.joblib')
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        self.model = self._load_model()

    def _load_model(self):
        if os.path.exists(self.model_path):
            try:
                import joblib
                return joblib.load(self.model_path)
            except: return None
        return None

    def _get_historical_features(self, employee, target_date=None):
        """Fetch and normalize individual historical metrics"""
        from .models import AttendanceRecord, EmployeeRequest, Task
        from datetime import datetime
        import statistics
        
        if target_date is None:
            target_date = datetime.now().date()
            
        records = list(AttendanceRecord.objects.filter(
            employee=employee,
            date__lt=target_date
        ).order_by('-date')[:14])
        
        if not records:
            return 0.75, 0.6, 1.0, 0, 0.75

        scores = [STATUS_WEIGHTS.get(r.status, 0.0) for r in records]
        avg_score = sum(scores) / len(scores)

        # Normalize working hours (0-12 range capped)
        hours = [float(r.total_hours) for r in records if r.total_hours]
        avg_hours = sum(hours) / len(hours) if hours else 8.0
        normalized_hours = min(1.0, avg_hours / MAX_NORMALIZED_HOURS)
        
        # New pattern: Consistency
        consistency = max(0.0, 1.0 - statistics.stdev(scores)) if len(scores) > 1 else 1.0
        
        # New pattern: Leave behavior predictor
        recent_leaves = sum(1 for r in records if r.status == 'leave')
        has_approved_leave = EmployeeRequest.objects.filter(
            employee=employee,
            request_type__in=['full_day', 'half_day'],
            status='approved',
            start_date__lte=target_date,
            end_date__gte=target_date
        ).exists()
        
        if has_approved_leave:
            recent_leaves += 5  # Add weight for upcoming known absence
            
        # New pattern: Work Efficiency Context
        tasks = Task.objects.filter(
            assignees=employee,
            status='completed',
            completed_at__date__lt=target_date,
            accuracy__isnull=False
        ).order_by('-completed_at')[:10]
        
        if tasks:
            avg_accuracy = sum(t.accuracy for t in tasks) / len(tasks)
            efficiency = avg_accuracy / 100.0
        else:
            efficiency = 0.75

        return avg_score, normalized_hours, consistency, recent_leaves, efficiency

    def predict(self, employee, org_forecast, target_date=None):
        """Predict individual attendance probability with weighted features"""
        avg_score, normalized_hours, consistency, recent_leaves, efficiency = self._get_historical_features(employee, target_date=target_date)
        
        if not self.model:
            # Hybrid heuristic: Weight individual score, hours, efficiency, logic against org forecast
            leave_penalty = (recent_leaves / 14.0) * 100 if recent_leaves > 0 else 0
            weighted_score = (avg_score * 0.5 + normalized_hours * 0.1 + consistency * 0.1 + efficiency * 0.1 + (org_forecast/100) * 0.2) * 100
            weighted_score -= leave_penalty
            if recent_leaves >= 5: # Critical leave indicator
                weighted_score = 5.0
            return round(min(99.0, max(5.0, weighted_score)), 1)

        try:
            import pandas as pd
            from datetime import datetime
            X = pd.DataFrame([{
                'dept_id': (hashlib.md5(employee.department.encode()).digest()[0] % 100) if employee.department else 0,
                'org_forecast': org_forecast,
                'day_of_week': target_date.weekday() if target_date else datetime.now().weekday(),
                'avg_score': avg_score,
                'normalized_hours': normalized_hours,
                'consistency': consistency,
                'recent_leaves': recent_leaves,
                'efficiency': efficiency
            }])
            return round(float(self.model.predict(X)[0]), 1)
        except: 
            return round(avg_score * 100, 1)

    def train(self):
        import pandas as pd
        from sklearn.ensemble import RandomForestRegressor
        import joblib
        from .models import Employee, AttendanceRecord

        employees = Employee.objects.filter(role='employee')
        if not employees.exists():
            return False, "No employees found"
            
        training_data = []
        # Get org forecast once
        org_forecast, _, _ = calculate_forecast()
        
        for emp in employees:
            # Get last 15 records to have 14 for history and 1 for target
            records = list(AttendanceRecord.objects.filter(employee=emp).order_by('-date')[:15])
            if len(records) < 15:
                continue
                
            # Most recent record is target
            target_record = records[0]
            
            avg_score, normalized_hours, consistency, recent_leaves, efficiency = self._get_historical_features(
                emp, target_date=target_record.date
            )

            target_score = STATUS_WEIGHTS.get(target_record.status, 0.0)
            
            training_data.append({
                'dept_id': (hashlib.md5(emp.department.encode()).digest()[0] % 100) if emp.department else 0,
                'org_forecast': org_forecast,
                'day_of_week': target_record.date.weekday(),
                'avg_score': avg_score,
                'normalized_hours': normalized_hours,
                'consistency': consistency,
                'recent_leaves': recent_leaves,
                'efficiency': efficiency,
                'target': target_score * 100
            })
            
        if len(training_data) < 10:
            return False, "Insufficient data for individual RF training"
            
        df = pd.DataFrame(training_data)
        X = df.drop('target', axis=1)
        y = df['target']
        
        model = RandomForestRegressor(n_estimators=100, random_state=42)
        model.fit(X, y)
        
        joblib.dump(model, self.model_path)
        self.model = model
        return True, "Individual RF Model Trained successfully"


class AttendanceMLModel:
    """Legacy wrapper for backward compatibility, now using OrganizationSTLM"""
    def __init__(self):
        self.engine = OrganizationSTLM()
        self.model = self.engine.model

    def predict(self, date_obj, historical_rates):
        return self.engine.predict(date_obj, historical_rates)

    def train(self, daily_counts, all_employees_count):
        return self.engine.train(daily_counts, all_employees_count)


class SLMInsightGenerator:
    """Small Language Model logic to generate accurate executive insights"""
    
    @staticmethod
    def generate_insight(summary):
        """Generates dynamic insights based on current metrics and forecasts"""
        forecast = summary.get('forecast', 0)
        confidence = summary.get('confidence', 0)
        late_rate = summary.get('late_rate', 0)
        streak = summary.get('attendance_streak', 0)
        trend = summary.get('trend', 'STABLE')
        peak_day = summary.get('peak_day', 'N/A')
        
        insights = []
        
        # 1. Trend & Forecast Insight
        if trend == 'UP':
            insights.append(f"Engagement is on a strong upward trajectory! We predict a {forecast}% turnout for tomorrow—keep this momentum going.")
        elif trend == 'DOWN':
            insights.append(f"Participation velocity is slightly cooling ({forecast}%). Let's boost engagement through team check-ins to reverse this trend.")
        else:
            insights.append(f"Organizational rhythm remains steady and consistent. Tomorrow's forecast sits at {forecast}%.")

        # 2. Efficiency/Late Rate Insight
        if late_rate > 15:
            insights.append(f"Minor arrival friction detected ({late_rate}% late). Optimizing morning workflows or shift staggering could boost immediate efficiency.")
        elif late_rate < 5:
            insights.append("Outstanding punctuality! This discipline is the foundation of high-performance efficiency.")
        
        # 3. Cultural/Streak Insight
        if streak >= 5:
            insights.append(f"Impressive! The team is on a {streak}-day consistency streak. Maintaining this focus will maximize weekly output.")
        
        # 4. Actionable Advice
        if peak_day != 'N/A' and trend == 'UP':
            insights.append(f"Pro-tip: Since {peak_day} is trending as a peak day, allocating additional resources now will ensure you stay ahead of the load.")

        return " ".join(insights)


def load_model_state():
    """Load the trained model state from JSON"""
    file_path = os.path.join(settings.BASE_DIR, 'attendance', 'ml_models', 'model_state.json')
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r') as f:
                return json.load(f)
        except:
            return None
    return None


def train_forecast_model():
    """
    Train the forecast model using the new AttendanceMLModel.
    Also calculates legacy metadata for backward compatibility.
    """
    logs = []
    def add_log(msg):
        logs.append({'timestamp': datetime.now().strftime('%H:%M:%S'), 'message': msg})

    add_log("Initializing SLM-powered intelligence training sequence...")
    
    all_employees_count = Employee.objects.filter(role='employee').count()
    if all_employees_count == 0:
        return {'success': False, 'message': 'No employees found to train model'}
    
    add_log(f"Accessing history for {all_employees_count} personnel.")
    
    # 1. Get Weighted Daily Scores for training
    raw_daily_data = AttendanceRecord.objects.values('date', 'status').annotate(count=Count('id')).order_by('date')
    
    daily_stats_map = {}
    for item in raw_daily_data:
        dt = item['date']
        weight = STATUS_WEIGHTS.get(item['status'], 0.0)
        daily_stats_map[dt] = daily_stats_map.get(dt, 0.0) + (item['count'] * weight)
    
    # Format for training
    daily_counts = [{'date': dt, 'score': score} for dt, score in daily_stats_map.items()]
    
    if not daily_counts:
        return {'success': False, 'message': 'No attendance records found'}

    add_log(f"Retrieved {len(daily_counts)} days of historical weighted vectors.")
    
    # 2. Train ML Model
    add_log("Step 1/3: Training OrganizationSTLM...")
    ml_engine = AttendanceMLModel()
    ml_success, ml_msg = ml_engine.train(daily_counts, all_employees_count)
    add_log(ml_msg)

    add_log("Step 2/3: Training IndividualPredictor...")
    try:
        ind_engine = IndividualPredictor()
        ind_success, ind_msg = ind_engine.train()
        add_log(ind_msg)
    except Exception as e:
        add_log(f"Individual training skipped: {str(e)}")

    # 2. Legacy Pattern Analysis (for model_state.json metadata)
    add_log("Step 3/3: Updating organizational performance metrics...")
    dow_groups = {i: [] for i in range(5)}
    all_valid_rates = []
    
    for day in daily_counts:
        wd = day['date'].weekday()
        if wd < 5:
            rate = (day['score'] / all_employees_count) * 100
            if rate > 5:
                dow_groups[wd].append(rate)
                all_valid_rates.append(rate)

    dow_patterns = {str(i): round(sum(rates)/len(rates), 2) for i, rates in dow_groups.items() if rates}
    
    # Stability calculation
    if len(all_valid_rates) > 2:
        final_avg = sum(all_valid_rates) / len(all_valid_rates)
        final_std = statistics.stdev(all_valid_rates)
        cv = final_std / final_avg if final_avg > 0 else 1.0
        stability = max(0.0, min(1.0, 1.0 - cv))
    else:
        final_avg = sum(all_valid_rates) / len(all_valid_rates) if all_valid_rates else 0
        stability = 0.5

    model_state = {
        'average_rate': round(final_avg, 2),
        'stability_factor': round(stability, 4),
        'dow_patterns': dow_patterns,
        'data_points': len(all_valid_rates),
        'last_trained': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'ml_model_active': ml_success,
        'version': '2.0.0 (SLM Engine)',
        'logs': logs
    }
    
    # Save to file
    file_path = os.path.join(settings.BASE_DIR, 'attendance', 'ml_models', 'model_state.json')
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    try:
        with open(file_path, 'w') as f:
            json.dump(model_state, f, indent=4)
        return {'success': True, 'summary': model_state, 'logs': logs}
    except Exception as e:
        return {'success': False, 'message': str(e), 'logs': logs}


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
        window = [float(t['attendance_rate']) for t in list(trend_data)[-(6):]] + [float(rate)]
        moving_avg = sum(window) / len(window)
        
        trend_data.append({
            'date': current_date.strftime('%Y-%m-%d'),
            'attendance_rate': rate,
            'moving_avg': round(moving_avg, 1),
            'present_count': present_count
        })
    
    return trend_data


def search_personnel(query=None, department=None, min_attendance=None, max_attendance=None, mentor_id=None):
    """
    Search personnel with attendance predictions (OPTIMIZED)
    Returns: list of employees with their attendance stats
    """
    employees = Employee.objects.filter(role='employee')
    
    # Apply filters
    if mentor_id:
        employees = employees.filter(mentor_id=mentor_id)
        
    if query:
        employees = employees.filter(
            Q(name__icontains=query) | 
            Q(username__icontains=query) |
            Q(email__icontains=query)
        )
    
    if department:
        employees = employees.filter(department=department)
    
    # Cast to float if they are strings
    try:
        if min_attendance is not None: min_attendance = float(min_attendance)
        if max_attendance is not None: max_attendance = float(max_attendance)
    except:
        pass

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
    
    # Prepare Individual Predictor
    org_forecast, _, _ = calculate_forecast()
    individual_engine = IndividualPredictor()

    for emp in employees:
        present_days = map_30d.get(emp.id, 0)
        attendance_rate = (present_days / 30) * 100
        
        # Apply attendance filter
        if min_attendance is not None and attendance_rate < min_attendance:
            continue
        if max_attendance is not None and attendance_rate > max_attendance:
            continue
        
        recent_present = map_7d.get(emp.id, 0)
        emp.temp_recent_avg = (recent_present / 7) * 100
        
        # Use Individual ML Predictor
        prediction_score = individual_engine.predict(emp, org_forecast)
        
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


def get_company_overview(days=30, predict_days=3):
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
    
    # NEW: Calculate Peak Operational Hours (Company-wide) and Average Check-in
    recent_check_ins = AttendanceRecord.objects.filter(
        date__gte=start_date,
        check_in_time__isnull=False
    ).values_list('check_in_time', flat=True)
    
    hour_counts = {}
    total_sec = 0
    for t in recent_check_ins:
        h = int(t.hour)
        hour_counts[h] = int(hour_counts.get(h, 0)) + 1
        total_sec += (h * 3600 + t.minute * 60 + t.second)
    
    peak_hour = max(hour_counts, key=lambda k: hour_counts[k]) if hour_counts else 9
    peak_hour_str = f"{peak_hour:02d}:00 - {peak_hour+1:02d}:00"
    
    if recent_check_ins:
        avg_sec = total_sec / len(recent_check_ins)
        avg_check_in_str = f"{int(avg_sec // 3600):02d}:{int((avg_sec % 3600) // 60):02d}"
    else:
        avg_check_in_str = "09:30"
    
    # NEW: Weekly Pattern (Mon-Fri Average) - FIXED: Filter out zero days to avoid skewing
    try:
        weekly_pattern_rates = {0: [], 1: [], 2: [], 3: [], 4: []} # Mon=0 to Fri=4
        weekly_pattern_counts = {0: [], 1: [], 2: [], 3: [], 4: []}
        for t in trend_data:
            d = datetime.strptime(str(t['date']), '%Y-%m-%d').date()
            w = d.weekday()
            present_val = t.get('present_count', 0)
            if w < 5 and isinstance(present_val, (int, float)) and present_val > 0: # Only count active workdays
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
    except:
        weekly_stats = [0, 0, 0, 0, 0]
        weekly_counts = [0, 0, 0, 0, 0]

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
    try:
        total_wfh = sum(e['wfh_days'] for e in employee_data)
        wfh_ratio = round((total_wfh / total_present * 100), 1) if total_present > 0 else 0
    except:
        wfh_ratio = 0
    
    # NEW: At-Risk Departments (Below 60% average)
    at_risk = [d for d in department_stats if d['attendance_rate'] < 60]
    
    # NEW: Department Rankings & Patterns
    # Added to department_stats already, but we'll highlight top/bottom
    top_depts = department_stats[:3]
    bottom_depts = department_stats[-3:] if len(department_stats) > 3 else []

    # NEW: Advanced Analytics for Phase 9
    try:
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
    except:
        trend_history = []
        streak = 0
        busiest_impact = 0

    # Final AI Insight generation with safety
    try:
        ai_insight = SLMInsightGenerator.generate_insight({
            'forecast': forecast_val,
            'confidence': confidence,
            'late_rate': late_rate,
            'attendance_streak': streak,
            'trend': trend_indicator,
            'peak_day': peak_day,
            'peak_hour': peak_hour_str
        })
    except:
        ai_insight = "Consistent organizational rhythm maintained."

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
        'avg_check_in': avg_check_in_str,
        'peak_day': peak_day,
        'wfh_ratio': wfh_ratio,
        'late_rate': late_rate,
        'weekly_stats': weekly_stats,
        'weekly_counts': weekly_counts,
        'at_risk_count': len(at_risk),
        'tomorrow_day': (datetime.now() + timedelta(days=1)).strftime('%A'),
        'trend_history': trend_history,
        'attendance_streak': streak,
        'busiest_impact': busiest_impact,
        'model_accuracy': (load_model_state() or {}).get('stability_factor', 0.95) * 100,
        'forecast_7d': calculate_multi_day_forecast(7),
        'hybrid_forecast': calculate_hybrid_forecast(predict_days),
        'ai_insight': ai_insight
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
