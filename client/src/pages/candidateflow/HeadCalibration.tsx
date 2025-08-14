import React, { useRef, useEffect, useState } from 'react';
import { Button, Card, Typography, Space, Alert, Steps } from 'antd';
import { CameraOutlined, CameraTwoTone } from '@ant-design/icons';
import { useProctoringDetection } from '../../hooks/useProctoringDetection';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { useTokenNavigation } from '../../hooks/useTokenNavigation';
import { useAntiBacktrack } from '../../hooks/useAntiBacktrack';
import { buildFeatureVector, fitBaselineDiagonal } from '../../service/LandmarkIdentity';
import apiService from '../../service/apiService';

const { Title, Text } = Typography;
const { Step } = Steps;

const steps = ['Camera Setup', 'Camera Access', 'Face Positioning', 'Calibration Complete'];

const HeadCalibrationPage: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

  const [step, setStep] = useState(0);
  const [feedback, setFeedback] = useState('Position your face in the center');
  const [cameraError, setCameraError] = useState('');
  const [videoReady, setVideoReady] = useState(false);
  const [cameraAccess, setCameraAccess] = useState(false);
  const [calibrationImage, setCalibrationImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [calibrationStarted, setCalibrationStarted] = useState(false);

  
  // ✅ Use updated token hook with correct param
  const { token, navigateToStage } = useTokenNavigation({ requiredStage: 2 });
  const { initialize, calibrate, isInitialized } = useProctoringDetection(token);
  

  // ✅ Enforce stage-based access
  // useAntiBacktrack('calibration'); 

  useEffect(() => {
    const initializeFaceLandmarker = async () => {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        );

        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'IMAGE',
          numFaces: 1
        });

        await initialize();
      } catch (error) {
        console.error('Failed to initialize Face Landmarker:', error);
        setCameraError('Failed to initialize face detection');
      }
    };

    initializeFaceLandmarker();

    return () => {
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
      }
    };
  }, [initialize]);

  useAntiBacktrack({
    enabled: calibrationStarted, 
    onBackAttempt: () =>{
      if(token){
        apiService.recordViolation(token, {
          type: 'Navigation Attempt',
          details: 'User tried to navigate back during head calibration'
        })
      }
    },
    maxViolations: 3,
    terminateOnViolation: true
  })

  const initializeCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(console.error);
        };
      }

      setCameraAccess(true);
      setCalibrationStarted(true)
      setStep(2);
      setFeedback('Look straight into the camera');
    } catch (error) {
      console.error('Camera error:', error);
      setCameraError('Camera access denied or not available');
      setStep(0);
      setCalibrationStarted(false)
    }
  };

  useEffect(()=>{
    return () => setCalibrationStarted(false)
  },[]);

  const captureCalibrationImage = async () => {
    if (!videoRef.current || !canvasRef.current || !faceLandmarkerRef.current) {
      setFeedback('Unable to capture image. Please try again.');
      return;
    }

    setIsProcessing(true);
    setFeedback('Processing calibration...');

    try {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0);

      const imageData = canvas.toDataURL('image/jpeg', 0.8);

      const result = await faceLandmarkerRef.current.detect(videoRef.current);

      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        setFeedback('No face detected. Please ensure your face is clearly visible.');
        setIsProcessing(false);
        return;
      }

      const landmarks = result.faceLandmarks[0];
      const calibrationData = calibrate(landmarks, imageData);

      setCalibrationImage(imageData);
      setFeedback('Capturing identity baseline...');
      await captureIdentityBaseline(token!);
      setFeedback('Calibration successful! Redirecting to test...');
      setStep(3);
      setCalibrationStarted(false)

      sessionStorage.setItem(`calibrationData_${token}`, JSON.stringify(calibrationData));
      sessionStorage.setItem(`calibrationImage_${token}`, imageData);

      setTimeout(() => {
        navigateToStage("interview"); // ✅ Forward navigation
      }, 2000);

    } catch (error) {
      console.error('Calibration error:', error);
      setFeedback('Calibration failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (videoReady) {
      initializeCamera();
    }
  }, [videoReady]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const captureIdentityBaseline = async (token: string) =>{
    const samples: Float32Array[] = [];
    const TARGET = 15;
    const INTERVAL = 100;

    return new Promise<{mean: Float32Array; varDiag: Float32Array}>((resolve)=>{
      let count = 0;
      const timer = setInterval(()=>{
        if(videoRef.current || !faceLandmarkerRef.current) return;
        const res = faceLandmarkerRef.current.detectForVideo(videoRef.current!, performance.now());
        if(!res.faceLandmarks || res.faceLandmarks.length === 0) return;

        const fv = buildFeatureVector(res.faceLandmarks[0]);
        if(!fv) return;

        samples.push(fv);
        count++;
        if(count >= TARGET){
          clearInterval(timer);
          const baseline = fitBaselineDiagonal(samples);
          sessionStorage.setItem(`identityBaseline_${token}`, JSON.stringify({
            mean: Array.from(baseline.mean),
            varDiag: Array.from(baseline.varDiag)
          }));
          resolve(baseline);
        }
      }, INTERVAL);
    });
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '20px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <Card style={{
        maxWidth: '900px',
        width: '100%',
        boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
        borderRadius: '12px',
      }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2} style={{ color: '#1890ff' }}>Head Calibration</Title>
            <Text type="secondary">Please position your face for the proctoring system</Text>
          </div>

          <Steps current={step} size="small">
            {steps.map((title) => (
              <Step key={title} title={title} />
            ))}
          </Steps>

          <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start' }}>
            <div style={{ flex: 2 }}>
              <Card title="Camera Preview" styles={{
                body: {
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '450px',
                  position: 'relative'
                },
              }}>
                <video
                  ref={(ref) => {
                    videoRef.current = ref;
                    if (ref && !videoReady) setVideoReady(true);
                  }}
                  autoPlay muted playsInline
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
                  <div style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    width: '120px',
                    height: '90px',
                    border: '2px solid #52c41a',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}>
                    <img src={calibrationImage} alt="Calibration" style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }} />
                  </div>
                )}
              </Card>
            </div>

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
                      <li>Ensure good lighting on your face</li>
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
