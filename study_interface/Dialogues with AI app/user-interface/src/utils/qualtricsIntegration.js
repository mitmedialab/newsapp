// Utility for communicating with Qualtrics parent window
// Handles sending data to be stored as embedded data in Qualtrics

class QualtricsIntegration {
  constructor() {
    this.isInQualtrics = this.detectQualtrics();
    this.participantId = this.getParticipantId();
    this.setupMessageListener();
    
    console.log('Qualtrics integration initialized:', {
      isInQualtrics: this.isInQualtrics,
      participantId: this.participantId
    });
  }

  // Detect if we're running inside Qualtrics
  detectQualtrics() {
    try {
      // Check if we're in an iframe
      if (window === window.parent) return false;
      
      // Try to detect Qualtrics-specific indicators
      const urlParams = new URLSearchParams(window.location.search);
      const hasQualtricsParams = urlParams.has('Q_CHL') || 
                                urlParams.has('SID') || 
                                urlParams.has('PROLIFIC_PID') ||
                                urlParams.has('ResponseId');
      
      // Check for Qualtrics in URL or user agent
      const isQualtricsEnvironment = window.location.href.includes('qualtrics') ||
                                   document.referrer.includes('qualtrics') ||
                                   navigator.userAgent.includes('Qualtrics');
      
      // Check parent window for Qualtrics indicators (safely)
      try {
        const parentUrl = window.parent.location.href;
        const isQualtricsUrl = parentUrl.includes('qualtrics.com') || 
                              parentUrl.includes('.co1.qualtrics.com') ||
                              parentUrl.includes('survey');
        return hasQualtricsParams || isQualtricsUrl || isQualtricsEnvironment;
      } catch (e) {
        // Cross-origin restriction - likely in Qualtrics iframe
        console.log('Cross-origin detected, assuming Qualtrics environment');
        return hasQualtricsParams || isQualtricsEnvironment;
      }
    } catch (error) {
      console.warn('Error detecting Qualtrics environment:', error);
      return false;
    }
  }

  // Get participant ID from URL parameters
  getParticipantId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('PROLIFIC_PID') || 
           params.get('ResponseId') || 
           params.get('participantId') ||
           'unknown_participant';
  }

  // Set up listener for messages from Qualtrics
  setupMessageListener() {
    window.addEventListener('message', (event) => {
      try {
        if (event.data && event.data.type === 'qualtrics_response') {
          console.log('Received response from Qualtrics:', event.data);
          this.handleQualtricsResponse(event.data);
        }
      } catch (error) {
        console.error('Error handling Qualtrics message:', error);
      }
    });
  }

  // Handle responses from Qualtrics
  handleQualtricsResponse(data) {
    if (data.success) {
      console.log('Data successfully stored in Qualtrics:', data.embeddedDataKey);
    } else {
      console.error('Failed to store data in Qualtrics:', data.error);
    }
  }

  // Send data to Qualtrics to be stored as embedded data
  sendToQualtrics(dataKey, dataValue, options = {}) {
    if (!this.isInQualtrics) {
      console.warn('Not in Qualtrics environment - data not sent');
      return false;
    }

    try {
      const message = {
        type: 'store_embedded_data',
        key: dataKey,
        value: typeof dataValue === 'object' ? JSON.stringify(dataValue) : dataValue,
        participantId: this.participantId,
        timestamp: new Date().toISOString(),
        ...options
      };

      console.log('Sending data to Qualtrics:', message);
      window.parent.postMessage(message, '*');
      return true;
    } catch (error) {
      console.error('Error sending data to Qualtrics:', error);
      return false;
    }
  }

  // Send study response data (formatted for Qualtrics embedded data)
  // This method is called at the end of each item to send complete conversation data
  // allMessages contains the entire conversation history for that item
  sendStudyResponse(responseData, itemNumber, allMessages = []) {
    const embeddedDataKey = `study_item_${itemNumber}_data`;
    
    // Format data for Qualtrics storage - include complete conversation
    const qualtricsData = {
      timestamp: responseData.timestamp,
      participant_id: responseData.participant_id,
      condition: responseData.condition,
      imageId: responseData.imageId,
      headline: responseData.headline,
      seenBefore: responseData.seenBefore,
      initialUserResponse: responseData.userResponse, // Keep for backwards compatibility
      finalRatingSubmitted: responseData.finalRatingSubmitted,
      type: responseData.type || 'unknown',
      // Complete conversation history
      conversationMessages: allMessages,
      totalInteractions: allMessages.length,
      completedAt: responseData.timestamp
    };

    return this.sendToQualtrics(embeddedDataKey, qualtricsData, {
      itemNumber: itemNumber,
      dataType: 'study_response'
    });
  }

  // Send study progress data
  sendStudyProgress(progressData) {
    const progressKey = 'study_progress';
    
    const qualtricsProgress = {
      currentPosition: progressData.currentPosition,
      totalItems: progressData.totalItems || 4,
      studyImageIndexes: progressData.studyImageIndexes,
      condition: progressData.condition,
      timestamp: new Date().toISOString(),
      participantId: this.participantId
    };

    return this.sendToQualtrics(progressKey, qualtricsProgress, {
      dataType: 'progress_update'
    });
  }

  // Send completion data
  sendStudyCompletion(completionData) {
    const completionKey = 'study_completion';
    
    const qualtricsCompletion = {
      completedAt: completionData.completedAt || new Date().toISOString(),
      totalItems: completionData.totalItems,
      participantId: this.participantId,
      condition: completionData.condition,
      completionCode: completionData.completionCode || '5176',
      allResponsesCount: completionData.allResponsesCount || 0
    };

    return this.sendToQualtrics(completionKey, qualtricsCompletion, {
      dataType: 'study_completion'
    });
  }

  // Send individual interaction data (for detailed tracking)
  sendInteractionData(interactionData, itemNumber, interactionNumber) {
    const interactionKey = `item_${itemNumber}_interaction_${interactionNumber}`;
    
    const qualtricsInteraction = {
      timestamp: interactionData.timestamp,
      type: interactionData.type, // 'initialRating', 'conversation', 'finalRating', etc.
      userResponse: interactionData.userResponse,
      systemResponse: interactionData.systemResponse,
      participantId: this.participantId,
      imageId: interactionData.imageId,
      condition: interactionData.condition
    };

    return this.sendToQualtrics(interactionKey, qualtricsInteraction, {
      itemNumber: itemNumber,
      interactionNumber: interactionNumber,
      dataType: 'interaction_detail'
    });
  }

  // Bulk send all study data at completion
  sendAllStudyData(allResponsesData) {
    const bulkDataKey = 'complete_study_data';
    
    const bulkData = {
      participantId: this.participantId,
      totalResponses: allResponsesData.length,
      studyData: allResponsesData,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };

    return this.sendToQualtrics(bulkDataKey, bulkData, {
      dataType: 'bulk_export'
    });
  }

  // Get status of Qualtrics integration
  getStatus() {
    return {
      isInQualtrics: this.isInQualtrics,
      participantId: this.participantId,
      canSendData: this.isInQualtrics && window.parent !== window
    };
  }
}

// Create singleton instance
const qualtricsIntegration = new QualtricsIntegration();

export default qualtricsIntegration;

// Export utility functions
export const qualtricsUtils = {
  // Check if we can send data to Qualtrics
  canSendToQualtrics: () => qualtricsIntegration.getStatus().canSendData,
  
  // Send data with automatic fallback
  safelySendToQualtrics: (key, data, options = {}) => {
    try {
      return qualtricsIntegration.sendToQualtrics(key, data, options);
    } catch (error) {
      console.error('Error sending to Qualtrics:', error);
      return false;
    }
  },

  // Format data for Qualtrics compatibility
  formatForQualtrics: (data) => {
    // Ensure data is JSON-serializable and within Qualtrics limits
    const formatted = JSON.stringify(data);
    if (formatted.length > 20000) { // Qualtrics embedded data limit
      console.warn('Data may be too large for Qualtrics embedded data');
      // Truncate or summarize data if needed
      return JSON.stringify({
        ...data,
        truncated: true,
        originalLength: formatted.length,
        summary: 'Data truncated due to size limits'
      });
    }
    return data;
  }
};
