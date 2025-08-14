// hooks/useAntiBacktrack.ts
import { useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { message } from 'antd';

interface AntiBacktrackOptions {
  enabled: boolean;
  onBackAttempt?: () => void;
  allowedRoutes?: string[];
  terminateOnViolation?: boolean;
  maxViolations?: number;
}

let isHandlingBack = false;



export const useAntiBacktrack = (options: AntiBacktrackOptions) => {
  const navigate = useNavigate();
  const location = useLocation();
  const violationCount = useRef(0);
  const isInitialized = useRef(false);
  const currentPath = useRef(location.pathname);

  const handleBackAttempt = useCallback(() => {
    violationCount.current += 1;

    // Log the violation
    console.warn(`🚫 Back navigation attempt #${violationCount.current} detected`);

    // Show warning to user
    message.error({
      content: `⚠️ Navigation blocked! Going back is not allowed during the test. (Attempt ${violationCount.current}/${options.maxViolations || 3})`,
      duration: 4,
      key: 'backtrack-warning'
    });

    // Call custom handler if provided
    if (options.onBackAttempt) {
      options.onBackAttempt();
    }

    // Terminate test if max violations reached
    if (options.terminateOnViolation && violationCount.current >= (options.maxViolations || 3)) {
      message.error({
        content: '🛑 Test terminated due to multiple navigation violations!',
        duration: 5,
        key: 'test-terminated'
      });

      // Force navigation to termination page
      setTimeout(() => {
        navigate('/test-terminated', { replace: true });
      }, 2000);
      return;
    }

    // Force forward navigation to maintain current position
    navigate(currentPath.current, { replace: true });
  }, [navigate, options]);

  const handlePopState = (event: PopStateEvent) => {
    if (isHandlingBack) return;  // ✅ Prevent multiple simultaneous calls

    isHandlingBack = true;

    if (event.state?.blocked) {
      handleBackAttempt();
      window.history.pushState({ blocked: true }, '', window.location.href);
    }

    setTimeout(() => {
      isHandlingBack = false;
    }, 100);  // ✅ Debounce
  };

  const blockBackNavigation = useCallback(() => {
    if (!options.enabled) return;

    // Method 1: History manipulation
    const blockHistory = () => {
      // Push a dummy state to history
      window.history.pushState({ blocked: true }, '', window.location.href);

      // Listen for popstate (back/forward button)
      const handlePopState = (event: PopStateEvent) => {
        if (event.state?.blocked) {
          // User tried to go back, block it
          handleBackAttempt();
          // Push another dummy state to stay in place
          window.history.pushState({ blocked: true }, '', window.location.href);
        } else {
          // Legitimate navigation, update current path
          currentPath.current = window.location.pathname;
        }
      };

      window.addEventListener('popstate', handlePopState);

      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    };

    // Method 2: Keyboard shortcut blocking
    const blockKeyboardShortcuts = () => {
      const handleKeyDown = (event: KeyboardEvent) => {
        // Block Alt+Left (back), Alt+Right (forward)
        if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          event.stopPropagation();
          handleBackAttempt();
          return false;
        }

        // Block Backspace when not in input field
        if (event.key === 'Backspace' &&
          !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
          event.preventDefault();
          event.stopPropagation();
          handleBackAttempt();
          return false;
        }

        // Block F5 refresh
        if (event.key === 'F5') {
          event.preventDefault();
          event.stopPropagation();
          message.error('🚫 Page refresh is disabled during the test!');
          return false;
        }

        // Block Ctrl+R refresh
        if (event.ctrlKey && event.key === 'r') {
          event.preventDefault();
          event.stopPropagation();
          message.error('🚫 Page refresh is disabled during the test!');
          return false;
        }
      };

      document.addEventListener('keydown', handleKeyDown, true);

      return () => {
        document.removeEventListener('keydown', handleKeyDown, true);
      };
    };

    // Method 3: Mouse button blocking (some mice have back/forward buttons)
    const blockMouseButtons = () => {
      const handleMouseDown = (event: MouseEvent) => {
        // Block mouse back/forward buttons (button 3 and 4)
        if (event.button === 3 || event.button === 4) {
          event.preventDefault();
          event.stopPropagation();
          handleBackAttempt();
          return false;
        }
      };

      document.addEventListener('mousedown', handleMouseDown, true);

      return () => {
        document.removeEventListener('mousedown', handleMouseDown, true);
      };
    };

    // Initialize all blocking methods
    const cleanupHistory = blockHistory();
    const cleanupKeyboard = blockKeyboardShortcuts();
    const cleanupMouse = blockMouseButtons();

    return () => {
      cleanupHistory();
      cleanupKeyboard();
      cleanupMouse();
    };
  }, [options.enabled, handleBackAttempt]);

  // Route change protection
  useEffect(() => {
    if (!options.enabled) return;

    // Update current path when location changes legitimately
    currentPath.current = location.pathname;

    // Check if current route is allowed for back navigation
    const isAllowedRoute = options.allowedRoutes?.includes(location.pathname);

    if (!isAllowedRoute && isInitialized.current) {
      // This might be an unauthorized navigation
      console.log('Route change detected:', location.pathname);
    }

    isInitialized.current = true;
  }, [location.pathname, options.allowedRoutes, options.enabled]);

  // Initialize blocking when component mounts
  useEffect(() => {
    if (!options.enabled) return;

    const cleanup = blockBackNavigation();

    // Show initial warning 
    message.info({
      content: '🔒 Navigation is locked during the test for security reasons.',
      duration: 3,
      key: 'nav-locked'
    });

    return cleanup;
  }, [blockBackNavigation, options.enabled]);

  return {
    violationCount: violationCount.current,
    blockNavigation: blockBackNavigation,
    isBlocked: options.enabled
  };
};