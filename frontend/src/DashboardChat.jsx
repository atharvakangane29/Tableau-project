import React, { useState, useRef } from 'react';
import axios from 'axios';
// Import the Tableau Embedding API
import { TableauViz } from '@tableau/embedding-api'; 

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

function DashboardChat() {
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const vizRef = useRef(null);

  // 1. Insert your clean Tableau Public URL here
  const tableauUrl = "https://public.tableau.com/views/Trial_17728055121880/Dashboard1";

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !vizRef.current) return;

    setIsLoading(true);
    try {
      const response = await axios.post(`${BACKEND_URL}/chat-to-filter`, {
        message: chatInput
      });
      
      const aiFilters = response.data.filters.filters; 
      
      const workbook = vizRef.current.workbook;
      const activeSheet = workbook.activeSheet;
      
      const sheetsToFilter = activeSheet.sheetType === 'dashboard' 
        ? activeSheet.worksheets 
        : [activeSheet];

      for (let filter of aiFilters) {
        for (let sheet of sheetsToFilter) {
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
          toolbar="hidden" 
          hide-tabs={true}
          style={{ width: '100%', height: '100%' }}
        >
        </tableau-viz>
      </div>

      <div style={{ flex: 1, padding: '20px', borderLeft: '1px solid #ccc', display: 'flex', flexDirection: 'column' }}>
          {/* Keep your existing chat UI here (input, button, message list) */}
      </div>

    </div>
  );
}

export default DashboardChat;