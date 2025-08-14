// utils/detectionUtils.ts

import type { FaceLandmark, GazeData, HeadMovementData, CalibrationData } from '../types/proctoring.types';

// Landmark indices for MediaPipe Face Landmarker
const LANDMARKS = {
  LEFT_EYE_OUTER: 33,
  LEFT_EYE_INNER: 133,
  LEFT_EYE_UPPER: 159,
  LEFT_EYE_LOWER: 145,
  LEFT_IRIS: [468, 469, 470, 471],
  
  RIGHT_EYE_OUTER: 362,
  RIGHT_EYE_INNER: 263,
  RIGHT_EYE_UPPER: 386,
  RIGHT_EYE_LOWER: 374,
  RIGHT_IRIS: [473, 474, 475, 476],
  
  NOSE_TIP: 1,
  CHIN: 152
};

/**
 * Calculate center point from multiple landmarks
 */
export function getCenter(landmarks: FaceLandmark[], indices: number[]): { x: number; y: number } {
  const points = indices.map(i => landmarks[i]);
  const avgX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const avgY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return { x: avgX, y: avgY };
}

/**
 * Detect gaze direction from face landmarks
 */
export function detectGaze(landmarks: FaceLandmark[]): GazeData {
  // Get iris centers
  const leftIris = getCenter(landmarks, LANDMARKS.LEFT_IRIS);
  const rightIris = getCenter(landmarks, LANDMARKS.RIGHT_IRIS);
  
  // Get eye corners
  const leftEyeOuter = landmarks[LANDMARKS.LEFT_EYE_OUTER];
  const leftEyeInner = landmarks[LANDMARKS.LEFT_EYE_INNER];
  const leftEyeUpper = landmarks[LANDMARKS.LEFT_EYE_UPPER];
  const leftEyeLower = landmarks[LANDMARKS.LEFT_EYE_LOWER];
  
  const rightEyeOuter = landmarks[LANDMARKS.RIGHT_EYE_OUTER];
  const rightEyeInner = landmarks[LANDMARKS.RIGHT_EYE_INNER];
  const rightEyeUpper = landmarks[LANDMARKS.RIGHT_EYE_UPPER];
  const rightEyeLower = landmarks[LANDMARKS.RIGHT_EYE_LOWER];
  
  // Calculate eye dimensions
  const leftEyeWidth = Math.abs(leftEyeInner.x - leftEyeOuter.x);
  const leftEyeHeight = Math.abs(leftEyeLower.y - leftEyeUpper.y);
  const rightEyeWidth = Math.abs(rightEyeInner.x - rightEyeOuter.x);
  const rightEyeHeight = Math.abs(rightEyeLower.y - rightEyeUpper.y);
  
  // Normalize iris positions (0-1 range)
  const leftIrisH = (leftIris.x - leftEyeOuter.x) / leftEyeWidth;
  const rightIrisH = (rightIris.x - rightEyeOuter.x) / rightEyeWidth;
  const leftIrisV = (leftIris.y - leftEyeUpper.y) / leftEyeHeight;
  const rightIrisV = (rightIris.y - rightEyeUpper.y) / rightEyeHeight;
  
  return {
    leftH: leftIrisH,
    rightH: rightIrisH,
    leftV: leftIrisV,
    rightV: rightIrisV,
    avgH: (leftIrisH + rightIrisH) / 2,
    avgV: (leftIrisV + rightIrisV) / 2
  };
}

/**
 * Detect if user is looking up based on eye opening
 */
export function detectUpGaze(landmarks: FaceLandmark[], calibrationData: CalibrationData): boolean {
  if (!calibrationData.isCalibrated || calibrationData.baselineEyeOpening === 0) {
    return false;
  }
  
  const leftEyeOpening = Math.abs(landmarks[LANDMARKS.LEFT_EYE_LOWER].y - landmarks[LANDMARKS.LEFT_EYE_UPPER].y);
  const rightEyeOpening = Math.abs(landmarks[LANDMARKS.RIGHT_EYE_LOWER].y - landmarks[LANDMARKS.RIGHT_EYE_UPPER].y);
  const currentEyeOpening = (leftEyeOpening + rightEyeOpening) / 2;
  
  const openingRatio = currentEyeOpening / calibrationData.baselineEyeOpening;
  
  return openingRatio > (1 + calibrationData.tolerance.eyeOpening);
}

/**
 * Detect head movement/rotation
 */
export function detectHeadMovement(landmarks: FaceLandmark[], calibrationData: CalibrationData): HeadMovementData {
  const leftEye = landmarks[LANDMARKS.LEFT_EYE_OUTER];
  const rightEye = landmarks[LANDMARKS.RIGHT_EYE_OUTER];
  const noseTip = landmarks[LANDMARKS.NOSE_TIP];
  
  // Calculate eye line angle
  const eyeVectorX = rightEye.x - leftEye.x;
  const eyeVectorY = rightEye.y - leftEye.y;
  const eyeLineYaw = Math.atan2(eyeVectorY, eyeVectorX) * 180 / Math.PI;
  
  // Calculate nose offset
  const eyeMidpointX = (leftEye.x + rightEye.x) / 2;
  const noseOffset = noseTip.x - eyeMidpointX;
  const faceWidth = Math.abs(rightEye.x - leftEye.x);
  const normalizedNoseOffset = noseOffset / faceWidth;
  
  // Estimate yaw from nose position
  const noseBasedYaw = normalizedNoseOffset * 45;
  
  // Combine both measurements
  const currentYaw = (eyeLineYaw + noseBasedYaw) / 2;
  
  if (!calibrationData.isCalibrated) {
    return { isMoving: false, direction: null, angle: currentYaw };
  }
  
  const yawDifference = currentYaw - calibrationData.baselineHeadYaw;
  const isMoving = Math.abs(yawDifference) > calibrationData.tolerance.headYaw;
  
  let direction: 'LEFT' | 'RIGHT' | null = null;
  if (isMoving) {
    direction = yawDifference < 0 ? 'LEFT' : 'RIGHT';
  }
  
  return { isMoving, direction, angle: currentYaw };
}

/**
 * Calculate baseline eye opening for calibration
 */
export function calculateBaselineEyeOpening(landmarks: FaceLandmark[]): number {
  const leftEyeOpening = Math.abs(landmarks[LANDMARKS.LEFT_EYE_LOWER].y - landmarks[LANDMARKS.LEFT_EYE_UPPER].y);
  const rightEyeOpening = Math.abs(landmarks[LANDMARKS.RIGHT_EYE_LOWER].y - landmarks[LANDMARKS.RIGHT_EYE_UPPER].y);
  return (leftEyeOpening + rightEyeOpening) / 2;
}

/**
 * Check if gaze is outside acceptable bounds
 */
export function isGazeOutOfBounds(gaze: GazeData, calibrationData: CalibrationData): {
  isOut: boolean;
  direction: string[];
} {
  const directions: string[] = [];
  const centerH = calibrationData.centerH;
  const centerV = calibrationData.centerV;
  const tolH = calibrationData.tolerance.h;
  const tolV = calibrationData.tolerance.v;
  
  // Check diagonal movements first
  if (gaze.avgH < centerH - tolH && gaze.avgV < centerV - tolV) {
    directions.push("RIGHT-DOWN");
  } else if (gaze.avgH > centerH + tolH && gaze.avgV < centerV - tolV) {
    directions.push("LEFT-DOWN");
  } else if (gaze.avgH < centerH - tolH && gaze.avgV > centerV + tolV) {
    directions.push("RIGHT-UP");
  } else if (gaze.avgH > centerH + tolH && gaze.avgV > centerV + tolV) {
    directions.push("LEFT-UP");
  } else {
    // Check individual directions for non-diagonal cases
    if (gaze.avgH < centerH - tolH) {
      directions.push("RIGHT");
    } else if (gaze.avgH > centerH + tolH) {
      directions.push("LEFT");
    }
    
    if (gaze.avgV < centerV - tolV) {
      directions.push("DOWN");
    } else if (gaze.avgV > centerV + tolV) {
      directions.push("UP");
    }
  }
  
  return {
    isOut: directions.length > 0,
    direction: directions
  };
}