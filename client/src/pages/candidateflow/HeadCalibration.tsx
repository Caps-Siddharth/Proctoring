import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button, Card, Typography, Space, Alert, Steps, notification } from 'antd';
import { CameraOutlined, CameraTwoTone } from '@ant-design/icons';
import { useProctoringDetection } from '../../hooks/useProctoringDetection';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { useTokenNavigation } from '../../hooks/useTokenNavigation';
import { useAntiBacktrack } from '../../hooks/useAntiBacktrack';
import { buildFeatureVector, fitBaselineDiagonal } from '../../service/LandmarkIdentity';
import apiService from '../../service/apiService';

const { Title, Text } = Typography;
const { Step } = Steps;

const STEPS = ['Camera Setup', 'Camera Access', 'Face Positioning', 'Calibration Complete'] as const;

/** Baseline capture params */
const BASELINE_TARGET = 15;        // collect 15 good frames
const BASELINE_INTERVAL_MS = 100;  // every 100ms
const BASELINE_TIMEOUT_MS = 6000;  // abort at 6s
const ACCEPT_MIN_SAMPLES = 10;     // allow success if we reached at least 10

const HeadCalibrationPage: React.FC = () => {
  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

  // --- State ---
  const [step, setStep] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>('Position your face in the center');
  const [cameraError, setCameraError] = useState<string>('');
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [cameraAccess, setCameraAccess] = useState<boolean>(false);
  const [calibrationImage, setCalibrationImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [calibrationStarted, setCalibrationStarted] = useState<boolean>(false);

  // --- Routing / Proctoring ---
  const { token, navigateToStage } = useTokenNavigation({ requiredStage: 2 });
  const { initialize, calibrate, isInitialized } = useProctoringDetection(token);

  // --- Anti backtrack during calibration only ---
  useAntiBacktrack({
    enabled: calibrationStarted,
    onBackAttempt: () => {
      if (token) {
        apiService.recordViolation(token, {
          type: 'Navigation Attempt',
          details: 'User tried to navigate back during head calibration',
        });
      }
    },
    maxViolations: 3,
    terminateOnViolation: true,
  });

  // --- Initialize Face Landmarker (IMAGE mode) + proctoring hook once ---
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        );

        if (cancelled) return;

        // IMAGE mode -> we will use landmarker.detect(videoEl)
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          numFaces: 1,
        });

        await initialize();
      } catch (err) {
        console.error('Failed to initialize Face Landmarker:', err);
        setCameraError('Failed to initialize face detection');
      }
    })();

    return () => {
      cancelled = true;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
    };
  }, [initialize]);

  // --- Camera init ---
  const initializeCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });

      streamRef.current = stream;

      const el = videoRef.current;
      if (el) {
        // stop any previous stream if present
        const old = el.srcObject as MediaStream | null;
        if (old) old.getTracks().forEach((t) => t.stop());

        el.srcObject = stream;
        el.onloadedmetadata = () => {
          el.play().catch(console.error);
        };
      }

      setCameraAccess(true);
      setCalibrationStarted(true);
      setStep(2);
      setFeedback('Look straight into the camera');
    } catch (error) {
      console.error('Camera error:', error);
      setCameraError('Camera access denied or not available');
      setStep(0);
      setCalibrationStarted(false);
    }
  }, []);

  // Start camera when <video> becomes ready
  useEffect(() => {
    if (videoReady) {
      initializeCamera();
    }
  }, [videoReady, initializeCamera]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      setCalibrationStarted(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // --- Identity baseline capture (safe) ---
  const captureIdentityBaselineSafe = useCallback(async (
    token: string,
    opts: {
      target?: number;
      intervalMs?: number;
      maxDurationMs?: number;
      onProgress?: (ok: number, target: number) => void;
    } = {}
  ) => {
    const TARGET = opts.target ?? BASELINE_TARGET;
    const INTERVAL_MS = opts.intervalMs ?? BASELINE_INTERVAL_MS;
    const MAX_DURATION = opts.maxDurationMs ?? BASELINE_TIMEOUT_MS;
    const MIN_OK = Math.min(ACCEPT_MIN_SAMPLES, TARGET - 2);

    const samples: Float32Array[] = [];
    const start = performance.now();

    return await new Promise<{ mean: Float32Array; varDiag: Float32Array }>((resolve, reject) => {
      const tick = () => {
        // Timeout guard
        if (performance.now() - start > MAX_DURATION) {
          if (samples.length >= MIN_OK) {
            const baseline = fitBaselineDiagonal(samples);
            sessionStorage.setItem(
              `identityBaseline_${token}`,
              JSON.stringify({
                mean: Array.from(baseline.mean),
                varDiag: Array.from(baseline.varDiag),
              })
            );
            return resolve(baseline);
          }
          return reject(new Error('Identity baseline capture timed out'));
        }

        const videoEl = videoRef.current;
        const landmarker = faceLandmarkerRef.current;
        if (!videoEl || !landmarker) {
          return setTimeout(tick, INTERVAL_MS);
        }

        // IMAGE mode call:
        const res = landmarker.detect(videoEl);
        const faces = res?.faceLandmarks?.length ?? 0;

        // Optional: console.debug helps if it ever stalls
        // console.debug('baseline tick', { faces, ok: samples.length });

        if (faces === 1) {
          const fv = buildFeatureVector(res!.faceLandmarks![0]);
          if (fv) {
            samples.push(fv);
            opts.onProgress?.(samples.length, TARGET);
          }
        }

        if (samples.length >= TARGET) {
          const baseline = fitBaselineDiagonal(samples);
          sessionStorage.setItem(
            `identityBaseline_${token}`,
            JSON.stringify({
              mean: Array.from(baseline.mean),
              varDiag: Array.from(baseline.varDiag),
            })
          );
          return resolve(baseline);
        }

        setTimeout(tick, INTERVAL_MS);
      };

      tick();
    });
  }, []);

  // --- Main capture handler ---
  const captureCalibrationImage = useCallback(async () => {
    const videoEl = videoRef.current;
    const canvasEl = canvasRef.current;
    const landmarker = faceLandmarkerRef.current;

    if (!videoEl || !canvasEl || !landmarker) {
      setFeedback('Unable to capture image. Please try again.');
      return;
    }

    setIsProcessing(true);
    setFeedback('Processing calibration...');

    try {
      // 1) Snapshot still image
      const ctx = canvasEl.getContext('2d');
      if (!ctx) throw new Error('Canvas not available');

      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0);

      const imageData = canvasEl.toDataURL('image/jpeg', 0.8);

      // 2) Face detection for this still frame
      const result = landmarker.detect(videoEl);
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        setFeedback('No face detected. Please ensure your face is clearly visible.');
        setIsProcessing(false);
        return;
      }

      // 3) Apply your existing calibrate(...)
      const landmarks = result.faceLandmarks[0];
      const calibrationData = calibrate(landmarks, imageData);

      // 4) Save preview + feedback now
      setCalibrationImage(imageData);
      setFeedback('Capturing identity baseline… Please hold still for ~2 seconds');

      // 5) Capture identity baseline (with progress + timeout)
      await captureIdentityBaselineSafe(token!, {
        onProgress: (ok, target) => setFeedback(`Capturing identity baseline… ${ok}/${target}`),
      });

      // 6) Persist session data BEFORE navigating
      sessionStorage.setItem(`calibrationData_${token}`, JSON.stringify(calibrationData));
      sessionStorage.setItem(`calibrationImage_${token}`, imageData);

      // 7) Finalize UI and go to interview
      setFeedback('Calibration successful! Redirecting to test…');
      setStep(3);
      setCalibrationStarted(false);

      setTimeout(() => {
        navigateToStage('interview');
      }, 800);
    } catch (error: any) {
      console.error('Calibration error:', error);
      const msg = error?.message || 'Calibration failed. Please try again.';
      setFeedback(msg);
      notification.warning({
        message: 'Calibration issue',
        description: msg,
      });
    } finally {
      setIsProcessing(false);
    }
  }, [calibrate, captureIdentityBaselineSafe, navigateToStage, token]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        padding: '20px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Card
        style={{
          maxWidth: '900px',
          width: '100%',
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          borderRadius: '12px',
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2} style={{ color: '#1890ff' }}>
              Head Calibration
            </Title>
            <Text type="secondary">Please position your face for the proctoring system</Text>
          </div>

          <Steps current={step} size="small">
            {STEPS.map((title) => (
              <Step key={title} title={title} />
            ))}
          </Steps>

          <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start' }}>
            {/* Left: Camera */}
            <div style={{ flex: 2 }}>
              <Card
                title="Camera Preview"
                styles={{
                  body: {
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '450px',
                    position: 'relative',
                  },
                }}
              >
                <video
                  ref={(ref) => {
                    videoRef.current = ref;
                    // trigger once
                    if (ref && !videoReady) setVideoReady(true);
                  }}
                  autoPlay
                  muted
                  playsInline
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    backgroundColor: '#000',
                  }}
                />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                {calibrationImage && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '10px',
                      right: '10px',
                      width: '120px',
                      height: '90px',
                      border: '2px solid #52c41a',
                      borderRadius: '8px',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={calibrationImage}
                      alt="Calibration"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                )}
              </Card>
            </div>

            {/* Right: Controls & Status */}
            <div style={{ flex: 1 }}>
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message="Status"
                  description={feedback}
                  type={step === 3 ? 'success' : cameraAccess ? 'info' : 'warning'}
                  showIcon
                />
                {cameraError && (
                  <Alert message="Camera Error" description={cameraError} type="error" showIcon />
                )}
                <Alert
                  message="Calibration Instructions"
                  description={
                    <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                      <li>Ensure good, even lighting on your face</li>
                      <li>Look directly at the camera</li>
                      <li>Keep your head straight and centered</li>
                      <li>Remove glasses if they cause glare</li>
                    </ul>
                  }
                  type="info"
                />

                {!cameraAccess ? (
                  <Button
                    type="primary"
                    icon={<CameraOutlined />}
                    onClick={() => setVideoReady(true)}
                    size="large"
                    style={{ width: '100%' }}
                    disabled={!isInitialized}
                    loading={!isInitialized}
                  >
                    {isInitialized ? 'Initialize Camera' : 'Loading...'}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<CameraTwoTone />}
                    onClick={captureCalibrationImage}
                    size="large"
                    style={{ width: '100%' }}
                    disabled={step === 3 || isProcessing}
                    loading={isProcessing}
                  >
                    {isProcessing ? 'Processing...' : 'Capture Calibration Image'}
                  </Button>
                )}
              </Space>
            </div>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default HeadCalibrationPage;
