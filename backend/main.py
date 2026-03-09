import jwt
import datetime
import uuid

@app.get("/get-embed-token")
def get_tableau_jwt():
    # These would come from your Tableau Server / Cloud Connected App settings
    connected_app_client_id = os.getenv("TABLEAU_CLIENT_ID")
    connected_app_secret_id = os.getenv("TABLEAU_SECRET_ID")
    connected_app_secret_key = os.getenv("TABLEAU_SECRET_KEY")
    user_name = "user@yourdomain.com" # The Tableau user to impersonate

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
    system_prompt = """
You are an AI assistant controlling a Tableau dashboard.
The dashboard contains patent and exclusivity data.

Available fields: 'Appl_Type', 'Patent_Expire_Date', 'Drug_Substance_Flag', etc.

Convert the user's natural language request into a valid JSON object representing Tableau filters.
Use this format exactly:
{
  "filters": [
    {
      "fieldName": "Appl_Type",
      "values": ["Value1", "Value2"],
      "isDateRange": false
    },
    {
       "fieldName": "Patent_Expire_Date",
       "min": "2001-03-14",
       "max": "2029-12-31",
       "isDateRange": true
    }
  ]
}
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