import csv
from datetime import datetime

# Path to your manually downloaded CSV report
CSV_FILE_PATH = 'User_Type_Report.csv'

def parse_user_report(file_path):
    """
    Reads the Smartsheet User Type Report CSV.
    Extracts Email, Created Date, and usage metrics.
    """
    user_database = {}
    
    try:
        with open(file_path, mode='r', encoding='utf-8-sig') as csvfile:
            reader = csv.DictReader(csvfile)
            
            for row in reader:
                email = row.get('Email')
                
                if email:
                    # Parse the "Created Date" (Format in CSV is usually MM/DD/YYYY)
                    # Adjust format string based on your specific CSV locale
                    raw_date = row.get('Created Date', '')
                    try:
                        created_dt = datetime.strptime(raw_date, '%m/%d/%y') # e.g., 01/14/25
                        formatted_date = created_dt.strftime('%Y-%m-%d')
                    except ValueError:
                        formatted_date = None # Handle missing or malformed dates

                    # Capture Usage Data (if available in your report columns)
                    # Note: Column names must match the CSV headers exactly
                    user_database[email] = {
                        'first_name': row.get('First Name'),
                        'last_name': row.get('Last Name'),
                        'status': row.get('Status'),
                        'created_at': formatted_date,
                        'last_login': row.get('Last Login'),
                        'sheet_count': row.get('Owned Sheets', 0)
                    }
                    
        return user_database

    except FileNotFoundError:
        print(f"Error: The file {file_path} was not found.")
        return {}

# --- Execution Flow ---
if __name__ == "__main__":
    print(f"Parsing {CSV_FILE_PATH}...")
    db = parse_user_report(CSV_FILE_PATH)
    
    print(f"✅ Loaded {len(db)} users from report.")
    
    # Example: Check for recent creations (e.g., last 30 days logic)
    # This simulates the 'Account Age' check you wanted
    sample_email = "example.user@company.com"
    if sample_email in db:
        user = db[sample_email]
        print(f"\nUser: {sample_email}")
        print(f"Created On: {user['created_at']}")
        print(f"Status: {user['status']}")
