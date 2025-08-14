import React from 'react';
import { Card, Button, Space, Typography, Result } from 'antd';
import { StopOutlined, HomeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Paragraph } = Typography;

const TestTerminated: React.FC = () => {
  const navigate = useNavigate();

  const handleGoHome = () => {
    console.log('redirected 3');
    navigate('/');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#fff1f0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '20px',
      }}
    >
      <Card
        style={{
          maxWidth: '600px',
          width: '100%',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          borderRadius: '12px',
          border: '1px solid #ffccc7',
        }}
      >
        <Result
          status="error"
          icon={<StopOutlined style={{ color: '#ff4d4f' }} />}
          title={
            <Title level={3} style={{ color: '#ff4d4f', marginTop: '16px' }}>
              Test Terminated
            </Title>
          }
          subTitle="Your test has been terminated due to multiple tab switch violations."
          extra={
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Paragraph style={{ textAlign: 'center', fontSize: '16px' }}>
                You exceeded the maximum allowed number of tab switches during the test. 
                This is a violation of the test integrity policy.
              </Paragraph>
              
              <Paragraph type="secondary" style={{ textAlign: 'center' }}>
                If you believe this was a mistake or you experienced technical difficulties, 
                please contact your test administrator immediately with your test ID and 
                a description of what happened.
              </Paragraph>

              <div style={{ textAlign: 'center', marginTop: '24px' }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<HomeOutlined />}
                  onClick={handleGoHome}
                  style={{
                    minWidth: '200px',
                    height: '48px',
                    fontSize: '16px',
                  }}
                >
                  Return to Home
                </Button>
              </div>

              <Paragraph 
                type="secondary" 
                style={{ 
                  textAlign: 'center', 
                  fontSize: '14px',
                  marginTop: '16px',
                  fontStyle: 'italic' 
                }}
              >
                Your test session has been recorded and will be reviewed by the administrator.
              </Paragraph>
            </Space>
          }
        />
      </Card>
    </div>
  );
};

export default TestTerminated;