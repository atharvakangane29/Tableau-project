import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import '@tableau/embedding-api'; 

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

function DashboardChat() {
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([
    { role: 'ai', content: 'Hello! Ask me to filter the dashboard or ask a question about the data!' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const vizRef = useRef(null);
  const [jwtToken, setJwtToken] = useState(null);

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

  // Helper function to format Tableau Data into a small string for the LLM
  const formatTableauData = (dataTable, maxRows = 25) => {
    const columns = dataTable.columns.map(c => c.fieldName);
    const rows = dataTable.data.slice(0, maxRows).map(row => 
      row.map(val => val.formattedValue || val.value).join(" | ")
    );
    return [columns.join(" | "), ...rows].join("\n");
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !vizRef.current) return;

    const userMessage = chatInput;
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatInput("");
    setIsLoading(true);

    try {
      const workbook = vizRef.current.workbook;
      if (!workbook || !workbook.activeSheet) {
        setMessages(prev => [...prev, { role: 'ai', content: "Please wait for the dashboard to fully load." }]);
        setIsLoading(false);
        return;
      }

      const activeSheet = workbook.activeSheet;
      const worksheets = activeSheet.sheetType === 'dashboard' ? activeSheet.worksheets : [activeSheet];

      // 1. Get Filters and Schema Context from ALL worksheets
      let availableFilterNames = new Set();
      let schemaColumns = new Set();

      for (let sheet of worksheets) {
        try {
          const filters = await sheet.getFiltersAsync();
          filters.forEach(f => availableFilterNames.add(f.fieldName));

          const dataTable = await sheet.getSummaryDataAsync();
          dataTable.columns.forEach(c => schemaColumns.add(c.fieldName));
        } catch (err) {
          // Ignore sheets that do not support data fetching (like text boxes)
        }
      }

      const filtersArr = Array.from(availableFilterNames);
      const schemaArr = Array.from(schemaColumns);

      // 2. Initial Chat Request to AI (Turn 1)
      let response = await axios.post(`${BACKEND_URL}/chat`, {
        message: userMessage,
        available_filters: filtersArr,
        schema_columns: schemaArr
      });
      
      let aiResult = response.data;

      // Condition 1: Out of schema
      if (aiResult.is_sufficient === false) {
        setMessages(prev => [...prev, { role: 'ai', content: aiResult.error_log }]);
        setIsLoading(false);
        return;
      }

      // 3. APPLY FILTERS FIRST (if the AI generated any)
      if (aiResult.filters && aiResult.filters.length > 0) {
        for (let filter of aiResult.filters) {
          for (let sheet of worksheets) {
            try {
              if (filter.isDateRange) {
                await sheet.applyRangeFilterAsync(filter.fieldName, {
                  min: new Date(filter.min),
                  max: new Date(filter.max)
                });
              } else {
                await sheet.applyFilterAsync(filter.fieldName, filter.values, "replace");
              }
            } catch(e) { /* Ignore if a specific sheet doesn't have this filter */ }
          }
        }
      }

      // Condition 3: Needs Underlying data to answer the specific query
      if (aiResult.needs_data) {
        setMessages(prev => [...prev, { role: 'ai', content: "Reading the dashboard data..." }]);
        
        // Fetch actual data AFTER filters are applied
        let combinedDataString = "";
        for (let sheet of worksheets) {
          try {
            const viewData = await sheet.getSummaryDataAsync(); 
            if (viewData.data.length > 0) {
                combinedDataString += `\n[Chart: ${sheet.name}]\n` + formatTableauData(viewData) + "\n";
            }
          } catch(e) {}
        }

        // Call AI again with the filtered data (Turn 2)
        response = await axios.post(`${BACKEND_URL}/chat`, {
          message: userMessage,
          available_filters: filtersArr,
          schema_columns: schemaArr,
          view_data: combinedDataString 
        });
        aiResult = response.data;
      }

      // Condition 2: Output Insight 
      if (aiResult.insight) {
        setMessages(prev => [...prev, { role: 'ai', content: aiResult.insight }]);
      } else if (!aiResult.needs_data) {
        // Fallback if AI just filtered but didn't write an insight
        setMessages(prev => [...prev, { role: 'ai', content: "I've applied those filters for you." }]);
      }

    } catch (error) {
      console.error("Error processing request:", error);
      setMessages(prev => [...prev, { role: 'ai', content: "An error occurred while processing your request." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ flex: 3, backgroundColor: '#f3f2f1' }}>
        <tableau-viz 
          ref={vizRef}
          id="tableauViz"       
          src={tableauUrl}
          token={jwtToken}
          toolbar="hidden" 
          hide-tabs={true}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      <div style={{ flex: 1, padding: '20px', borderLeft: '1px solid #ccc', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
        <h2 style={{ marginTop: 0, color: '#333' }}>Dashboard Assistant</h2>
        
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {messages.map((msg, index) => (
            <div key={index} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.role === 'user' ? '#0078D4' : '#e1dfdd',
              color: msg.role === 'user' ? 'white' : 'black',
              padding: '10px 14px',
              borderRadius: '8px',
              maxWidth: '85%',
              wordWrap: 'break-word'
            }}>
              <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap' }}>{msg.content}</p>
            </div>
          ))}
        </div>

        <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            value={chatInput} 
            onChange={(e) => setChatInput(e.target.value)} 
            placeholder="Type your request here..." 
            disabled={isLoading}
            style={{ flex: 1, padding: '12px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '14px' }}
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