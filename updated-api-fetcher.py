import requests
import time
import json

# Configuration
API_TOKEN = 'YOUR_SMARTSHEET_ACCESS_TOKEN'
BASE_URL = 'https://api.smartsheet.com/2.0'
HEADERS = {
    'Authorization': f'Bearer {API_TOKEN}',
    'Content-Type': 'application/json'
}

def get_plan_id():
    """
    Step 1: Get the current authenticated user's organization Plan ID.
    This is required to fetch specific 'seatType' data in the user list.
    """
    response = requests.get(f'{BASE_URL}/users/me', headers=HEADERS)
    response.raise_for_status()
    data = response.json()
    
    # Navigate the response object to find the Plan ID
    # Structure usually: account -> plan -> id
    try:
        plan_id = data['account']['plan']['id']
        print(f"✅ Found Plan ID: {plan_id}")
        return plan_id
    except KeyError:
        print("❌ Could not retrieve Plan ID. Ensure your account is part of an Enterprise Plan.")
        return None

def get_all_users(plan_id):
    """
    Step 2: Fetch all users using the Plan ID to populate 'seatType'.
    Handles pagination automatically.
    """
    users = []
    page = 1
    has_more_pages = True
    
    print("Fetching users...")
    
    while has_more_pages:
        # We pass planId here to force the API to return seatType (Member/Guest/Viewer)
        params = {
            'include': 'lastLogin',
            'planId': plan_id,
            'pageSize': 100,
            'page': page
        }
        
        try:
            response = requests.get(f'{BASE_URL}/users', headers=HEADERS, params=params)
            
            # Simple Rate Limit Handling (Exponential Backoff could be added here)
            if response.status_code == 429:
                print("Rate limit hit. Sleeping for 30s...")
                time.sleep(30)
                continue
                
            response.raise_for_status()
            data = response.json()
            
            # Add current page of users to our master list
            users.extend(data['data'])
            
            # Check if there are more pages
            total_pages = data['totalPages']
            if page >= total_pages:
                has_more_pages = False
            else:
                page += 1
                # Small courtesy sleep to be nice to the API
                time.sleep(0.5) 
                
        except Exception as e:
            print(f"Error on page {page}: {str(e)}")
            break
            
    return users

# --- Execution Flow ---
if __name__ == "__main__":
    my_plan_id = get_plan_id()
    
    if my_plan_id:
        all_users = get_all_users(my_plan_id)
        print(f"✅ Successfully retrieved {len(all_users)} users.")
        
        # Example: Print the first 5 users to verify seatType exists
        print("\nSample Data (First 5):")
        for user in all_users[:5]:
            # Now we can see correct Seat Type instead of inferring from licensedSheetCreator
            print(f"- {user['email']}: {user.get('seatType', 'UNKNOWN')} "
                  f"(Last Login: {user.get('lastLogin', 'NEVER')})")
