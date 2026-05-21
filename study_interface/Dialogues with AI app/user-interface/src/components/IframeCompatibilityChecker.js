import React, { useEffect, useState } from 'react';

const IframeCompatibilityChecker = ({ children }) => {
  const [compatibilityInfo, setCompatibilityInfo] = useState({
    isInIframe: false,
    hasStorageAccess: false,
    canAccessParent: false,
    isRestrictedSandbox: false,
    showWarning: false
  });

  useEffect(() => {
    const checkCompatibility = async () => {
      const info = {
        isInIframe: window !== window.parent,
        hasStorageAccess: false,
        canAccessParent: false,
        isRestrictedSandbox: false,
        showWarning: false
      };

      // Test storage access
      try {
        localStorage.setItem('test', 'test');
        localStorage.removeItem('test');
        info.hasStorageAccess = true;
      } catch (e) {
        console.warn('localStorage not accessible:', e.message);
      }

      // Test parent window access
      try {
        if (info.isInIframe) {
          // Try to access parent window (we don't need to use the result)
          window.parent.location.origin; // eslint-disable-line no-unused-expressions
          info.canAccessParent = true;
        }
      } catch (e) {
        console.warn('Parent window access restricted:', e.message);
      }

      // Check for sandboxing restrictions
      try {
        if (info.isInIframe && !info.hasStorageAccess) {
          info.isRestrictedSandbox = true;
        }
      } catch (e) {
        console.warn('Sandbox detection failed:', e.message);
      }

      // Determine if we should show a warning
      info.showWarning = info.isInIframe && (!info.hasStorageAccess || info.isRestrictedSandbox);

      setCompatibilityInfo(info);

      // Log compatibility info
      console.log('Iframe compatibility check:', info);

      // Send compatibility info to parent if possible
      if (info.isInIframe) {
        try {
          window.parent.postMessage({
            type: 'iframe_compatibility_check',
            data: info,
            timestamp: new Date().toISOString()
          }, '*');
        } catch (e) {
          console.warn('Could not communicate compatibility info to parent:', e.message);
        }
      }
    };

    checkCompatibility();

    // Listen for storage events that might indicate cross-origin issues
    const handleStorageError = (event) => {
      console.warn('Storage event detected:', event);
      setCompatibilityInfo(prev => ({
        ...prev,
        showWarning: true
      }));
    };

    window.addEventListener('error', handleStorageError);
    
    return () => {
      window.removeEventListener('error', handleStorageError);
    };
  }, []);

  // Render warning message if needed
  const renderCompatibilityWarning = () => {
    if (!compatibilityInfo.showWarning) return null;

    return (
      <div className="restricted-environment-notice">
        <strong>Notice:</strong> This survey is running in a restricted environment. 
        Your progress is being saved using alternative methods. 
        Please complete the survey in one session if possible.
        {!compatibilityInfo.hasStorageAccess && (
          <div style={{ marginTop: '5px', fontSize: '12px' }}>
            (Browser storage is not available - using fallback storage)
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {renderCompatibilityWarning()}
      {children}
    </>
  );
};

export default IframeCompatibilityChecker;
