import requests
import time
import os
import math

# Configuration
API_TOKEN = os.getenv('SMARTSHEET_ACCESS_TOKEN', 'YOUR_RAW_TOKEN_HERE')
BASE_URL = 'https://api.smartsheet.com/2.0'
HEADERS = {
    'Authorization': f'Bearer {API_TOKEN}',
    'Content-Type': 'application/json'
}

def make_request_with_backoff(url, params=None):
    """
    Custom wrapper to implement Exponential Backoff for Rate Limiting (429).
    Docs: https://developers.smartsheet.com/api/smartsheet/guides/advanced-topics/scalability-options
    """
    max_retries = 5
    attempt = 0
    
    while attempt < max_retries:
        response = requests.get(url, headers=HEADERS, params=params)
        
        # SUCCESS (200 OK)
        if response.status_code == 200:
            return response.json()
            
        # RATE LIMIT HIT (429 Too Many Requests)
        elif response.status_code == 429:
            # 1. Try to get the server's requested wait time
            # 2. Fallback to Exponential Backoff: 2s, 4s, 8s, 16s...
            retry_header = response.headers.get('Retry-After')
            
            if retry_header:
                wait_time = int(retry_header) + 1 # Add buffer
                print(f"⚠️ Rate limit hit. Server requested wait: {wait_time}s")
            else:
                wait_time = math.pow(2, attempt + 1)
                print(f"⚠️ Rate limit hit. Backing off for {wait_time}s...")
            
            time.sleep(wait_time)
            attempt += 1
            continue
            
        # OTHER ERRORS (401, 403, 500)
        else:
            response.raise_for_status()
            
    # If we exit the loop, we failed too many times
    raise Exception(f"Max retries ({max_retries}) exceeded for {url}")

def get_plan_id():
    try:
        data = make_request_with_backoff(f'{BASE_URL}/users/me')
        plan_id = data.get('account', {}).get('plan', {}).get('id')
        if plan_id:
            return plan_id
        print("❌ Plan ID not found.")
        return None
    except Exception as e:
        print(f"Error getting Plan ID: {e}")
        return None

def get_all_users_manual(plan_id):
    users = []
    page = 1
    page_size = 100
    has_more = True
    
    print("Fetching users with Manual Exponential Backoff...")
    
    while has_more:
        params = {
            'include': 'lastLogin',
            'planId': plan_id,
            'pageSize': page_size,
            'page': page
        }
        
        try:
            # Call our robust wrapper instead of requests.get directly
            data = make_request_with_backoff(f'{BASE_URL}/users', params=params)
            
            current_batch = data.get('data', [])
            users.extend(current_batch)
            print(f"  - Page {page}: Retrieved {len(current_batch)} users.")
            
            total_pages = data.get('totalPages', 0)
            if page >= total_pages:
                has_more = False
            else:
                page += 1
                
        except Exception as e:
            print(f"❌ Failed on page {page}: {e}")
            break
            
    return users

if __name__ == "__main__":
    my_plan_id = get_plan_id()
    if my_plan_id:
        all_users = get_all_users_manual(my_plan_id)
        print(f"✅ Total Users Retrieved: {len(all_users)}")
