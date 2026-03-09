import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
// Import the Tableau Embedding API
import { TableauViz } from '@tableau/embedding-api'; 

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

function DashboardChat() {
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const vizRef = useRef(null);
  const [jwtToken, setJwtToken] = useState(null);

// Change this to your actual Tableau Cloud or Server published dashboard URL
const tableauUrl = "https://prod-in-a.online.tableau.com/t/atharvak-de1259dc71/views/Superstore/Product";

useEffect(() => {
  const fetchToken = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/get-embed-token`);
      setJwtToken(res.data.token);
    } catch (err) {
      console.error("Failed to fetch Tableau JWT:", err);
    }
  };
  fetchToken();
}, []);

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !vizRef.current) return;

    setIsLoading(true);
    try {
      // 1. Get the workbook and sheets ONCE
      const workbook = vizRef.current.workbook;
      if (!workbook || !workbook.activeSheet) {
        alert("Please wait for the dashboard to fully load before sending a command.");
        setIsLoading(false);
        return;
      }
      const activeSheet = workbook.activeSheet;
      
      const worksheets = activeSheet.sheetType === 'dashboard' 
        ? activeSheet.worksheets 
        : [activeSheet];

      // 2. Grab the filters from the first worksheet to send as context
      let availableFilterNames = [];
      if (worksheets.length > 0) {
        const filters = await worksheets[0].getFiltersAsync();
        availableFilterNames = filters.map(f => f.fieldName);
      }

      // 3. Send both the message AND the dynamic context to FastAPI
      const response = await axios.post(`${BACKEND_URL}/chat-to-filter`, {
        message: chatInput,
        available_filters: availableFilterNames
      });
      
      const aiFilters = response.data.filters.filters; 

      // 4. Apply the AI-generated filters to the sheets we already found
      for (let filter of aiFilters) {
        for (let sheet of worksheets) { // Reused the 'worksheets' variable here
          if (filter.isDateRange) {
            await sheet.applyRangeFilterAsync(filter.fieldName, {
              min: new Date(filter.min),
              max: new Date(filter.max)
            });
          } else {
            await sheet.applyFilterAsync(
              filter.fieldName, 
              filter.values, 
              "replace" 
            );
          }
        }
      }
      setChatInput("");
    } catch (error) {
      console.error("Failed to apply filters:", error);
      alert("Could not process the filter request.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      
      <div style={{ flex: 3, backgroundColor: '#f3f2f1' }}>
        {/* 2. Use the modern web component instead of the iframe/object embed */}
        <tableau-viz 
          ref={vizRef}
          id="tableauViz"       
          src={tableauUrl}
          token={jwtToken}
          toolbar="hidden" 
          hide-tabs={true}
          style={{ width: '100%', height: '100%' }}
        >
        </tableau-viz>
      </div>

      <div style={{ flex: 1, padding: '20px', borderLeft: '1px solid #ccc', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
        <h2 style={{ marginTop: 0, color: '#333' }}>Dashboard Assistant</h2>
        
        {/* Chat message display area */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee' }}>
          <p style={{ color: '#555', margin: 0 }}>
            <strong>AI:</strong> Hello! Ask me to filter the dashboard. Try saying something like <em>"Show me only the Technology category"</em> or <em>"Filter order dates to 2023."</em>
          </p>
        </div>

        {/* Chat Input Form */}
        <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            value={chatInput} 
            onChange={(e) => setChatInput(e.target.value)} 
            placeholder="Type your filter request here..." 
            disabled={isLoading}
            style={{ 
              flex: 1, 
              padding: '12px', 
              borderRadius: '6px', 
              border: '1px solid #ccc',
              fontSize: '14px'
            }}
          />
          <button 
            type="submit" 
            disabled={isLoading || !chatInput.trim()}
            style={{ 
              padding: '12px 24px', 
              backgroundColor: isLoading ? '#99c3e6' : '#0078D4', 
              color: 'white', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {isLoading ? 'Thinking...' : 'Send'}
          </button>
        </form>
      </div>

    </div>
  );
}

export default DashboardChat;