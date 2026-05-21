import qualtricsIntegration, { qualtricsUtils } from './qualtricsIntegration';

// Storage utility for iframe-compatible data persistence
// Handles cross-origin restrictions when embedded in Qualtrics surveys

class IframeCompatibleStorage {
  constructor() {
    this.storagePrefix = 'study_app_'; // Namespace to avoid conflicts
    this.storageAvailable = this.testStorageAvailability();
    this.fallbackStorage = new Map();
    this.sessionId = this.generateSessionId();
    
    // Test if we're in an iframe
    this.isInIframe = window !== window.parent;
    
    console.log('Storage availability:', {
      localStorage: this.storageAvailable.localStorage,
      sessionStorage: this.storageAvailable.sessionStorage,
      isInIframe: this.isInIframe,
      sessionId: this.sessionId
    });
  }

  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  testStorageAvailability() {
    const test = this.storagePrefix + 'test_storage_availability';
    const results = {
      localStorage: false,
      sessionStorage: false
    };

    // Test localStorage with error handling
    try {
      if (typeof Storage !== 'undefined' && localStorage) {
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        results.localStorage = true;
      }
    } catch (e) {
      console.warn('localStorage not available:', e.message);
      results.localStorage = false;
    }

    // Test sessionStorage with error handling
    try {
      if (typeof Storage !== 'undefined' && sessionStorage) {
        sessionStorage.setItem(test, test);
        sessionStorage.removeItem(test);
        results.sessionStorage = true;
      }
    } catch (e) {
      console.warn('sessionStorage not available:', e.message);
      results.sessionStorage = false;
    }

    return results;
  }

  // Get storage key with namespace prefix to avoid conflicts
  getStorageKey(key) {
    return `${this.storagePrefix}${this.sessionId}_${key}`;
  }

  // Set data with multiple fallback strategies and error handling
  setData(key, value) {
    const storageKey = this.getStorageKey(key);
    
    try {
      const serializedValue = JSON.stringify(value);

      // Strategy 1: Try localStorage first
      if (this.storageAvailable.localStorage) {
        try {
          localStorage.setItem(storageKey, serializedValue);
          console.log('Data saved to localStorage:', key);
          return true;
        } catch (e) {
          console.warn('localStorage write failed:', e.message);
        }
      }

      // Strategy 2: Try sessionStorage
      if (this.storageAvailable.sessionStorage) {
        try {
          sessionStorage.setItem(storageKey, serializedValue);
          console.log('Data saved to sessionStorage:', key);
          return true;
        } catch (e) {
          console.warn('sessionStorage write failed:', e.message);
        }
      }

      // Strategy 3: Use in-memory fallback
      this.fallbackStorage.set(key, value);
      console.log('Data saved to fallback storage:', key);
      
      // Strategy 4: Try to communicate with parent window (Qualtrics)
      this.notifyParentWindow('storageSet', { key, value });
      
      return true;
    } catch (error) {
      console.error('Error saving data:', error);
      
      // Last resort: in-memory storage
      this.fallbackStorage.set(key, value);
      return false;
    }
  }

  // Get data with fallback strategies and error handling
  getData(key, defaultValue = null) {
    const storageKey = this.getStorageKey(key);

    try {
      // Strategy 1: Try localStorage first
      if (this.storageAvailable.localStorage) {
        try {
          const stored = localStorage.getItem(storageKey);
          if (stored !== null) {
            return JSON.parse(stored);
          }
        } catch (e) {
          console.warn('localStorage read failed:', e.message);
        }
      }

      // Strategy 2: Try sessionStorage
      if (this.storageAvailable.sessionStorage) {
        try {
          const stored = sessionStorage.getItem(storageKey);
          if (stored !== null) {
            return JSON.parse(stored);
          }
        } catch (e) {
          console.warn('sessionStorage read failed:', e.message);
        }
      }

      // Strategy 3: Check in-memory fallback
      if (this.fallbackStorage.has(key)) {
        return this.fallbackStorage.get(key);
      }

      // Strategy 4: Try to get from URL parameters
      const urlValue = this.getFromUrlParams(key);
      if (urlValue !== null) {
        return urlValue;
      }

      return defaultValue;
    } catch (error) {
      console.error('Error retrieving data:', error);
      return defaultValue;
    }
  }

  // Remove data from all storage locations
  removeData(key) {
    const storageKey = this.getStorageKey(key);

    try {
      if (this.storageAvailable.localStorage) {
        localStorage.removeItem(storageKey);
      }
      if (this.storageAvailable.sessionStorage) {
        sessionStorage.removeItem(storageKey);
      }
      this.fallbackStorage.delete(key);
      
      this.notifyParentWindow('storageRemove', { key });
    } catch (error) {
      console.error('Error removing data:', error);
    }
  }

  // Clear all data
  clearAll() {
    try {
      // Clear from browser storage
      if (this.storageAvailable.localStorage) {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith(`iframe_study_${this.sessionId}_`)) {
            localStorage.removeItem(key);
          }
        });
      }
      
      if (this.storageAvailable.sessionStorage) {
        const keys = Object.keys(sessionStorage);
        keys.forEach(key => {
          if (key.startsWith(`iframe_study_${this.sessionId}_`)) {
            sessionStorage.removeItem(key);
          }
        });
      }

      // Clear fallback storage
      this.fallbackStorage.clear();
      
      this.notifyParentWindow('storageClear', {});
    } catch (error) {
      console.error('Error clearing data:', error);
    }
  }

  // Get value from URL parameters
  getFromUrlParams(key) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const value = urlParams.get(key);
      if (value !== null) {
        try {
          return JSON.parse(decodeURIComponent(value));
        } catch {
          return value; // Return as string if not JSON
        }
      }
      return null;
    } catch (error) {
      console.error('Error reading URL params:', error);
      return null;
    }
  }

  // Update URL with current state (for persistence across reloads)
  updateUrlWithState(stateData) {
    if (!this.isInIframe) {
      try {
        const url = new URL(window.location);
        Object.entries(stateData).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            url.searchParams.set(key, encodeURIComponent(JSON.stringify(value)));
          }
        });
        window.history.replaceState({}, '', url);
      } catch (error) {
        console.error('Error updating URL:', error);
      }
    }
  }

  // Communicate with parent window (Qualtrics)
  notifyParentWindow(action, data) {
    if (this.isInIframe) {
      try {
        window.parent.postMessage({
          type: 'iframe_study_storage',
          action: action,
          data: data,
          sessionId: this.sessionId
        }, '*');
      } catch (error) {
        console.error('Error communicating with parent window:', error);
      }
    }
  }

  // Listen for messages from parent window
  listenToParentWindow() {
    if (this.isInIframe) {
      window.addEventListener('message', (event) => {
        try {
          if (event.data.type === 'iframe_study_storage_response' && 
              event.data.sessionId === this.sessionId) {
            console.log('Received data from parent:', event.data);
            // Handle responses from parent if needed
          }
        } catch (error) {
          console.error('Error handling parent window message:', error);
        }
      });
    }
  }

  // Get storage info for debugging
  getStorageInfo() {
    return {
      storageAvailable: this.storageAvailable,
      isInIframe: this.isInIframe,
      sessionId: this.sessionId,
      fallbackStorageSize: this.fallbackStorage.size,
      currentUrl: window.location.href
    };
  }

  // Method to save study progress
  saveStudyProgress(data) {
    const progressData = {
      ...data,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId
    };
    
    this.setData('studyProgress', progressData);
    
    // Also update URL for additional persistence
    this.updateUrlWithState({
      currentPosition: data.currentPosition,
      studyImageIndexes: data.studyImageIndexes,
      prolificId: data.prolificId,
      condition: data.condition
    });
    
    // Send progress to Qualtrics if available
    if (qualtricsUtils.canSendToQualtrics()) {
      qualtricsIntegration.sendStudyProgress({
        currentPosition: data.currentPosition,
        totalItems: data.studyImageIndexes ? data.studyImageIndexes.length : 4,
        studyImageIndexes: data.studyImageIndexes,
        condition: data.condition
      });
    }
    
    return progressData;
  }

  // Method to load study progress
  loadStudyProgress() {
    const progress = this.getData('studyProgress');
    if (progress) {
      console.log('Loaded study progress:', progress);
      return progress;
    }
    
    // Try to reconstruct from URL params if no stored progress
    const urlProgress = {
      currentPosition: this.getFromUrlParams('currentPosition'),
      studyImageIndexes: this.getFromUrlParams('studyImageIndexes'),
      prolificId: this.getFromUrlParams('prolificId'),
      condition: this.getFromUrlParams('condition')
    };
    
    if (urlProgress.currentPosition !== null) {
      console.log('Reconstructed progress from URL:', urlProgress);
      return urlProgress;
    }
    
    return null;
  }
}

// Create and export a singleton instance
const iframeStorage = new IframeCompatibleStorage();
iframeStorage.listenToParentWindow();

export default iframeStorage;

// Export additional utilities
export const storageUtils = {
  // Utility to check if we're in a restricted iframe environment
  isRestrictedEnvironment: () => {
    return iframeStorage.isInIframe && 
           !iframeStorage.storageAvailable.localStorage && 
           !iframeStorage.storageAvailable.sessionStorage;
  },

  // Utility to get iframe-safe user ID
  getIframeSafeUserId: () => {
    // Try to get from URL params first (most reliable in iframe)
    const urlUserId = iframeStorage.getFromUrlParams('PROLIFIC_PID') || 
                     iframeStorage.getFromUrlParams('prolificId') ||
                     iframeStorage.getFromUrlParams('userId');
    
    if (urlUserId) return urlUserId;
    
    // Fallback to stored or generated ID
    let userId = iframeStorage.getData('userId');
    if (!userId) {
      userId = 'iframe_user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      iframeStorage.setData('userId', userId);
    }
    
    return userId;
  },

  // Utility to handle cross-origin communication
  sendProgressToParent: (progressData) => {
    iframeStorage.notifyParentWindow('studyProgress', progressData);
    
    // Also send to Qualtrics if available
    if (qualtricsUtils.canSendToQualtrics()) {
      qualtricsIntegration.sendStudyProgress(progressData);
    }
  },

  // Send study response to Qualtrics
  sendResponseToQualtrics: (responseData, itemNumber, allMessages = []) => {
    if (qualtricsUtils.canSendToQualtrics()) {
      return qualtricsIntegration.sendStudyResponse(responseData, itemNumber, allMessages);
    }
    return false;
  },

  // Send interaction data to Qualtrics
  sendInteractionToQualtrics: (interactionData, itemNumber, interactionNumber) => {
    if (qualtricsUtils.canSendToQualtrics()) {
      return qualtricsIntegration.sendInteractionData(interactionData, itemNumber, interactionNumber);
    }
    return false;
  },

  // Send completion data to Qualtrics
  sendCompletionToQualtrics: (completionData) => {
    if (qualtricsUtils.canSendToQualtrics()) {
      return qualtricsIntegration.sendStudyCompletion(completionData);
    }
    return false;
  },

  // Send all study data to Qualtrics at completion
  sendAllDataToQualtrics: (allResponsesData) => {
    if (qualtricsUtils.canSendToQualtrics()) {
      return qualtricsIntegration.sendAllStudyData(allResponsesData);
    }
    return false;
  },

  // Get Qualtrics integration status
  getQualtricsStatus: () => {
    return qualtricsIntegration.getStatus();
  },

  // Utility to handle storage errors gracefully
  safeStorageOperation: (operation, fallback = null) => {
    try {
      return operation();
    } catch (error) {
      console.error('Storage operation failed:', error);
      return fallback;
    }
  }
};
