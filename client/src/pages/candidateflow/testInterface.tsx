import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    Button, Card, Divider, Typography, List, Drawer, notification, Modal,
    Alert
} from 'antd';
import {
    AudioOutlined,
    VideoCameraOutlined,
    WarningOutlined,
    SecurityScanOutlined,
    HistoryOutlined,
    CheckCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useProctoringDetection } from '../../hooks/useProctoringDetection';
import { useBrowserProctoring } from '../../hooks/useBrowserProctoring';
import { ProctoringOverlay } from '../../components/ProctoringOverlay';
import ChatboxMicRecorder from './ChatboxMicRecorder';
import { useAntiBacktrack } from '../../hooks/useAntiBacktrack';
import { ProctoringDetectionService } from '../../service/ProctoringDetectionService';
import apiService, { API_BASE_URL } from '../../service/apiService';
import { buildFeatureVector, mahalanobisDiag } from '../../service/LandmarkIdentity';

const { Title, Text } = Typography;

const MAX_VIOLATIONS = 10;
const MAX_TAB_SWITCHES = 3;
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

const TestInterface: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const [pendingAnswer, setPendingAnswer] = useState<string>("");
    const [submittingNext, setSubmittingNext] = useState(false);
    const [submittingFinish, setSubmittingFinish] = useState(false);
    const [numQuestions, setNumQuestions] = useState<number | null>(null);
    const [impersonationStatus, setImpersonationStatus] = useState<'none' | 'pass' | 'gray' | 'fail'>('none');
    const [impersonationDistance, setImpersonationDistance] = useState<number | null>(null);

    // Refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const testContainerRef = useRef<HTMLDivElement>(null);
    const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

    // State
    const [testStarted, setTestStarted] = useState(false);
    const [isActuallyFullscreen, setIsActuallyFullscreen] = useState(false);
    const [tabSwitchCount, setTabSwitchCount] = useState(0);
    const [showViolationHistory, setShowViolationHistory] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);

    // Interview specific state
    const [currentQuestionNumber, setCurrentQuestionNumber] = useState<number>(0);
    const [totalQuestions, setTotalQuestions] = useState<number>(5);
    const [questionsRemaining, setQuestionsRemaining] = useState<number>(5);
    const [currentResponse, setCurrentResponse] = useState<string>('');
    const [isLoadingResponse, setIsLoadingResponse] = useState<boolean>(false);
    const [interviewComplete, setInterviewComplete] = useState<boolean>(false);
    const [isWaitingForAnswer, setIsWaitingForAnswer] = useState<boolean>(false);

    const [interviewData, setInterviewData] = useState({
        name: '',
        role: '',
        responses: [] as Array<{ question: string; answer: string }>
    });

    // Proctoring hooks
    const {
        isWarning: isFaceWarning,
        warningMessage: faceWarningMessage,
        detectionResult,
        isInitialized,
        isDetecting,
        initialize,
        startDetection,
        stopDetection,
        setVideoElement,
        setCanvasElement,
    } = useProctoringDetection(token);

    const {
        violations,
        violationCount,
        isFullscreen,
        warningLevel: browserWarningLevel,
        isMonitoring,
        isTerminated,
        startMonitoring,
        stopMonitoring,
        enterFullscreen,
        getViolationMessage
    } = useBrowserProctoring({
        config: {
            maxViolations: MAX_VIOLATIONS,
            screenshotOnViolation: false,
            autoTerminateOnMaxViolations: true
        },
        onViolation: () => { },
        onTermination: () => handleTestTermination("Multiple violations detected")
    });

    useAntiBacktrack({
        enabled: testStarted,
        onBackAttempt: () => {
            apiService.recordViolation(token!, {
                type: 'Navigation Attempt',
                details: 'User tried to navigate back'
            });
        },
        maxViolations: 3,
        terminateOnViolation: true
    });

    const isAnyWarning = isFaceWarning || browserWarningLevel !== 'none';
    const combinedWarningMessage = [faceWarningMessage, getViolationMessage()].filter(Boolean).join(' | ');

    const getOverallWarningLevel = useCallback(() => {
        if (browserWarningLevel === 'high' || (isFaceWarning && detectionResult?.warningLevel === 'warning')) {
            return 'high';
        } else if (browserWarningLevel === 'medium' || (isFaceWarning && detectionResult?.warningLevel === 'caution')) {
            return 'medium';
        } else if (browserWarningLevel === 'low' || isFaceWarning) {
            return 'low';
        }
        return 'none';
    }, [browserWarningLevel, isFaceWarning, detectionResult]);

    const handleTestTermination = useCallback((reason: string) => {
        notification.error({
            message: 'Test Terminated',
            description: reason,
            placement: 'topRight',
            duration: 3
        });
        setTimeout(() => navigate('/test-terminated'), 1000);
    }, [navigate]);

    const fetchTestConfig = async () => {
        if (!token) return;
        try {
            const config = await apiService.getTestConfig(token);
            setInterviewData(prev => ({
                ...prev,
                name: config.candidate_name,
                role: config.role_subject
            }));
            setTotalQuestions(config.num_questions || 5);
            setQuestionsRemaining(config.num_questions || 5);
        } catch (err) {
            console.error('Failed to fetch test config:', err);
        }
    };

    const startInterview = async () => {
        if (!token) return;
        setIsLoadingResponse(true);
        try {
            const response = await apiService.startInterview(token);
            setCurrentResponse(response.response_text);
            setCurrentQuestionNumber(1);
            setQuestionsRemaining(response.questions_remaining || (totalQuestions - 1));
            setIsWaitingForAnswer(true);

            // Play audio if available
            if (response.audio_url) {
                const audioUrl = response.audio_url.startsWith('http')
                    ? response.audio_url
                    : `${API_BASE_URL}${response.audio_url}`;

                const audio = new Audio(audioUrl);
                audio.onerror = (e) => console.error('Audio playback error:', e);
                audio.play().catch(console.warn);
            }
        } catch (err) {
            console.error('Interview start error:', err);
            notification.error({
                message: 'Interview Error',
                description: 'Failed to start interview'
            });
        } finally {
            setIsLoadingResponse(false);
        }
    };

    const submitAnswerToAI = async (text: string) => {
        if (!token || !text.trim()) return;

        // Store the Q&A pair
        setInterviewData(prev => ({
            ...prev,
            responses: [
                ...prev.responses,
                { question: currentResponse, answer: text }
            ]
        }));

        setIsLoadingResponse(true);
        setIsWaitingForAnswer(false);

        try {
            const submitResponse = await apiService.submitTextAnswer(token, text);

            // Check if interview is complete
            if (submitResponse.is_complete) {
                setInterviewComplete(true);
                setCurrentResponse(submitResponse.response_text); // Show summary
                setPendingAnswer("");
                stopMonitoring();
                stopDetection();

                Modal.success({
                    title: 'Interview Complete',
                    content: (
                        <div>
                            <p>Thank you for completing the interview. Your response has been recorded.</p>
                        </div>
                    ),
                    onOk: () => navigate('/test-complete')
                });
                return;
            }

            // Update state for next question
            setCurrentResponse(submitResponse.response_text);
            setCurrentQuestionNumber(submitResponse.question_number);
            setQuestionsRemaining(submitResponse.questions_remaining || 0);
            setIsWaitingForAnswer(true);
            setPendingAnswer("");

            // Play audio for next question
            if (submitResponse.audio_url) {
                const audioUrl = submitResponse.audio_url.startsWith('http')
                    ? submitResponse.audio_url
                    : `${API_BASE_URL}${submitResponse.audio_url}`;

                const audio = new Audio(audioUrl);
                audio.play().catch(console.warn);
            }

        } catch (err: any) {
            console.error('Submit answer error:', err);

            // Check if it's because interview is already complete
            if (err.message?.includes('complete')) {
                setInterviewComplete(true);
                Modal.info({
                    title: 'Interview Already Complete',
                    content: 'You have already answered all questions.',
                    onOk: () => navigate('/test-complete')
                });
            } else {
                notification.error({
                    message: 'Submission Error',
                    description: 'Failed to submit answer. Please try again.'
                });
                setIsWaitingForAnswer(true);
            }
        } finally {
            setIsLoadingResponse(false);
        }
    };

    // Helper function to extract question from AI response
    // const extractQuestionFromResponse = (response: string): string => {
    //     const match = response.match(/Question \d+:(.*?)(?:\n|$)/is);
    //     return match ? match[1].trim() : response;
    // };

    const handleStartTest = async () => {
        setTestStarted(true);

        // Start monitoring
        if (testContainerRef.current) {
            await startMonitoring(testContainerRef.current);
        }

        // Fetch config and start interview
        await fetchTestConfig();
        await startInterview();
    };

    const handleReplay = () => {
        if (!currentResponse) return;

        // Use speech synthesis as fallback
        const utterance = new SpeechSynthesisUtterance(currentResponse);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        speechSynthesis.speak(utterance);
    };

    const initializeCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });

            if (videoRef.current) {
                const oldStream = videoRef.current.srcObject as MediaStream | null;
                if (oldStream) {
                    oldStream.getTracks().forEach(track => track.stop());
                }

                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = async () => {
                    try {
                        await videoRef.current!.play();
                        setCameraReady(true);
                    } catch (playError) {
                        const error = playError as Error;
                        if (error.name !== 'AbortError') {
                            console.error('Error playing video:', error);
                        }
                    }
                };
            }
        } catch (error) {
            console.error('Camera error:', error);
            notification.error({
                message: 'Camera Error',
                description: 'Unable to access camera. Please check permissions.',
            });
        }
    };

    const isLastQuestion =
        (typeof questionsRemaining === 'number' && questionsRemaining <= 0) || (typeof totalQuestions === 'number' && currentQuestionNumber >= totalQuestions);

    // Effects
    useEffect(() => {
        if (token) {
            initialize().catch(console.error);
        }
    }, [initialize, token]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsActuallyFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        setIsActuallyFullscreen(!!document.fullscreenElement);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    useEffect(() => {
        if (cameraReady && isInitialized && videoRef.current && canvasRef.current && !isDetecting && testStarted && token) {
            setVideoElement(videoRef.current);
            setCanvasElement(canvasRef.current);
            startDetection(videoRef.current);
        }
        return () => {
            if (isDetecting && token)
                stopDetection();
        };
    }, [cameraReady, isInitialized, isDetecting, startDetection, stopDetection, testStarted, token]);

    useEffect(() => {
        if (!testStarted || !token) return;

        const WINDOW = 5;
        const last: number[] = [];
        let warnedGray = false;
        let warnedFail = false;

        const id = window.setInterval(() => {
            try {
                const raw = sessionStorage.getItem(`IdentityBaseline_${token}`);
                if (!raw) {
                    setImpersonationStatus('none');
                    setImpersonationDistance(null);
                    return;
                }
                const parsed = JSON.parse(raw) as { mean: number[]; varDiag: number[] };
                const mean = new Float32Array(parsed.mean);
                const varDiag = new Float32Array(parsed.varDiag);

                const lm = (detectionResult as any)?.faceLandmarks?.[0] ??
                    (detectionResult as any)?.landmarks ??
                    null;
                if (!lm) return;

                const fv = buildFeatureVector(lm);
                if (!fv) return;

                const d = mahalanobisDiag(fv, mean, varDiag);
                setImpersonationDistance(d);

                last.push(d);
                if (last.length > WINDOW) last.shift();

                const bad = last.filter(v => v > 3.5).length;
                const gray = last.filter(v => v > 2.5 && v <= 3.5).length;

                if (bad >= 3) {
                    setImpersonationStatus('fail')
                    if (!warnedFail) {
                        warnedFail = true;

                        apiService.recordViolation(token, {
                            type: 'IMPERSONATION',
                            details: `Identity mismatch d=${d.toFixed(2)}; window=[${last.map(n => n.toFixed(2)).join(', ')}]`
                        });

                        notification.error({
                            message: "Impersonation suspected",
                            description: 'Identity mismatch detected. Please re-authenticate',
                            duration: 4
                        });
                    }
                } else if (gray >= 3) {
                    setImpersonationStatus('gray');
                    if (!warnedGray) {
                        warnedGray = true;
                        notification.warning({
                            message: 'Identity re-check needed',
                            description: 'Please look straight at the camera and blink twice.',
                            duration: 3
                        })
                    }
                } else {
                    setImpersonationStatus('pass');
                    warnedGray = false;
                }
            } catch (e) {
                console.warn("Identity check error:", e);
            }
        }, 4000);

        return () => clearInterval(id);
    }, [testStarted, token, detectionResult])

    useEffect(() => {
        if (cameraReady && videoRef.current && canvasRef.current) {
            const service = ProctoringDetectionService.getInstance();
            service.setVideoElement(videoRef.current);
            service.setCanvasElement(canvasRef.current);
        }
    }, [cameraReady]);

    useEffect(() => {
        if (!testStarted) return;
        const resetIdleTimer = () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            idleTimerRef.current = setTimeout(() => {
                handleTestTermination('Idle timeout');
            }, IDLE_TIMEOUT);
        };

        ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(event =>
            window.addEventListener(event, resetIdleTimer)
        );

        resetIdleTimer();

        return () => {
            ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(event =>
                window.removeEventListener(event, resetIdleTimer)
            );
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
    }, [testStarted, handleTestTermination]);

    useEffect(() => {
        if (interviewComplete && videoRef.current?.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach((track) => track.stop());
            videoRef.current.srcObject = null;
            console.log('✅ Camera stopped after interview completion');
        }
    }, [interviewComplete]);

    useEffect(() => {
        if (!testStarted) return;
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                setTabSwitchCount(prev => {
                    const newCount = prev + 1;
                    if (newCount > MAX_TAB_SWITCHES) {
                        stopMonitoring();
                        stopDetection();
                        handleTestTermination('Exceeded tab switch limit');
                    } else {
                        notification.warning({
                            message: 'Tab Switch Detected',
                            description: `You switched tabs ${newCount} times. Max allowed is ${MAX_TAB_SWITCHES}.`
                        });
                    }
                    return newCount;
                });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [testStarted, stopMonitoring, stopDetection, handleTestTermination]);

    if (isTerminated) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <Card>
                    <Title level={3} style={{ color: '#ff4d4f' }}>Test Terminated</Title>
                    <Text>Your test has been terminated due to violations.</Text>
                </Card>
            </div>
        );
    }

    if (!testStarted) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <Card style={{ width: '500px', textAlign: 'center' }}>
                    <SecurityScanOutlined style={{ fontSize: '48px', color: '#1890ff', marginBottom: '20px' }} />
                    <Title level={3}>Proctored Test Environment</Title>
                    <List
                        size="small"
                        dataSource={[
                            'Enter fullscreen mode',
                            'Keep your face visible',
                            'Stay on this tab',
                            'Avoid shortcuts',
                            `Answer all ${totalQuestions} questions`,
                            'Idle >10 mins ends test'
                        ]}
                        renderItem={(item) => <List.Item><Text>• {item}</Text></List.Item>}
                    />
                    <Button type="primary" icon={<SecurityScanOutlined />} onClick={handleStartTest}>
                        Start Proctored Test
                    </Button>
                </Card>
            </div>
        );
    }

    return (
        <div ref={testContainerRef} style={{ display: 'flex', minHeight: '100vh' }}>
            <ProctoringOverlay
                warningLevel={getOverallWarningLevel()}
                violationCount={violationCount}
                maxViolations={MAX_VIOLATIONS}
                warningMessage={combinedWarningMessage}
                isFullscreen={isFullscreen}
                onEnterFullscreen={enterFullscreen}
                onTerminate={() => handleTestTermination('Manual termination')}
                showFullscreenPrompt={testStarted && !interviewComplete}
            />

            {/* Left Panel - Camera Feed */}
            <div style={{ width: '20%', padding: '20px' }}>
                <Card
                    title={<><VideoCameraOutlined /> Camera Feed</>}
                    size="small"
                    extra={
                        <Button
                            type="text"
                            icon={<HistoryOutlined />}
                            onClick={() => setShowViolationHistory(true)}
                            danger={violations.length > 0}
                        >
                            {violations.length}
                        </Button>
                    }
                >
                    <video
                        ref={(ref) => {
                            if (ref && !cameraReady) {
                                videoRef.current = ref;
                                initializeCamera();
                            }
                        }}
                        autoPlay muted playsInline
                        style={{ width: '100%', borderRadius: '8px', backgroundColor: '#000', transform: 'scaleX(-1)' }}
                    />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                    {impersonationStatus !== 'none' && (
                        <div style={{ marginTop: 12 }}>
                            {impersonationStatus === 'pass' && (
                                <Alert
                                    type="success"
                                    showIcon
                                    message={(
                                        <span>
                                            <strong>Identity verified</strong>
                                            {typeof impersonationDistance === 'number' && (
                                                <> — d={impersonationDistance.toFixed(2)}</>
                                            )}
                                        </span>
                                    )}
                                />
                            )}

                            {impersonationStatus === 'gray' && (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message={(
                                        <span>
                                            <strong>Impersonation check required</strong>
                                            {typeof impersonationDistance === 'number' && (
                                                <> — d={impersonationDistance.toFixed(2)}</>
                                            )}
                                        </span>
                                    )}
                                    description="Please look straight at the camera and blink twice."
                                />
                            )}

                            {impersonationStatus === 'fail' && (
                                <Alert
                                    type="error"
                                    showIcon
                                    message={(
                                        <span>
                                            <strong>Impersonation suspected</strong>
                                            {typeof impersonationDistance === 'number' && (
                                                <> — d={impersonationDistance.toFixed(2)}</>
                                            )}
                                        </span>
                                    )}
                                    description="Your identity does not match the calibrated baseline."
                                />
                            )}
                        </div>
                    )}
                </Card>

                {/* Progress Card */}
                {/* <Card style={{ marginTop: '20px' }} size="small">
                    <div style={{ textAlign: 'center' }}>
                        <QuestionCircleOutlined style={{ fontSize: '24px', color: '#1890ff', marginBottom: '10px' }} />
                        <Title level={5}>Question {currentQuestionNumber} of {totalQuestions}</Title>
                        <Progress 
                            percent={Math.round((currentQuestionNumber / totalQuestions) * 100)} 
                            status={interviewComplete ? 'success' : 'active'}
                        />
                        <Text type="secondary">
                            {questionsRemaining > 0 ? `${questionsRemaining} questions remaining` : 'Final question'}
                        </Text>
                    </div>
                </Card> */}
            </div>

            {/* Main Content Area */}
            <div style={{ flex: 1, padding: '40px' }}>
                <Card>
                    {!interviewComplete && (
                        <>
                            <div style={{ marginBottom: '20px' }}>
                                {/* <Badge 
                                    count={`Q${currentQuestionNumber}`} 
                                    style={{ backgroundColor: '#1890ff' }}
                                >
                                    <Title level={4} style={{ margin: 0 }}>Current Response from AI</Title>
                                </Badge> */}
                            </div>
                            <div style={{
                                backgroundColor: '#f5f5f5',
                                padding: '20px',
                                borderRadius: '8px',
                                minHeight: '100px',
                                marginBottom: '20px'
                            }}>
                                <Text>{currentResponse || 'Loading question...'}</Text>
                            </div>
                            <Divider />
                        </>
                    )}

                    {isLoadingResponse ? (
                        <div style={{ textAlign: 'center', padding: '40px' }}>
                            <Text>Processing your answer and generating next question...</Text>
                        </div>
                    ) : (
                        <>
                            {!interviewComplete && isWaitingForAnswer && (
                                <ChatboxMicRecorder
                                    onTranscriptionReady={(text) => {
                                        // transcription just arrived; keep it so user can review
                                        setPendingAnswer(text);
                                    }}
                                    onSave={(text) => {
                                        // user confirmed the transcription; still do NOT call GPT here
                                        setPendingAnswer(text);
                                    }}
                                />
                            )}

                            {pendingAnswer && !interviewComplete && (
                                !isLastQuestion ? (
                                    <Button
                                        type="primary"
                                        style={{ marginTop: 12, marginRight: 8 }}
                                        onClick={async () => {
                                            if (submittingNext || !pendingAnswer.trim()) return;
                                            setSubmittingNext(true);
                                            try {
                                                await submitAnswerToAI(pendingAnswer);
                                            } finally {
                                                setSubmittingNext(false);
                                            }
                                        }}
                                        loading={submittingNext}
                                        disabled={submittingNext || !pendingAnswer.trim()}
                                    >
                                        Next question
                                    </Button>
                                ) : (
                                    <Button
                                        type="primary"
                                        style={{ marginTop: 12 }}
                                        onClick={async () => {
                                            if (submittingFinish || !pendingAnswer.trim()) return;
                                            setSubmittingFinish(true);
                                            try {
                                                // On last question we still submit the final answer,
                                                // and your existing submitAnswerToAI will show the modal + navigate.
                                                await submitAnswerToAI(pendingAnswer);
                                            } finally {
                                                setSubmittingFinish(false);
                                            }
                                        }}
                                        loading={submittingFinish}
                                        disabled={submittingFinish || !pendingAnswer.trim()}
                                    >
                                        Finish interview
                                    </Button>
                                )
                            )}


                            {interviewComplete && (
                                <div style={{ textAlign: 'center', padding: '40px' }}>
                                    <CheckCircleOutlined style={{ fontSize: '48px', color: '#52c41a', marginBottom: '20px' }} />
                                    <Title level={3}>Interview Complete!</Title>
                                    <div style={{
                                        backgroundColor: '#f6ffed',
                                        padding: '20px',
                                        borderRadius: '8px',
                                        marginBottom: '20px',
                                        textAlign: 'left'
                                    }}>
                                        <Text>{currentResponse}</Text>
                                    </div>
                                    <Button
                                        type="primary"
                                        size="large"
                                        icon={<CheckCircleOutlined />}
                                        onClick={() => navigate('/test-complete')}
                                    >
                                        Finish Interview
                                    </Button>
                                </div>
                            )}
                        </>
                    )}

                    {!interviewComplete && currentResponse && (
                        <Button
                            type="default"
                            icon={<AudioOutlined />}
                            onClick={handleReplay}
                            style={{ marginTop: 12 }}
                        >
                            Replay Question
                        </Button>
                    )}
                </Card>
            </div>

            {/* Violation Drawer */}
            <Drawer
                title="Violation History"
                placement="right"
                onClose={() => setShowViolationHistory(false)}
                open={showViolationHistory}
                width={400}
            >
                <List
                    dataSource={violations}
                    renderItem={(violation) => (
                        <List.Item>
                            <List.Item.Meta
                                avatar={<WarningOutlined style={{ color: '#ff4d4f' }} />}
                                title={violation.type.replace(/_/g, ' ')}
                                description={
                                    <>
                                        <Text type="secondary">{violation.details}</Text>
                                        <br />
                                        <Text type="secondary" style={{ fontSize: '12px' }}>
                                            {new Date(violation.timestamp).toLocaleTimeString()}
                                        </Text>
                                    </>
                                }
                            />
                        </List.Item>
                    )}
                />
            </Drawer>
        </div>
    );
};

export default TestInterface;