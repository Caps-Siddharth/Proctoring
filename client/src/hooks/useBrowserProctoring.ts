// hooks/useBrowserProctoring.ts

import { useState, useCallback, useEffect, useRef } from 'react';
import { BrowserProctoringService } from '../service/BrowserProctoringService';
import type {
  BrowserProctoringConfig,
  BrowserProctoringState,
  Violation,
  ViolationCallback,
  TerminationCallback
} from '../types/browserProctoring.types';
// import { captureSnapshotFromVideo } from '../utils/captureUtils';


interface UseBrowserProctoringOptions {
  config?: Partial<BrowserProctoringConfig>;
  onViolation?: ViolationCallback;
  onTermination?: TerminationCallback;
  onWarningLevelChange?: (level: 'none' | 'low' | 'medium' | 'high') => void;
}

interface UseBrowserProctoringReturn {
  // State
  violations: Violation[];
  violationCount: number;
  isFullscreen: boolean;
  warningLevel: 'none' | 'low' | 'medium' | 'high';
  isMonitoring: boolean;
  isTerminated: boolean;
  
  // Actions
  startMonitoring: (element?: HTMLElement) => Promise<void>;
  stopMonitoring: () => void;
  enterFullscreen: () => Promise<void>;
  clearViolations: () => void;
  captureScreenshot: (canvas: HTMLCanvasElement, video: HTMLVideoElement) => string | null;
  
  // Utilities
  getViolationsByType: (type: string) => Violation[];
  getViolationMessage: () => string;
}

export function useBrowserProctoring(options: UseBrowserProctoringOptions = {}): UseBrowserProctoringReturn {
  const [state, setState] = useState<BrowserProctoringState>({
    isMonitoring: false,
    isFullscreen: false,
    violations: [],
    violationCounts: {},
    totalViolations: 0,
    warningLevel: 'none',
    isTerminated: false
  });

  const serviceRef = useRef<BrowserProctoringService | null>(null);
  const updateIntervalRef = useRef<number | null>(null);
  const previousWarningLevelRef = useRef<'none' | 'low' | 'medium' | 'high'>('none');

  // Initialize service
  useEffect(() => {
    serviceRef.current = BrowserProctoringService.getInstance();
    
    if (options.config) {
      serviceRef.current.configure(options.config);
    }

    // Setup callbacks
    const unsubscribeViolation = options.onViolation 
      ? serviceRef.current.onViolation(options.onViolation)
      : undefined;

    const unsubscribeTermination = options.onTermination
      ? serviceRef.current.onTermination(options.onTermination)
      : undefined;

    return () => {
      unsubscribeViolation?.();
      unsubscribeTermination?.();
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, []);

  // Update state from service
  const updateState = useCallback(() => {
    if (!serviceRef.current) return;
    
    const newState = serviceRef.current.getState();
    setState(newState);

    // Check for warning level changes
    if (newState.warningLevel !== previousWarningLevelRef.current) {
      previousWarningLevelRef.current = newState.warningLevel;
      options.onWarningLevelChange?.(newState.warningLevel);
    }
  }, [options.onWarningLevelChange]);

  // Start monitoring
  const startMonitoring = useCallback(async (element?: HTMLElement) => {
    if (!serviceRef.current) return;

    try {
      await serviceRef.current.startMonitoring(element);
      
      // Start periodic state updates
      updateIntervalRef.current = window.setInterval(updateState, 100);
      updateState();
    } catch (error) {
      console.error('Failed to start browser monitoring:', error);
      throw error;
    }
  }, [updateState]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    if (!serviceRef.current) return;

    serviceRef.current.stopMonitoring();
    
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
    
    updateState();
  }, [updateState]);

  // Enter fullscreen
 const enterFullscreen = useCallback(async (element?: HTMLElement) => {
    if (!serviceRef.current) return;
    
    await serviceRef.current.enterFullscreen(element);
    updateState();
}, [updateState]);

  // Clear violations
  const clearViolations = useCallback(() => {
    if (!serviceRef.current) return;
    
    serviceRef.current.clearViolations();
    updateState();
  }, [updateState]);

  // Capture screenshot
  const captureScreenshot = useCallback((canvas: HTMLCanvasElement, video: HTMLVideoElement): string | null => {
    if (!serviceRef.current) return null;
    
    return serviceRef.current.captureScreenshot(canvas, video);
  }, []);

  // Get violations by type
  const getViolationsByType = useCallback((type: string): Violation[] => {
    return state.violations.filter(v => v.type === type);
  }, [state.violations]);

  // Get human-readable violation message
  const getViolationMessage = useCallback((): string => {
    if (state.violations.length === 0) return '';

    const recentViolations = state.violations.slice(-3);
    const messages = recentViolations.map(v => {
      switch (v.type) {
        case 'TAB_SWITCH':
          return 'Tab switching detected';
        case 'WINDOW_BLUR':
          return 'Window lost focus';
        case 'FULLSCREEN_EXIT':
          return 'Exited fullscreen mode';
        case 'RIGHT_CLICK':
          return 'Right-click attempted';
        case 'DEV_TOOLS':
          return 'Developer tools detected';
        case 'COPY_PASTE':
          return 'Copy/paste attempted';
        case 'WINDOW_RESIZE':
          return 'Window resized';
        case 'KEYBOARD_SHORTCUT':
          return 'Forbidden shortcut used';
        default:
          return 'Violation detected';
      }
    });

    return messages.join(' | ');
  }, [state.violations]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (serviceRef.current?.getState().isMonitoring) {
        serviceRef.current.stopMonitoring();
      }
    };
  }, []);

  return {
    // State
    violations: state.violations,
    violationCount: state.totalViolations,
    isFullscreen: state.isFullscreen,
    warningLevel: state.warningLevel,
    isMonitoring: state.isMonitoring,
    isTerminated: state.isTerminated,
    
    // Actions
    startMonitoring,
    stopMonitoring,
    enterFullscreen,
    clearViolations,
    captureScreenshot,
    
    // Utilities
    getViolationsByType,
    getViolationMessage
  };
}