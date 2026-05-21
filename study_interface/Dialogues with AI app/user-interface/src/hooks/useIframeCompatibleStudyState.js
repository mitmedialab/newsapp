import { useState, useEffect, useCallback } from 'react';
import iframeStorage, { storageUtils } from '../utils/storageUtils';

// Custom hook for iframe-compatible study state management
export const useIframeCompatibleStudyState = (imageData) => {
  // Helper function to get URL parameters
  const getUrlParams = useCallback(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return {
      prolificId: urlParams.get('PROLIFIC_PID') || urlParams.get('prolificId') || '',
      condition: parseInt(urlParams.get('condition') || '1'),
      studyImageIndexes: urlParams.get('studyImageIndexes') ? 
        JSON.parse(decodeURIComponent(urlParams.get('studyImageIndexes'))) : null,
      currentPosition: urlParams.get('currentPosition') ? 
        parseInt(urlParams.get('currentPosition')) : null,
      seed: urlParams.get('seed') || null
    };
  }, []);

  // Initialize state with potential recovery from storage or URL
  const [studyState, setStudyState] = useState(() => {
    const urlParams = getUrlParams();
    const savedProgress = iframeStorage.loadStudyProgress();
    
    // Priority: URL params > saved progress > defaults
    if (urlParams.studyImageIndexes) {
      console.log('Using study parameters from URL:', urlParams);
      return {
        studyImageIndexes: urlParams.studyImageIndexes,
        currentPosition: urlParams.currentPosition || 0,
        prolificId: urlParams.prolificId,
        condition: urlParams.condition,
        isRecovered: urlParams.currentPosition > 0
      };
    }
    
    if (savedProgress && savedProgress.studyImageIndexes) {
      console.log('Recovered study progress from storage:', savedProgress);
      return {
        studyImageIndexes: savedProgress.studyImageIndexes,
        currentPosition: savedProgress.currentPosition || 0,
        prolificId: savedProgress.prolificId || urlParams.prolificId,
        condition: savedProgress.condition || urlParams.condition,
        isRecovered: true
      };
    }
    
    console.log('Starting fresh study with URL params:', urlParams);
    return {
      studyImageIndexes: null,
      currentPosition: 0,
      prolificId: urlParams.prolificId,
      condition: urlParams.condition,
      isRecovered: false,
      seed: urlParams.seed
    };
  });

  // State for current item and UI
  const [currentItem, setCurrentItem] = useState(null);
  const [image, setImage] = useState(null);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);

  // Helper function to sample images for study with optional seed
  const sampleImagesForStudy = useCallback((seed = null) => {
    const realImages = [];
    const fakeImages = [];
    
    imageData.forEach((item, index) => {
      if (item.ground_truth === 0) {
        realImages.push(index);
      } else if (item.ground_truth === 1) {
        fakeImages.push(index);
      }
    });
    
    // Seeded random function for consistent results
    let seedValue = seed ? parseInt(seed) : Math.floor(Math.random() * 10000);
    const seededRandom = () => {
      seedValue = (seedValue * 9301 + 49297) % 233280;
      return seedValue / 233280;
    };
    
    const shuffledReal = realImages.sort(() => seededRandom() - 0.5);
    const shuffledFake = fakeImages.sort(() => seededRandom() - 0.5);
    
    const selectedReal = shuffledReal.slice(0, 2);
    const selectedFake = shuffledFake.slice(0, 2);
    
    const studyImages = [...selectedReal, ...selectedFake].sort(() => seededRandom() - 0.5);
    
    console.log('Generated study images with seed:', seedValue, 'Images:', studyImages);
    return studyImages;
  }, [imageData]);

  // Initialize study on first load or create new study
  useEffect(() => {
    if (!studyState.studyImageIndexes) {
      const indexes = sampleImagesForStudy(studyState.seed);
      const newState = {
        ...studyState,
        studyImageIndexes: indexes,
        isRecovered: false
      };
      
      setStudyState(newState);
      
      // Save initial state
      iframeStorage.saveStudyProgress(newState);
      
      console.log('Created new study with images:', indexes.map(i => ({
        index: i,
        fileName: imageData[i].fileName,
        ground_truth: imageData[i].ground_truth,
        caption: imageData[i].caption.substring(0, 50) + '...'
      })));
    }
  }, [studyState.studyImageIndexes, sampleImagesForStudy, studyState, imageData]);

  // Update current item when state changes
  useEffect(() => {
    if (studyState.studyImageIndexes && studyState.studyImageIndexes.length > 0) {
      const itemIndex = studyState.studyImageIndexes[studyState.currentPosition];
      setCurrentItem(itemIndex);
      setImage(imageData[itemIndex]);
    }
  }, [studyState.studyImageIndexes, studyState.currentPosition, imageData]);

  // Get URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conditionParam = params.get('condition');
    const userIdParam = params.get('PROLIFIC_PID') || params.get('prolificId');
    
    if (conditionParam !== null || userIdParam !== null) {
      setStudyState(prev => {
        const updated = {
          ...prev,
          condition: conditionParam ? parseInt(conditionParam) : prev.condition,
          prolificId: userIdParam || prev.prolificId
        };
        
        // Save updated state
        iframeStorage.saveStudyProgress(updated);
        return updated;
      });
    }
  }, []);

  // Get all responses for export/debugging
  const getAllResponses = useCallback(() => {
    return iframeStorage.getData('allResponses', []);
  }, []);

  // Safe state update function with persistence
  const updateStudyState = useCallback((updates) => {
    setStudyState(prev => {
      const newState = {
        ...prev,
        ...updates,
        timestamp: new Date().toISOString()
      };
      
      // Persist state changes
      storageUtils.safeStorageOperation(() => {
        iframeStorage.saveStudyProgress(newState);
        storageUtils.sendProgressToParent(newState);
      });
      
      return newState;
    });
  }, []);

  // Navigate to next item
  const handleNext = useCallback(() => {
    const nextPosition = studyState.currentPosition + 1;
    
    if (nextPosition < studyState.studyImageIndexes.length) {
      updateStudyState({ currentPosition: nextPosition });
    } else {
      // Study completed
      setShowCompletionMessage(true);
      
      // Prepare completion data
      const completionData = {
        completedAt: new Date().toISOString(),
        totalItems: studyState.studyImageIndexes.length,
        prolificId: studyState.prolificId,
        condition: studyState.condition,
        completionCode: '5176',
        allResponsesCount: getAllResponses().length
      };
      
      // Log completion
      storageUtils.safeStorageOperation(() => {
        iframeStorage.setData('studyCompleted', completionData);
        
        // Send completion to parent window
        storageUtils.sendProgressToParent({
          type: 'studyCompleted',
          ...completionData
        });

        // Send completion to Qualtrics
        storageUtils.sendCompletionToQualtrics(completionData);
        
        // Send all study data to Qualtrics as bulk export
        const allResponses = getAllResponses();
        if (allResponses.length > 0) {
          storageUtils.sendAllDataToQualtrics(allResponses);
        }
      });
    }
  }, [studyState.currentPosition, studyState.studyImageIndexes, studyState.prolificId, studyState.condition, updateStudyState, getAllResponses]);

  // Get iframe-safe user ID
  const getIframeSafeUserId = useCallback(() => {
    return storageUtils.getIframeSafeUserId();
  }, []);

  // Save item response data
  const saveItemResponse = useCallback((responseData, allMessages = []) => {
    const itemResponseKey = `item_${currentItem}_response`;
    const dataToSave = {
      ...responseData,
      currentItem,
      currentPosition: studyState.currentPosition,
      timestamp: new Date().toISOString(),
      prolificId: studyState.prolificId,
      condition: studyState.condition
    };
    
    storageUtils.safeStorageOperation(() => {
      iframeStorage.setData(itemResponseKey, dataToSave);
      
      // Also maintain a list of all responses
      const allResponses = iframeStorage.getData('allResponses', []);
      allResponses.push(dataToSave);
      iframeStorage.setData('allResponses', allResponses);
      
      // Send to parent window
      storageUtils.sendProgressToParent({
        type: 'itemResponse',
        data: dataToSave
      });

      // Send to Qualtrics - include all messages if this is a final rating (item completion)
      const itemNumber = studyState.currentPosition + 1;
      if (responseData.type === 'finalRating') {
        // This is the end of the item, send complete conversation data
        storageUtils.sendResponseToQualtrics(dataToSave, itemNumber, allMessages);
      } else {
        // Regular interaction, send without full messages for now
        storageUtils.sendResponseToQualtrics(dataToSave, itemNumber);
      }
      
      // Remove individual interaction sending since we're sending complete data at the end
      // if (responseData.type && responseData.interactionNumber !== undefined) {
      //   storageUtils.sendInteractionToQualtrics(
      //     dataToSave, 
      //     itemNumber, 
      //     responseData.interactionNumber
      //   );
      // }
    });
    
    return dataToSave;
  }, [currentItem, studyState.currentPosition, studyState.prolificId, studyState.condition]);

  // Clear all study data (for reset)
  const clearStudyData = useCallback(() => {
    iframeStorage.clearAll();
    setStudyState({
      studyImageIndexes: null,
      currentPosition: 0,
      prolificId: '',
      condition: 1,
      isRecovered: false
    });
    setCurrentItem(null);
    setImage(null);
    setShowCompletionMessage(false);
  }, []);

  // Get storage debug info
  const getStorageInfo = useCallback(() => {
    return {
      ...iframeStorage.getStorageInfo(),
      currentState: studyState,
      currentItem,
      allResponses: getAllResponses()
    };
  }, [studyState, currentItem, getAllResponses]);

  return {
    // Core state
    studyImageIndexes: studyState.studyImageIndexes,
    currentPosition: studyState.currentPosition,
    currentItem,
    image,
    prolificId: studyState.prolificId,
    condition: studyState.condition,
    showCompletionMessage,
    isRecovered: studyState.isRecovered,
    
    // State update functions
    updateStudyState,
    handleNext,
    
    // Utility functions
    getIframeSafeUserId,
    saveItemResponse,
    getAllResponses,
    clearStudyData,
    getStorageInfo,
    
    // Storage utilities
    isRestrictedEnvironment: storageUtils.isRestrictedEnvironment(),
    storageInfo: iframeStorage.getStorageInfo(),
    qualtricsStatus: storageUtils.getQualtricsStatus()
  };
};
