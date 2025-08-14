// types/proctoring.types.ts

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D extends Point2D {
  z: number;
}



export interface CalibrationData {
  centerH: number;
  centerV: number;
  baselineEyeOpening: number;
  baselineHeadYaw: number;
  isCalibrated: boolean;
  tolerance: {
    h: number;
    v: number;
    eyeOpening: number;
    headYaw: number;
  };
  timestamp?: number;
  calibrationImage?: string;
}

export interface GazeData {
  leftH: number;
  rightH: number;
  leftV: number;
  rightV: number;
  avgH: number;
  avgV: number;
}

export interface HeadMovementData {
  isMoving: boolean;
  direction: 'LEFT' | 'RIGHT' | null;
  angle: number;
}

export interface MultiplePersonDetection {
  multipleDetected: boolean;
  count: number;
}

export interface DetectionResult {
  gaze: GazeData;
  headMovement: HeadMovementData;
  multipleFaces: MultiplePersonDetection;
  isLookingUp: boolean;
  warnings: string[];
  warningLevel: 'ok' | 'caution' | 'warning';
}

export interface ProctoringConfig {
  enableGazeDetection?: boolean;
  enableHeadMovement?: boolean;
  enableMultipleFaceDetection?: boolean;
  enableEyeOpeningDetection?: boolean;
  warningThreshold?: number;
  cautionThreshold?: number;
}

export interface FaceLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface FaceDetectionResult {
  faceLandmarks: FaceLandmark[][];
}