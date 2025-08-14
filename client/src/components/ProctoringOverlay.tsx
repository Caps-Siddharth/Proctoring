// components/ProctoringOverlay.tsx

import React, { useEffect, useState } from 'react';
import { Alert, Button, Modal, Progress, Space, Typography } from 'antd';
import {
  WarningOutlined,
  FullscreenOutlined,
  SecurityScanOutlined,
  StopOutlined
} from '@ant-design/icons';

const { Text, Title } = Typography;

interface ProctoringOverlayProps {
  warningLevel: 'none' | 'low' | 'medium' | 'high';
  violationCount: number;
  maxViolations: number;
  warningMessage: string;
  isFullscreen: boolean;
  onEnterFullscreen: () => void;
  onTerminate?: () => void;
  showFullscreenPrompt?: boolean;
}

export const ProctoringOverlay: React.FC<ProctoringOverlayProps> = ({
  warningLevel,
  violationCount,
  maxViolations,
  warningMessage,
  isFullscreen,
  onEnterFullscreen,
  onTerminate,
  showFullscreenPrompt = true
}) => {
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [actuallyFullScreen, setActuallyFullScreen] = useState(false)
  const [showWarning, setShowWarning] = useState(false);


  useEffect(()=>{
    if(warningLevel !== 'none'){
      setShowWarning(true);
      const timer = setTimeout(() => {
        setShowWarning(false)
      }, 5000);
      return () => clearTimeout(timer);
    }
  },[warningLevel, warningMessage])


  useEffect(() => {
    const handleFullscreenChange = () => {
      setActuallyFullScreen(!!document.fullscreenElement);
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    setActuallyFullScreen(!!document.fullscreenElement);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfulllscreenchange', handleFullscreenChange)
    }
  }, [])

  // Auto-countdown for high warning level
  useEffect(() => {
    if (warningLevel === 'high' && violationCount >= maxViolations - 2) {
      setCountdown(30); // 30 seconds countdown
    } else {
      setCountdown(null);
    }
  }, [warningLevel, violationCount, maxViolations]);

  // Countdown timer
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;

    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
      if (countdown === 1) {
        setShowTerminateModal(true);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

  // const getWarningColor = () => {
  //   switch (warningLevel) {
  //     case 'low': return '#faad14'; // yellow
  //     case 'medium': return '#fa8c16'; // orange
  //     case 'high': return '#ff4d4f'; // red
  //     default: return '#52c41a'; // green
  //   }
  // };

  // const getWarningIcon = () => {
  //   switch (warningLevel) {
  //     case 'high': return <StopOutlined />;
  //     case 'medium':
  //     case 'low': return <WarningOutlined />;
  //     default: return <SecurityScanOutlined />;
  //   }
  // };

  const handleTerminate = () => {
    setShowTerminateModal(false);
    onTerminate?.();
  };

  return (
    <>
      {/* Fullscreen Prompt */}
      {showFullscreenPrompt && !isFullscreen && !actuallyFullScreen && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1001,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            padding: '40px',
            borderRadius: '12px',
            textAlign: 'center',
            minWidth: '400px'
          }}
        >
          <FullscreenOutlined style={{ fontSize: '48px', color: '#1890ff', marginBottom: '20px' }} />
          <Title level={3} style={{ color: 'white', marginBottom: '16px' }}>
            Fullscreen Mode Required
          </Title>
          <Text style={{ color: 'rgba(255, 255, 255, 0.85)', display: 'block', marginBottom: '24px' }}>
            This test must be completed in fullscreen mode to ensure a secure testing environment.
          </Text>
          <Button
            type="primary"
            size="large"
            icon={<FullscreenOutlined />}
            onClick={() => {
              const elem = document.documentElement;

              if (elem.requestFullscreen) {
                elem.requestFullscreen()
                  .then(() => {
                    console.log('✅ Fullscreen entered');
                    onEnterFullscreen(); // ✅ Only call on success
                  })
                  .catch((err) => {
                    console.error('❌ Fullscreen error:', err);
                    // Optionally show a notification or warning here
                  });
              } else {
                console.warn("Fullscreen not supported by this browser.");
              }
            }}
          >
            Enter Fullscreen Mode
          </Button>
        </div>
      )}

      {/* Warning Banner */}
      {/* Single Warning Notification - Top Right Corner */}
      {showWarning && warningLevel !== 'none' && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            backgroundColor: warningLevel === 'high' ? '#ff4d4f' : warningLevel === 'medium' ? '#fa8c16' : '#faad14',
            color: 'white',
            padding: '16px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 9999,
            minWidth: '300px',
            maxWidth: '400px',
            animation: 'slideIn 0.3s ease-out',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          <WarningOutlined style={{ fontSize: '20px' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              ⚠️ Suspicious Activity Detected
            </div>
            <div style={{ fontSize: '14px', opacity: 0.9 }}>
              Please stay focused on your test
            </div>
            <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
              Violations: {violationCount}/{maxViolations}
            </div>
          </div>
        </div>
      )}

      {/* Violation Details (for high warning level) */}
      {/* {warningLevel === 'high' && isFullscreen && (
        <Alert
          message="Critical Warning"
          description={
            <div>
              <Text>
                You have committed {violationCount} violations. The test will be terminated if you reach {maxViolations} violations.
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: '12px' }}>
                Common violations include: switching tabs, exiting fullscreen, using developer tools, or attempting to copy/paste.
              </Text>
            </div>
          }
          type="error"
          showIcon
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            maxWidth: '400px',
            zIndex: 999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}
        />
      )} */}

      {/* Termination Modal */}
      <Modal
        title={
          <Space>
            <StopOutlined style={{ color: '#ff4d4f' }} />
            <span>Test Termination Warning</span>
          </Space>
        }
        open={showTerminateModal}
        onOk={handleTerminate}
        onCancel={() => setShowTerminateModal(false)}
        okText="Terminate Test"
        cancelText="Continue"
        okButtonProps={{ danger: true }}
      >
        <Text>
          You have reached the maximum number of violations ({maxViolations}).
          The test will be terminated if you proceed.
        </Text>
        <br /><br />
        <Text type="secondary">
          If you believe this is an error, please contact the test administrator.
        </Text>
      </Modal>

      {/* CSS Animations */}
      <style>{`
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`}</style>
    </>
  );
};