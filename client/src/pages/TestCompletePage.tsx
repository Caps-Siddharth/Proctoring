// src/pages/TestCompletePage.tsx

import React from 'react';
import { Result, Button } from 'antd';
import { SmileOutlined, HomeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAntiBacktrack } from '../hooks/useAntiBacktrack';

const TestCompletePage: React.FC = () => {
    const navigate = useNavigate();

    // Prevent user from going back to the test
    useAntiBacktrack({
        enabled: true,
        allowedRoutes: ['/test-complete'],
        terminateOnViolation: false,
    });

    const handleGoHome = () => {
        navigate('/');
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#f6ffed',
            padding: '20px'
        }}>
            <Result
                icon={<SmileOutlined />}
                status="success"
                title="🎉 You have completed your interview!"
                subTitle="Your responses have been recorded and will be reviewed by the evaluation team. Thank you for your participation."
                extra={
                    <Button
                        type="primary"
                        icon={<HomeOutlined />}
                        size="large"
                        onClick={handleGoHome}
                    >
                        Return to Home
                    </Button>
                }
            />
        </div>
    );
};

export default TestCompletePage;
