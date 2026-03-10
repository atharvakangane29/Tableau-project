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
from typing import List, Optional

load_dotenv() 

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI() 

class ChatRequest(BaseModel):
    message: str
    available_filters: List[str] = [] 
    schema_columns: List[str] = [] 
    view_data: Optional[str] = None 

@app.get("/get-embed-token")
def get_tableau_jwt():
    connected_app_client_id = os.getenv("TABLEAU_CLIENT_ID")
    connected_app_secret_id = os.getenv("TABLEAU_SECRET_ID")
    connected_app_secret_key = os.getenv("TABLEAU_SECRET_KEY")
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

@app.post("/chat")
def chat_agent(req: ChatRequest):
    filters_string = ", ".join(req.available_filters) if req.available_filters else "None"
    columns_string = ", ".join(req.schema_columns) if req.schema_columns else "Unknown"

    system_prompt = f"""
You are an AI data assistant controlling a Tableau dashboard.

Dashboard Context:
- Available filter fields: {filters_string}
- Available data columns (schema): {columns_string}

Your task is to analyze the user's request and respond in EXACTLY this JSON format:
{{
  "is_sufficient": true/false,
  "error_log": "the data is not sufficient for the query", 
  "needs_data": true/false,
  "insight": "Your conversational response...",
  "filters": [
    {{ "fieldName": "Category", "values": ["Furniture"], "isDateRange": false }}
  ]
}}

RULES:
1. Context Validation: Set "is_sufficient" to false ONLY IF the user's query is completely irrelevant (e.g., asking about the weather, or a missing domain like 'Employee Names'). Be smart about synonyms (e.g., "sales" = "SUM(Sales)", "years" = "Order Date", "top 5", "highest"). Standard data questions are ALWAYS sufficient.
2. Missing Data / Insights: If the user asks a specific question about the data values (e.g. "What was the highest sale?", "Total sales for region X?", "top 5 records") AND `view_data` is NOT provided below, set "needs_data" to true and leave "insight" empty for now.
3. Applying Filters: Always populate the "filters" array if the user implies a filter (e.g., "jan 2023", "western region"). Map conversational terms (like "western") to the likely standard value (like "West"). 
4. Generating Insight: If "view_data" IS provided below, read the data, calculate the answer, and provide a clear, conversational "insight".
"""

    user_content = req.message
    if req.view_data:
        user_content += f"\n\nHere is the current dashboard data to answer the query:\n{req.view_data}"

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            temperature=0
        )
        
        raw_content = response.choices[0].message.content.strip()
        if raw_content.startswith("```json"):
            raw_content = raw_content[7:-3].strip()
        elif raw_content.startswith("```"):
            raw_content = raw_content[3:-3].strip()
            
        print("AI Output:", raw_content)
        return json.loads(raw_content)
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="LLM did not return valid JSON.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))