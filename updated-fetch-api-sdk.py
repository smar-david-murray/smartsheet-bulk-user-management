import smartsheet
import logging
import os

# Configuration
API_TOKEN = os.getenv('SMARTSHEET_ACCESS_TOKEN', 'YOUR_RAW_TOKEN_HERE')

# Initialize SDK Client
# The SDK automatically handles 429 Rate Limits with exponential backoff.
# We set errors_as_exceptions(True) to ensure we only catch the FINAL failure 
# after the SDK has exhausted its automatic retries.
smart = smartsheet.Smartsheet(API_TOKEN)
smart.errors_as_exceptions(True)

def get_plan_id():
    """Step 1: Get Plan ID via SDK."""
    try:
        user_me = smart.Users.get_current_user()
        if user_me.account and user_me.account.plan:
            return user_me.account.plan.id
        return None
    except Exception as e:
        print(f"Error getting Plan ID: {e}")
        return None

def get_all_users_sdk_paginated(plan_id):
    """
    Step 2: Fetch all users using the SDK.
    REFACTOR NOTE: We removed manual 429 handling because the SDK does it natively.
    """
    users = []
    page = 1
    page_size = 100
    has_more = True
    
    print("Fetching users with SDK (Native Auto-Retry enabled)...")
    
    while has_more:
        try:
            # The SDK will auto-retry this call if it hits a rate limit.
            # We don't need to write a loop for it.
            response = smart.Users.list_users(
                include="lastLogin",
                page_size=page_size,
                page=page,
                plan_id=plan_id
            )
            
            users.extend(response.data)
            print(f"  - Page {page}: Retrieved {len(response.data)} users.")
            
            # Check if we have reached the last page
            if page >= response.total_pages:
                has_more = False
            else:
                page += 1
                
        except smartsheet.exceptions.ApiError as e:
            # If we get here, the SDK tried its best (retried multiple times) and failed.
            print(f"❌ API Error on page {page} (Retries exhausted): {e}")
            break
        except Exception as e:
            print(f"❌ Unexpected error on page {page}: {e}")
            break
            
    return users

if __name__ == "__main__":
    my_plan_id = get_plan_id()
    if my_plan_id:
        all_users = get_all_users_sdk_paginated(my_plan_id)
        print(f"✅ Total Users Retrieved: {len(all_users)}")
