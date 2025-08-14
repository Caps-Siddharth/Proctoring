// services/ProctoringDetectionService.ts

import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type {
  CalibrationData,
  DetectionResult,
  ProctoringConfig,
  FaceLandmark,
  MultiplePersonDetection
} from '../types/proctoring.types';
import {
  detectGaze,
  detectHeadMovement,
  detectUpGaze,
  calculateBaselineEyeOpening,
  isGazeOutOfBounds
} from '../utils/detectionUtils';

export class ProctoringDetectionService {
  private static instance: ProctoringDetectionService;
  private faceLandmarker: FaceLandmarker | null = null;

  // ✅ Multi-user support: Store calibration data per token
  private calibrationDataMap: Map<string, CalibrationData> = new Map();

  // ✅ Multi-user support: Store cheating counters per token
  private cheatingCounterMap: Map<string, number> = new Map();

  private config: ProctoringConfig;
  private isInitialized: boolean = false;
  private detectionLoops: Map<string, number> = new Map(); // Multiple detection loops per user

  private constructor() {
    this.config = {
      enableGazeDetection: true,
      enableHeadMovement: true,
      enableMultipleFaceDetection: true,
      enableEyeOpeningDetection: true,
      warningThreshold: 30,
      cautionThreshold: 15
    };
  }
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;

  static getInstance(): ProctoringDetectionService {
    if (!ProctoringDetectionService.instance) {
      ProctoringDetectionService.instance = new ProctoringDetectionService();
    }
    return ProctoringDetectionService.instance;
  }

  public setVideoElement(video: HTMLVideoElement) {
    this.videoElement = video;
  }
  public setCanvasElement(canvas: HTMLCanvasElement) {
    this.canvasElement = canvas;
  }

  async initFaceLandmarker(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
      );

      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numFaces: 3
      });

      this.isInitialized = true;
      console.log('Face Landmarker initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Face Landmarker:', error);
      throw error;
    }
  }

  async captureSnapshotBlob(videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement): Promise<Blob | null> {
    try {
      const context = canvasElement.getContext("2d");
      if (!context) return null;

      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;

      context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

      return new Promise((resolve) => {
        canvasElement.toBlob((blob) => {
          resolve(blob || null);
        }, "image/jpeg", 0.95);
      });
    } catch (err) {
      console.error("Snapshot capture failed:", err);
      return null;
    }
  }


  setConfig(config: Partial<ProctoringConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ✅ Get default calibration data
  private getDefaultCalibration(): CalibrationData {
    return {
      centerH: 0.5,
      centerV: 0.5,
      baselineEyeOpening: 0,
      baselineHeadYaw: 0,
      isCalibrated: false,
      tolerance: {
        h: 0.15,
        v: 0.15,
        eyeOpening: 0.25,
        headYaw: 15
      }
    };
  }

  // ✅ Get calibration data for specific user
  getCalibrationData(token?: string): CalibrationData | null {
    if (!token) return this.getDefaultCalibration();
    return this.calibrationDataMap.get(token) || null;
  }

  // ✅ Get all calibration data (for debugging)
  getAllCalibrations(): Map<string, CalibrationData> {
    return new Map(this.calibrationDataMap);
  }

  // ✅ Calibrate for specific user
  calibrate(landmarks: FaceLandmark[], token: string, calibrationImage?: string): CalibrationData {
    if (!token) {
      throw new Error('Token is required for calibration');
    }

    const gaze = detectGaze(landmarks);
    const baselineEyeOpening = calculateBaselineEyeOpening(landmarks);

    // Use default calibration for head movement calculation during calibration
    const tempCalibration = this.getDefaultCalibration();
    const headMovement = detectHeadMovement(landmarks, tempCalibration);

    const calibrationData: CalibrationData = {
      centerH: gaze.avgH,
      centerV: gaze.avgV,
      baselineEyeOpening: baselineEyeOpening,
      baselineHeadYaw: headMovement.angle,
      isCalibrated: true,
      timestamp: Date.now(),
      calibrationImage: calibrationImage,
      tolerance: {
        h: 0.15,
        v: 0.15,
        eyeOpening: 0.25,
        headYaw: 15
      }
    };

    // Store calibration for this specific user
    this.calibrationDataMap.set(token, calibrationData);

    // Initialize cheating counter for this user
    this.cheatingCounterMap.set(token, 0);

    console.log(`✅ Calibration stored for token: ${token}`, {
      gazeCenter: { h: gaze.avgH.toFixed(3), v: gaze.avgV.toFixed(3) },
      baselineEyeOpening: baselineEyeOpening.toFixed(4),
      baselineHeadYaw: headMovement.angle.toFixed(2) + '°'
    });

    return calibrationData;
  }

  // ✅ Clear calibration for a user (useful for retry)
  clearCalibration(token: string): void {
    this.calibrationDataMap.delete(token);
    this.cheatingCounterMap.delete(token);
    console.log(`🗑️ Calibration cleared for token: ${token}`);
  }

  // ✅ Detect from video for specific user
  async detectFromVideo(video: HTMLVideoElement, timestamp: number, token?: string): Promise<DetectionResult | null> {
    if (!this.faceLandmarker || !video || video.readyState < 2) {
      return null;
    }

    try {
      const results = await this.faceLandmarker.detectForVideo(video, timestamp);
      return this.processDetectionResults(results, token);
    } catch (error) {
      console.error('Detection error:', error);
      return null;
    }
  }

  // ✅ Process detection results for specific user
  private processDetectionResults(results: FaceLandmarkerResult, token?: string): DetectionResult | null {
    // Get user-specific calibration or use default
    const calibrationData = token
      ? this.calibrationDataMap.get(token) || this.getDefaultCalibration()
      : this.getDefaultCalibration();

    const warnings: string[] = [];

    // Check for multiple faces
    const multipleFaces = this.detectMultipleFaces(results);
    if (this.config.enableMultipleFaceDetection && multipleFaces.multipleDetected) {
      warnings.push(`${multipleFaces.count} people detected`);
    }

    // Handle no face detected
    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
      return {
        gaze: { leftH: 0, rightH: 0, leftV: 0, rightV: 0, avgH: 0, avgV: 0 },
        headMovement: { isMoving: false, direction: null, angle: 0 },
        multipleFaces,
        isLookingUp: false,
        warnings: ['No face detected'],
        warningLevel: 'warning'
      };
    }

    const landmarks = results.faceLandmarks[0] as FaceLandmark[];

    // Detect gaze
    const gaze = detectGaze(landmarks);
    if (this.config.enableGazeDetection && calibrationData.isCalibrated) {
      const gazeCheck = isGazeOutOfBounds(gaze, calibrationData);
      if (gazeCheck.isOut) {
        warnings.push(`Looking ${gazeCheck.direction.join(' ')}`);
      }
    }

    // Detect head movement
    const headMovement = detectHeadMovement(landmarks, calibrationData);
    if (this.config.enableHeadMovement && headMovement.isMoving) {
      warnings.push(`Head turned ${headMovement.direction}`);
    }

    // Detect up gaze (eye opening)
    const isLookingUp = this.config.enableEyeOpeningDetection
      ? detectUpGaze(landmarks, calibrationData)
      : false;
    if (isLookingUp) {
      warnings.push('Looking UP (eyelid)');
    }

    // Update user-specific cheating counter
    let cheatingCounter = token ? (this.cheatingCounterMap.get(token) || 0) : 0;

    if (warnings.length > 0) {
      cheatingCounter = Math.min(cheatingCounter + 2, 60);
    } else {
      cheatingCounter = Math.max(cheatingCounter - 3, 0);
    }

    if (token) {
      this.cheatingCounterMap.set(token, cheatingCounter);
    }

    // Determine warning level
    let warningLevel: 'ok' | 'caution' | 'warning' = 'ok';
    if (cheatingCounter > this.config.warningThreshold!) {
      warningLevel = 'warning';
    } else if (cheatingCounter > this.config.cautionThreshold!) {
      warningLevel = 'caution';
    }

    return {
      gaze,
      headMovement,
      multipleFaces,
      isLookingUp,
      warnings,
      warningLevel
    };
  }

  private detectMultipleFaces(results: FaceLandmarkerResult): MultiplePersonDetection {
    const faceCount = results.faceLandmarks?.length || 0;
    return {
      multipleDetected: faceCount > 1,
      count: faceCount
    };
  }

  // ✅ Start detection loop for specific user
  startDetectionLoop(
    video: HTMLVideoElement,
    onDetection: (result: DetectionResult) => void,
    onError?: (error: Error) => void,
    token?: string
  ): void {
    // If token provided, stop existing loop for this user
    if (token && this.detectionLoops.has(token)) {
      const existingLoop = this.detectionLoops.get(token);
      if (existingLoop !== undefined) {
        cancelAnimationFrame(existingLoop);
      }
    }

    let lastVideoTime = -1;

    const detect = async () => {
      try {
        if (video.currentTime === lastVideoTime) {
          const loopId = requestAnimationFrame(detect);
          if (token) {
            this.detectionLoops.set(token, loopId);
          }
          return;
        }

        lastVideoTime = video.currentTime;
        const timestamp = performance.now();
        const result = await this.detectFromVideo(video, timestamp, token);

        if (result) {
          onDetection(result);
        }

        const loopId = requestAnimationFrame(detect);
        if (token) {
          this.detectionLoops.set(token, loopId);
        }
      } catch (error) {
        if (onError) {
          onError(error as Error);
        }
        console.error('Detection loop error:', error);
      }
    };

    const loopId = requestAnimationFrame(detect);
    if (token) {
      this.detectionLoops.set(token, loopId);
    }
  }

  // ✅ Stop detection for specific user or all users
  stopDetection(token?: string): void {
    if (token) {
      // Stop detection for specific user
      const loopId = this.detectionLoops.get(token);
      if (loopId !== undefined) {
        cancelAnimationFrame(loopId);
        this.detectionLoops.delete(token);
      }
      // Reset cheating counter for this user
      this.cheatingCounterMap.set(token, 0);
      console.log(`🛑 Detection stopped for token: ${token}`);
    } else {
      // Stop all detection loops
      this.detectionLoops.forEach((loopId) => {
        cancelAnimationFrame(loopId);
      });
      this.detectionLoops.clear();
      // Reset all cheating counters
      this.cheatingCounterMap.clear();
      console.log('🛑 All detection loops stopped');
    }
  }

  // ✅ Check if detection is running for a user
  isDetecting(token?: string): boolean {
    if (token) {
      return this.detectionLoops.has(token);
    }
    return this.detectionLoops.size > 0;
  }

  // ✅ Get statistics for a user
  getUserStats(token: string): {
    isCalibrated: boolean;
    cheatingCounter: number;
    hasActiveDetection: boolean;
  } | null {
    const calibration = this.calibrationDataMap.get(token);
    if (!calibration) return null;

    return {
      isCalibrated: calibration.isCalibrated,
      cheatingCounter: this.cheatingCounterMap.get(token) || 0,
      hasActiveDetection: this.detectionLoops.has(token)
    };
  }

  captureSnapshot(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
    if (!video || !canvas) return null;

    const context = canvas.getContext('2d');
    if (!context) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.8);
  }

  // ✅ Cleanup for specific user
  cleanupUser(token: string): void {
    this.stopDetection(token);
    this.calibrationDataMap.delete(token);
    this.cheatingCounterMap.delete(token);
    console.log(`🧹 Cleaned up all data for token: ${token}`);
  }

  destroy(): void {
    // Stop all detection loops
    this.stopDetection();

    // Clear all user data
    this.calibrationDataMap.clear();
    this.cheatingCounterMap.clear();

    // Close face landmarker
    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }

    this.isInitialized = false;
    console.log('💥 ProctoringDetectionService destroyed');
  }
}