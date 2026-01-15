import csv
from datetime import datetime

# Configuration
CSV_FILE_PATH = 'User_Type_Report.csv'

def parse_user_report_sdk_style(file_path):
    """
    Parses the User Type Report CSV.
    Returns a dictionary formatted to mimic Smartsheet SDK objects (snake_case).
    """
    user_db = {}
    
    try:
        with open(file_path, mode='r', encoding='utf-8-sig') as csvfile:
            reader = csv.DictReader(csvfile)
            
            for row in reader:
                email = row.get('Email')
                
                if email:
                    # 1. Parse Created Date (Critical field missing from API)
                    raw_created = row.get('Created Date', '')
                    formatted_created = None
                    if raw_created:
                        try:
                            # Adjust format matches your CSV (e.g. MM/DD/YYYY or DD/MM/YYYY)
                            dt = datetime.strptime(raw_created, '%m/%d/%y')
                            formatted_created = dt.strftime('%Y-%m-%d')
                        except ValueError:
                            pass # Keep as None if parse fails

                    # 2. Parse Usage Stats (Available in Report but not API)
                    try:
                        sheet_count = int(row.get('Owned Sheets', 0) or 0)
                    except ValueError:
                        sheet_count = 0

                    # 3. Build Record (SDK-Style snake_case keys)
                    user_db[email] = {
                        'email': email,
                        'first_name': row.get('First Name'),
                        'last_name': row.get('Last Name'),
                        'status': row.get('Status'),
                        'seat_type': row.get('User Type'), # Maps to seatType
                        'created_at': formatted_created,   # The missing link
                        'last_login': row.get('Last Login'),
                        'sheet_count': sheet_count,
                        'source': 'csv_report'
                    }
                    
        return user_db

    except FileNotFoundError:
        print(f"❌ Error: File '{file_path}' not found.")
        return {}

# --- Execution Flow ---
if __name__ == "__main__":
    print(f"Reading report: {CSV_FILE_PATH}...")
    db = parse_user_report_sdk_style(CSV_FILE_PATH)
    
    print(f"✅ Loaded {len(db)} users from report.")
    
    # Validation
    test_email = "john.doe@example.com" # Replace with a real email to test
    if test_email in db:
        user = db[test_email]
        print(f"\nUser Found: {user['email']}")
        print(f"Account Age (Created): {user['created_at']}")
        print(f"Sheets Owned: {user['sheet_count']}")
