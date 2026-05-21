import React, { useState, useEffect, useRef } from 'react';
import { callOpenAI, logToSheets } from './OpenAI';
import imageData from './imageData.json';
import './App.css';

const finalRatingMessage = "Now what do you think about this news, Do you think this news is real or fake? Please write 'REAL' or 'FAKE' and give a rating from 0-100.\n\nFor example: 'FAKE 80' means you think its fake and you are 80% confident in that judgment.";

function App() {
  // Function to send data to Qualtrics embedded data
  const sendToQualtrics = (key, value) => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'store_embedded_data',
          key: key,
          value: value
        }, '*');
        console.log(`Sent to Qualtrics - ${key}:`, value);
      }
    } catch (error) {
      console.error('Error sending to Qualtrics:', error);
    }
  };

  // Function to send complete item data to appropriate study_item_X_data embedded value
  const sendItemDataToQualtrics = (itemOrder, data) => {
    const embeddedDataKey = `study_item_${itemOrder}_data`;
    sendToQualtrics(embeddedDataKey, JSON.stringify(data));
  };

  // Parse URL parameters for single item mode
  const [urlParams] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      itemId: params.get('item_id'),
      itemOrder: parseInt(params.get('item_order')) || 1,
      prolificId: params.get('PROLIFIC_PID') || params.get('prolificId') || '',
      condition: parseInt(params.get('condition')) || 1
    };
  });

  // Single item state
  const [currentItem, setCurrentItem] = useState(null);
  const [image, setImage] = useState(null);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [completionCode, setCompletionCode] = useState(null);

  // Original state variables for UI management
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [showFinalRating, setShowFinalRating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [seenBefore, setSeenBefore] = useState(null);
  const [initialBelief, setInitialBelief] = useState('');
  const [initialConfidence, setInitialConfidence] = useState(50);
  const [hasMovedSlider, setHasMovedSlider] = useState(false);
  const [showMainPrompt, setShowMainPrompt] = useState(false);
  const [selectedButton, setSelectedButton] = useState(null);
  const [hasAnsweredSeenBefore, setHasAnsweredSeenBefore] = useState(false);
  const [hasAnsweredInitialRating, setHasAnsweredInitialRating] = useState(false);
  // Final rating UI state variables (same as initial rating)
  const [finalSelectedButton, setFinalSelectedButton] = useState(null);
  const [finalConfidence, setFinalConfidence] = useState(50);
  const [finalHasMovedSlider, setFinalHasMovedSlider] = useState(false);
  const chatBodyRef = useRef(null);
  const [isSubmittingFinal, setIsSubmittingFinal] = useState(false);

  // Function to get completion code based on item order
  const getCompletionCode = (itemOrder) => {
    const codes = {
      1: 315,
      2: 918,
      3: 544,
      4: 420
    };
    return codes[itemOrder] || 315; // Default to first code
  };

  // Initialize item from URL parameters
  useEffect(() => {
    if (urlParams.itemId) {
      // Find item by ID in imageData
      const itemIndex = imageData.findIndex(item => item.fileName === `${urlParams.itemId}.jpg`);
      if (itemIndex !== -1) {
        setCurrentItem(itemIndex);
        setImage(imageData[itemIndex]);
      } else {
        console.error('Item not found:', urlParams.itemId);
      }
    } else if (urlParams.itemOrder) {
      // If no specific item_id, use item_order as index (for backwards compatibility)
      const itemIndex = (urlParams.itemOrder - 1) % imageData.length;
      setCurrentItem(itemIndex);
      setImage(imageData[itemIndex]);
    }
  }, [urlParams.itemId, urlParams.itemOrder]);

  useEffect(() => {
    if (currentItem !== null && image) {
      setMessages([]);
      setShowFinalRating(false);
      setIsSubmittingFinal(false);
      setSeenBefore(null);
      setInitialBelief('');
      setInitialConfidence(50);
      setHasMovedSlider(false);
      setShowMainPrompt(false);
      setHasAnsweredSeenBefore(false);
      setHasAnsweredInitialRating(false);
      setSelectedButton(null);
      // Reset final rating UI state
      setFinalSelectedButton(null);
      setFinalConfidence(50);
      setFinalHasMovedSlider(false);
    }
  }, [currentItem, image]);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const assistantMessagesCount = messages.filter(msg => msg.role === 'assistant').length;
    const containsDONE = messages.filter(msg => msg.content.includes('DONE'));
    if (assistantMessagesCount > 8 || containsDONE.length !== 0) {
      console.log("!!!!!!!!")
      setShowFinalRating(true);
    }
  }, [messages]);

  const handleSeenBeforeResponse = async (response) => {
    // PREVENT MULTIPLE CLICKS
    if (hasAnsweredSeenBefore) return;
    
    setHasAnsweredSeenBefore(true);
    setSeenBefore(response);
    setSelectedButton(response ? 'yes' : 'no');
  };

  const handleInitialRatingSubmit = async () => {
    console.log('handleInitialRatingSubmit called with:', { initialBelief, hasAnsweredInitialRating });
    
    if (initialBelief && !hasAnsweredInitialRating) {
      console.log('Proceeding with initial rating submission...');
      setHasAnsweredInitialRating(true);
      
      const responseData = {
        timestamp: new Date().toISOString(),
        participant_id: urlParams.prolificId,
        condition: urlParams.condition,
        imageId: currentItem,
        item_id: urlParams.itemId,
        item_order: urlParams.itemOrder,
        headline: image.caption,
        seenBefore: seenBefore ? 'Yes' : 'No',
        userResponse: `${initialBelief} ${initialConfidence}`,
        systemResponse: '',
        interactionNumber: 0,
        finalRatingSubmitted: ''
      };

      // Save to local storage (simplified)
      try {
        localStorage.setItem(`item_${currentItem}_response`, JSON.stringify({
          type: 'initialRating',
          ...responseData
        }));
      } catch (error) {
        console.error('Error saving to local storage:', error);
      }

      // Also log to sheets if available
      try {
        await logToSheets(responseData);
      } catch (error) {
        console.error('Error logging to sheets (continuing anyway):', error);
      }
      
      console.log('Setting showMainPrompt to true...');
      setShowMainPrompt(true);
      setMessages([]);
      setIsGenerating(true);
      
      try {
        // Generate initial AI response based on system prompt and user's rating
        console.log('Calling OpenAI with:', { condition: urlParams.condition, headline: image.caption, userRating: `${initialBelief} ${initialConfidence}` });
        const response = await callOpenAI([], urlParams.condition, image.caption, `${initialBelief} ${initialConfidence}`);
        console.log('OpenAI response:', response);
        const botMessage = { role: "assistant", content: response };
        
        const aiResponseData = {
          timestamp: new Date().toISOString(),
          participant_id: urlParams.prolificId,
          condition: urlParams.condition,
          imageId: currentItem,
          item_id: urlParams.itemId,
          item_order: urlParams.itemOrder,
          headline: image.caption,
          seenBefore: seenBefore ? 'Yes' : 'No',
          userResponse: '',
          systemResponse: response,
          interactionNumber: 1,
          finalRatingSubmitted: ''
        };

        // Save AI response with message history
        try {
          localStorage.setItem(`item_${currentItem}_ai_response`, JSON.stringify({
            type: 'aiResponse',
            ...aiResponseData,
            messages: [botMessage]
          }));
        } catch (error) {
          console.error('Error saving AI response to local storage:', error);
        }

        try {
          await logToSheets(aiResponseData);
        } catch (error) {
          console.error('Error logging AI response to sheets (continuing anyway):', error);
        }
        
        console.log('Setting messages with bot response...');
        setMessages([botMessage]);
      } catch (error) {
        console.error('Error generating initial AI response:', error);
        setMessages([{ role: "assistant", content: "I apologize, but I encountered an error. Please refresh and try again." }]);
      } finally {
        setIsGenerating(false);
      }
    } else {
      console.log('Conditions not met:', { initialBelief, hasAnsweredInitialRating });
    }
  };

  const submitFinalRatingAndProceed = async () => {
    // Prevent multiple submissions
    if (isSubmittingFinal) return;
    
    if (finalSelectedButton && finalHasMovedSlider) {
      setIsSubmittingFinal(true); // Disable further clicks
      
      // Format the response similar to the old text input format for consistency
      const formattedResponse = `${finalSelectedButton} ${finalConfidence}`;
      
      const finalResponseData = {
        timestamp: new Date().toISOString(),
        participant_id: urlParams.prolificId,
        condition: urlParams.condition,
        imageId: currentItem,
        item_id: urlParams.itemId,
        item_order: urlParams.itemOrder,
        headline: image.caption,
        seenBefore: seenBefore ? 'Yes' : 'No',
        userResponse: formattedResponse,
        systemResponse: finalRatingMessage,
        interactionNumber: messages.length,
        finalRatingSubmitted: finalConfidence
      };

      // Save to local storage with complete conversation
      try {
        localStorage.setItem(`item_${currentItem}_final_response`, JSON.stringify({
          type: 'finalRating',
          ...finalResponseData,
          messages: messages
        }));
      } catch (error) {
        console.error('Error saving final response to local storage:', error);
      }

      try {
        await logToSheets(finalResponseData);
      } catch (error) {
        console.error('Error logging final rating to sheets (continuing anyway):', error);
      }
      
      // Send complete study data to Qualtrics
      const completeStudyData = {
        ...finalResponseData,
        messages: messages,
        completionCode: getCompletionCode(urlParams.itemOrder)
      };
      sendItemDataToQualtrics(urlParams.itemOrder, completeStudyData);
      
      // Show completion with appropriate code
      const code = getCompletionCode(urlParams.itemOrder);
      setCompletionCode(code);
      setShowCompletionMessage(true);
    }
  };

/*
  const submitFinalRatingAndProceed = async () => {
    if (finalSelectedButton && finalHasMovedSlider) {
      // Format the response similar to the old text input format for consistency
      const formattedResponse = `${finalSelectedButton} ${finalConfidence}`;
      
      await logToSheets({
        timestamp: new Date().toISOString(),
        participant_id: prolificId,
        condition: condition,
        imageId: currentItem,
        headline: image.caption,
        seenBefore: seenBefore ? 'Yes' : 'No',
        userResponse: formattedResponse,
        systemResponse: finalRatingMessage,
        interactionNumber: messages.length,
        finalRatingSubmitted: finalConfidence
      });
      handleNext();
    }
  };*/

  const sendMessage = async () => {
    // Prevent sending if already generating or input is empty
    if (input.trim() && !isGenerating) {
      const userMessage = { role: "user", content: input };
      setMessages([...messages, userMessage]);
      setInput('');
      setIsGenerating(true);

      const response = await callOpenAI([...messages, userMessage], urlParams.condition, image.caption, `${initialBelief} ${initialConfidence}`);
      const botMessage = { role: "assistant", content: response };

      const conversationData = {
        timestamp: new Date().toISOString(),
        participant_id: urlParams.prolificId,
        condition: urlParams.condition,
        imageId: currentItem,
        item_id: urlParams.itemId,
        item_order: urlParams.itemOrder,
        headline: image.caption,
        seenBefore: seenBefore ? 'Yes' : 'No',
        userResponse: input,
        systemResponse: response,
        interactionNumber: messages.length,
        finalRatingSubmitted: ''
      };

      // Save to local storage with current conversation state
      try {
        localStorage.setItem(`item_${currentItem}_conversation_${messages.length}`, JSON.stringify({
          type: 'conversation',
          ...conversationData,
          messages: [...messages, userMessage, botMessage]
        }));
      } catch (error) {
        console.error('Error saving conversation to local storage:', error);
      }

      try {
        await logToSheets(conversationData);
      } catch (error) {
        console.error('Error logging conversation to sheets (continuing anyway):', error);
      }

      const newMessages = [...messages, userMessage, botMessage];
      setMessages(newMessages);

      const newAssistantCount = newMessages.filter(msg => msg.role === 'assistant').length;
      const containsDONE = newMessages.filter(msg => msg.content.includes('DONE'));
      if (newAssistantCount > 8 || containsDONE.length !==0) {
        console.log("!!!!!!!!!");
        setShowFinalRating(true);
      }
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !showFinalRating) {
      sendMessage();
    }
  };

  return (
    <div className="chat-container">
      {showCompletionMessage && completionCode && (
        <div className="completion-message">
          <h2 style={{ fontSize: '24px', color: '#333' }}>
            The code is {completionCode}, Please enter {completionCode} in the box below to proceed.
          </h2>
        </div>
      )}
      {!showCompletionMessage && image && (
        <>
          <div className="image-container">
            {/* Item info display */}
            <div className="item-counter">
              <span>Item {urlParams.itemOrder}</span>
            </div>
            
            <img 
              src={`imgs/${image.fileName}`} 
              alt="Test" 
              onError={(e) => {
                console.error('Image failed to load:', e.target.src);
                // Try absolute path as fallback
                e.target.src = `${window.location.origin}/imgs/${image.fileName}`;
              }}
            />
            <span className="image-caption">{image.caption}</span>
            
            {seenBefore === null && !showMainPrompt && (
              <div className="seen-before-prompt">
                <p>Have you seen this news before?</p>
                <div className="seen-before-buttons">

                  <button 
                    onClick={() => handleSeenBeforeResponse(true)}
                    className={`seen-before-button ${selectedButton === 'yes' ? 'selected' : ''}`}
                    disabled={hasAnsweredSeenBefore}
                  >
                    Yes
                  </button>
                  <button 
                    onClick={() => handleSeenBeforeResponse(false)}
                    className={`seen-before-button ${selectedButton === 'no' ? 'selected' : ''}`}
                    disabled={hasAnsweredSeenBefore}
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            {seenBefore !== null && !showMainPrompt && (
              <div className="initial-rating-prompt">
                <p>Please answer the question by <b>clicking on either fake or real</b> and <b>move the slider to continue</b> </p>
                <p>Do you think this news is Real or Fake?</p>
                <div className="initial-rating-container">
                  <div className="belief-buttons">
                    <button 
                      onClick={() => setInitialBelief('REAL')}
                      className={`belief-button ${initialBelief === 'REAL' ? 'selected' : ''}`}
                      disabled={hasAnsweredInitialRating}
                    >
                      REAL
                    </button>
                    <button 
                      onClick={() => setInitialBelief('FAKE')}
                      className={`belief-button ${initialBelief === 'FAKE' ? 'selected' : ''}`}
                      disabled={hasAnsweredInitialRating}
                    >
                      FAKE
                    </button>
                  </div>
                  
                  <div className="confidence-container">
                    <label>Confidence: {initialConfidence}%</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={initialConfidence}
                      onChange={(e) => {
                        setInitialConfidence(e.target.value);
                        setHasMovedSlider(true);
                      }}
                      disabled={hasAnsweredInitialRating}
                      className="confidence-slider"
                    />
                  </div>
                  
                  <button 
                    onClick={handleInitialRatingSubmit}
                    className="submit-initial-rating-button"
                    disabled={!initialBelief || !hasMovedSlider || hasAnsweredInitialRating}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {showFinalRating && (
              <div className="initial-rating-prompt">
                <p>Based on your interaction, Please rate this news item again by <b>clicking on either fake or real</b> and <b>move the slider.</b></p>
                <p>Now what do you think about this news? Do you think this news is Real or Fake?</p>
                <div className="initial-rating-container">
                  <div className="belief-buttons">
                    <button 
                      onClick={() => setFinalSelectedButton('REAL')}
                      className={`belief-button ${finalSelectedButton === 'REAL' ? 'selected' : ''}`}
                    >
                      REAL
                    </button>
                    <button 
                      onClick={() => setFinalSelectedButton('FAKE')}
                      className={`belief-button ${finalSelectedButton === 'FAKE' ? 'selected' : ''}`}
                    >
                      FAKE
                    </button>
                  </div>
                  
                  <div className="confidence-container">
                    <label>Confidence: {finalConfidence}%</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={finalConfidence}
                      onChange={(e) => {
                        setFinalConfidence(e.target.value);
                        setFinalHasMovedSlider(true);
                      }}
                      className="confidence-slider"
                    />
                  </div>

                  <button 
                  onClick={submitFinalRatingAndProceed}
                  className="submit-initial-rating-button"
                  disabled={!finalSelectedButton || !finalHasMovedSlider || isSubmittingFinal}
                >
                  {isSubmittingFinal ? 'Submitting... Please wait' : 'Finish →'}
                </button>
                </div>
              </div>
            )}
            
            <hr className="image-divider" />
          </div>

          {showMainPrompt && !showFinalRating && (
            <div className="chat-body" ref={chatBodyRef}>
              {messages
                .filter(msg => msg.role !== 'system')
                .map((msg, index) => (
                  <div
                    key={index}
                    className={`chat-message ${msg.role === 'user' ? 'user-message' : 'assistant-message'}`}
                  >
                    <div className="chat-avatar">
                      {msg.role === 'assistant' && <span className="material-icons">smart_toy</span>}
                    </div>
                    <div className="chat-content">
                      <span>{msg.content}</span>
                    </div>
                  </div>
                ))}
              
              {showFinalRating && (
                <div className="chat-message assistant-message">
                  <div className="chat-avatar">
                    <span className="material-icons">smart_toy</span>
                  </div>
                  <div className="chat-content">
                    <span>{finalRatingMessage}</span>
                  </div>
                </div>
              )}

              {isGenerating && (
                <div className="chat-message assistant-message">
                  <div className="chat-avatar">
                    <span className="material-icons">smart_toy</span>
                  </div>
                  <div className="chat-content generating">
                    <span>Generating response, Please wait...</span>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {showMainPrompt && !showFinalRating && (
            <div className="chat-footer">
              <div className="inputbar">
                <input 
                  type="text" 
                  value={input} 
                  onChange={(e) => setInput(e.target.value)} 
                  onKeyDown={handleKeyDown}
                  placeholder="Write your message." 
                />
                <button 
                  onClick={sendMessage} 
                  className="send-button"
                >
                  ➤
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;