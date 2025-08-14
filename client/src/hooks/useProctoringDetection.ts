// hooks/useProctoringDetection.ts

import { useState, useCallback, useEffect, useRef } from 'react';
import { ProctoringDetectionService } from '../service/ProctoringDetectionService';
import type { DetectionResult, CalibrationData, ProctoringConfig, FaceLandmark } from '../types/proctoring.types';
import apiService from '../service/apiService';

interface UseProctoringDetectionReturn {
  isWarning: boolean;
  detectionResult: DetectionResult | null;
  calibrationData: CalibrationData | null;
  isInitialized: boolean;
  isDetecting: boolean;
  warningMessage: string;
  setVideoElement: (video: HTMLVideoElement) => void;
  setCanvasElement: (canvas: HTMLCanvasElement) => void;

  initialize: () => Promise<void>;
  calibrate: (landmarks: FaceLandmark[], calibrationImage?: string) => CalibrationData;
  startDetection: (videoElement: HTMLVideoElement) => void;
  stopDetection: () => void;
  captureSnapshot: (videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement) => string | null;
  setConfig: (config: Partial<ProctoringConfig>) => void;
}


let lastSnapshotTime = 0;


export function useProctoringDetection(token?: string): UseProctoringDetectionReturn {
  const [isWarning, setIsWarning] = useState(false);
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);
  const [calibrationData, setCalibrationData] = useState<CalibrationData | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');

  const serviceRef = useRef<ProctoringDetectionService | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);


  const calibrate = useCallback((landmarks: FaceLandmark[], calibrationImage?: string): CalibrationData => {
    if (!serviceRef.current) {
      throw new Error('Service not initialized');
    }

    if (!token) {
      throw new Error('Token is required for calibration');
    }

    const calibData = serviceRef.current.calibrate(landmarks, token, calibrationImage);
    setCalibrationData(calibData);
    return calibData;
  }, [token]);


  const setVideoElement = (video: HTMLVideoElement) => {
    videoElementRef.current = video;
    serviceRef.current?.setVideoElement(video);
  };

  const setCanvasElement = (canvas: HTMLCanvasElement) => {
    canvasElementRef.current = canvas;
    serviceRef.current?.setCanvasElement(canvas);
  };


  const handleDetectionResult = useCallback((result: DetectionResult) => {
    setDetectionResult(result);

    // Update warning state based on detection
    const shouldWarn = result.warningLevel === 'warning' || result.warningLevel === 'caution';
    setIsWarning(shouldWarn);

    // Set warning message
    if (result.warnings.length > 0) {
      setWarningMessage(result.warnings.join(' | '));
    } else {
      setWarningMessage('');
    }

    // Auto-hide warning after a delay if behavior normalizes
    if (shouldWarn) {
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }

      if (result.warningLevel === 'caution') {
        warningTimeoutRef.current = setTimeout(() => {
          setIsWarning(false);
          setWarningMessage('');
        }, 3000);
      }
    }

    if (result.warningLevel === 'warning') {
      const now = Date.now();
      const SNAPSHOT_INTERVAL = 15000; // 15 seconds between snapshots

      if (
        videoElementRef.current &&
        canvasElementRef.current &&
        now - lastSnapshotTime > SNAPSHOT_INTERVAL
      ) {
        (async () => {
          const blob = await ProctoringDetectionService.getInstance().captureSnapshotBlob(
            videoElementRef.current!,
            canvasElementRef.current!
          );

          if (blob && token) {
            try {
              await apiService.uploadSnapshot(token, blob);
              lastSnapshotTime = now;
              console.log("📸 Snapshot uploaded");
            } catch (err) {
              console.error("❌ Snapshot upload failed:", err);
            }
          }
        })();
      }
    }


  }, []);


  const startDetection = useCallback((videoElement: HTMLVideoElement) => {
    if (!serviceRef.current || !isInitialized) {
      console.error('Service not initialized');
      return;
    }
    // ✅ Save video element reference for future snapshots
    videoElementRef.current = videoElement;

    serviceRef.current.startDetectionLoop(
      videoElement,
      handleDetectionResult,
      (error) => console.error('Detection error:', error),
      token
    );

    setIsDetecting(true);
  }, [isInitialized, handleDetectionResult, token]);


  // Initialize service on mount
  useEffect(() => {
    serviceRef.current = ProctoringDetectionService.getInstance();

    return () => {
      if (serviceRef.current && token) {
        serviceRef.current.stopDetection(token);
      }
    };
  }, [token]);

  const initialize = useCallback(async () => {
    if (!serviceRef.current || isInitialized) return;

    try {
      await serviceRef.current.initFaceLandmarker();
      setIsInitialized(true);
    } catch (error) {
      console.error('Failed to initialize proctoring:', error);
      throw error;
    }
  }, [isInitialized]);



  const stopDetection = useCallback(() => {
    if (!serviceRef.current) return;

    serviceRef.current.stopDetection(token); // Pass token
    setIsDetecting(false);
    setIsWarning(false);
    setWarningMessage('');
  }, [token]);

  const captureSnapshot = useCallback((videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement): string | null => {
    if (!serviceRef.current) return null;

    return serviceRef.current.captureSnapshot(videoElement, canvasElement);
  }, []);

  const setConfig = useCallback((config: Partial<ProctoringConfig>) => {
    if (!serviceRef.current) return;

    serviceRef.current.setConfig(config);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
  }, []);

  return {
    isWarning,
    detectionResult,
    calibrationData,
    isInitialized,
    isDetecting,
    warningMessage,

    initialize,
    calibrate,
    startDetection,
    stopDetection,
    captureSnapshot,
    setConfig,
    setVideoElement,
    setCanvasElement,
  };
}