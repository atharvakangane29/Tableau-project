import jwt
import datetime
import uuid
import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
from typing import List

load_dotenv() # Loads your .env file

app = FastAPI()

# Allow React frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI() # Assumes OPENAI_API_KEY is in .env

class ChatRequest(BaseModel):
    message: str
    available_filters: List[str] = [] # New field to accept dynamic context

@app.get("/get-embed-token")
def get_tableau_jwt():
    # These would come from your Tableau Server / Cloud Connected App settings
    connected_app_client_id = os.getenv("TABLEAU_CLIENT_ID")
    connected_app_secret_id = os.getenv("TABLEAU_SECRET_ID")
    connected_app_secret_key = os.getenv("TABLEAU_SECRET_KEY")
    # IMPORTANT: Change this to the exact email address you use to log into Tableau Cloud/Server
    user_name = "atharvak@circulants.com"

    token = jwt.encode(
        {
            "iss": connected_app_client_id,
            "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=10),
            "jti": str(uuid.uuid4()),
            "aud": "tableau",
            "sub": user_name,
            "scp": ["tableau:views:embed", "tableau:metrics:embed"]
        },
        connected_app_secret_key,
        algorithm="HS256",
        headers={
            "kid": connected_app_secret_id,
            "iss": connected_app_client_id
        }
    )
    return {"token": token}

@app.post("/chat-to-filter")
def chat_to_filter(req: ChatRequest):
    # Convert the list of filters from the frontend into a comma-separated string
    filters_string = ", ".join(req.available_filters) if req.available_filters else "Unknown"

    # Use an f-string to dynamically inject the context
    system_prompt = f"""
You are an AI assistant controlling a Tableau dashboard.

Based on the current dashboard, the valid fields you can filter on are: {filters_string}

Convert the user's natural language request into a valid JSON object representing Tableau filters.
Only use the field names provided in the list above.

Use this format exactly:
{{
  "filters": [
    {{
      "fieldName": "Category",
      "values": ["Technology", "Furniture"],
      "isDateRange": false
    }},
    {{
       "fieldName": "Order Date",
       "min": "2020-01-01",
       "max": "2024-12-31",
       "isDateRange": true
    }}
  ]
}}
Return ONLY valid JSON without markdown.
"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.message}
            ],
            temperature=0
        )
        
        # 1. Get the raw text
        raw_content = response.choices[0].message.content.strip()
        
        # 2. SAFETY CHECK: Strip markdown code blocks if the LLM added them
        if raw_content.startswith("```json"):
            raw_content = raw_content[7:-3].strip()
        elif raw_content.startswith("```"):
            raw_content = raw_content[3:-3].strip()
            
        print("AI Generated String:", raw_content)  # Debugging log
        
        # 3. Load the cleaned string into JSON
        filter_json = json.loads(raw_content)
        return {"filters": filter_json}
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"LLM did not return valid JSON. It returned: {raw_content}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))