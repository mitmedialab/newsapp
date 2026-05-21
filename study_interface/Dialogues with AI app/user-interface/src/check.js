

import React, { useState, useEffect, useRef } from 'react';
import { callOpenAI, logToSheets } from './OpenAI';
import imageData from './imageData.json';
import './App.css';

const finalRatingMessage = "Now what do you think about this news, Do you think this news is real or fake? Please write 'REAL' or 'FAKE' and give a rating from 0-100.\n\nFor example: 'FAKE 80' means you think its fake and you are 80% confident in that judgment.";

// Helper function to sample 2 real and 2 fake images
const sampleImagesForStudy = () => {
  const realImages = [];
  const fakeImages = [];
  
  // Separate images by ground truth and keep track of original indices
  imageData.forEach((item, index) => {
    if (item.ground_truth === 0) {
      realImages.push(index);
    } else if (item.ground_truth === 1) {
      fakeImages.push(index);
    }
  });
  
  // Shuffle arrays
  const shuffledReal = realImages.sort(() => Math.random() - 0.5);
  const shuffledFake = fakeImages.sort(() => Math.random() - 0.5);
  
  // Take 2 from each
  const selectedReal = shuffledReal.slice(0, 2);
  const selectedFake = shuffledFake.slice(0, 2);
  
  // Combine and shuffle the final selection
  const studyImages = [...selectedReal, ...selectedFake].sort(() => Math.random() - 0.5);
  
  return studyImages;
};

/*
// Helper function to get next index from pre-selected study images
const getNextStudyIndex = (studyIndexes, currentPosition) => {
  if (currentPosition < studyIndexes.length) {
    return studyIndexes[currentPosition];
  }
  return null;
};*/

function App() {
  const [studyImageIndexes] = useState(() => {
    const indexes = sampleImagesForStudy();
    console.log('Selected study images:', indexes.map(i => ({
      index: i,
      fileName: imageData[i].fileName,
      ground_truth: imageData[i].ground_truth,
      caption: imageData[i].caption.substring(0, 50) + '...'
    })));
    return indexes;
  });
  const [currentPosition, setCurrentPosition] = useState(0);
  const initialItemIndex = studyImageIndexes[0];
  const [input, setInput] = useState('');
  const [prolificId, setProlificId] = useState('');
  const [messages, setMessages] = useState([]);
  const [condition, setCondition] = useState(1);
  const [currentItem, setCurrentItem] = useState(initialItemIndex);
  const [image, setImage] = useState(imageData[initialItemIndex]);
  const [showFinalRating, setShowFinalRating] = useState(false);
  /*const [finalRating, setFinalRating] = useState('');
  const [finalResponse, setFinalResponse] = useState('');
  const [canProceed, setCanProceed] = useState(false);*/
  const [isGenerating, setIsGenerating] = useState(false);
  const [seenBefore, setSeenBefore] = useState(null);
  const [initialBelief, setInitialBelief] = useState('');
  const [initialConfidence, setInitialConfidence] = useState(50);
  const [hasMovedSlider, setHasMovedSlider] = useState(false);
  const [showMainPrompt, setShowMainPrompt] = useState(false);
  const [selectedButton, setSelectedButton] = useState(null);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [hasAnsweredSeenBefore, setHasAnsweredSeenBefore] = useState(false); // NEW STATE
  const [hasAnsweredInitialRating, setHasAnsweredInitialRating] = useState(false);
  // Final rating UI state variables (same as initial rating)
  const [finalSelectedButton, setFinalSelectedButton] = useState(null);
  const [finalConfidence, setFinalConfidence] = useState(50);
  const [finalHasMovedSlider, setFinalHasMovedSlider] = useState(false);
  const chatBodyRef = useRef(null);
  // Add this with your other useState declarations:
  const [isSubmittingFinal, setIsSubmittingFinal] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conditionParam = params.get('condition');
    const userIdParam = params.get('PROLIFIC_PID');
    if (conditionParam !== null) {
      setCondition(conditionParam);
    }
    if (userIdParam !== null) {
      setProlificId(userIdParam);
    }
  }, []);

  useEffect(() => {
    setImage(imageData[currentItem]);
    setMessages([]);
    setShowFinalRating(false);
    // setFinalRating('');
    // setFinalResponse('');
    // setCanProceed(false);
    setIsSubmittingFinal(false);
    setSeenBefore(null);
    setInitialBelief('');
    setInitialConfidence(50);
    setHasMovedSlider(false);
    setShowMainPrompt(false);
    setHasAnsweredSeenBefore(false); // RESET STATE
    setHasAnsweredInitialRating(false);
    setSelectedButton(null); // RESET BUTTON SELECTION
    // Reset final rating UI state
    setFinalSelectedButton(null);
    setFinalConfidence(50);
    setFinalHasMovedSlider(false);
  }, [currentItem]);

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
      
      await logToSheets({
        timestamp: new Date().toISOString(),
        participant_id: prolificId,
        condition: condition,
        imageId: currentItem,
        headline: image.caption,
        seenBefore: seenBefore ? 'Yes' : 'No',
        userResponse: `${initialBelief} ${initialConfidence}`,
        systemResponse: '',
        interactionNumber: 0,
        finalRatingSubmitted: ''
      });
      
      console.log('Setting showMainPrompt to true...');
      setShowMainPrompt(true);
      setMessages([]);
      setIsGenerating(true);
      
      try {
        // Generate initial AI response based on system prompt and user's rating
        console.log('Calling OpenAI with:', { condition, headline: image.caption, userRating: `${initialBelief} ${initialConfidence}` });
        const response = await callOpenAI([], condition, image.caption, `${initialBelief} ${initialConfidence}`);
        console.log('OpenAI response:', response);
        const botMessage = { role: "assistant", content: response };
        
        await logToSheets({
          timestamp: new Date().toISOString(),
          participant_id: prolificId,
          condition: condition,
          imageId: currentItem,
          headline: image.caption,
          seenBefore: seenBefore ? 'Yes' : 'No',
          userResponse: '',
          systemResponse: response,
          interactionNumber: 1,
          finalRatingSubmitted: ''
        });
        
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
    // Note: isSubmittingFinal will be reset in useEffect when currentItem changes
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

    const response = await callOpenAI([...messages, userMessage], condition, image.caption, `${initialBelief} ${initialConfidence}`);
    const botMessage = { role: "assistant", content: response };

    await logToSheets({
      timestamp: new Date().toISOString(),
      participant_id: prolificId,
      condition: condition,
      imageId: currentItem,
      headline: image.caption,
      seenBefore: seenBefore ? 'Yes' : 'No',
      userResponse: input,
      systemResponse: response,
      interactionNumber: messages.length,
      finalRatingSubmitted: ''
    });

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

  const handleNext = () => {
    const nextPosition = currentPosition + 1;
    if (nextPosition < studyImageIndexes.length) {
      const nextIndex = studyImageIndexes[nextPosition];
      setCurrentItem(nextIndex);
      setCurrentPosition(nextPosition);
    } else {
      // Clear all other states
      // removed setImage(null);
      setMessages([]);
      setShowFinalRating(false);
      //setFinalRating('');
      //setFinalResponse('');
      //setCanProceed(false);
      setSeenBefore(null);
      setShowMainPrompt(false);
      setShowCompletionMessage(true);
      // Reset final rating UI state
      setFinalSelectedButton(null);
      setFinalConfidence(50);
      setFinalHasMovedSlider(false);
    }
  };

  return (
    <div className="chat-container">
      
      {showCompletionMessage && (
        <div className="completion-message">
          <h2 style={{ fontSize: '24px', color: '#333' }}>The code is 3145, Please enter 3145 in the box below to proceed.</h2>
        </div>
      )}
      {!showCompletionMessage && (
        <>
          <div className="image-container">
            <img src={`imgs/${image.fileName}`} alt="Test" />
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
                <p>Please answer the question by <b>clicking on either fake or real</b> and <b>move the slider to continue</b> </p>
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
                  {isSubmittingFinal ? 'Submitting... Please wait' : (currentPosition === studyImageIndexes.length - 1 ? 'Finish →' : 'Next →')}
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
