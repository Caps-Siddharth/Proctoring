import React, { useState, useEffect } from 'react';
import {
  Form,
  Input,
  Select,
  Button,
  Card,
  Typography,
  message,
  Divider,
  InputNumber,
} from 'antd';
import axios from 'axios';

const { Title, Text } = Typography;
const { Option } = Select;

const ROLE_OPTIONS = [
  { label: 'Web Development', value: 'WebDevelopment' },
  { label: 'Python', value: 'Python' },
  { label: 'HR', value: 'HR' },
  { label: 'Marketing', value: 'Marketing' },
  { label: 'AI/ML', value: 'AI/ML' },
];

const AdminForm: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testLink, setTestLink] = useState('');

  useEffect(() => {
    form.setFieldsValue({
      difficulty: 'easy',
      experience_level: 'junior',
      duration: 60,
      numQuestions: 5,
      role_subject: 'WebDevelopment',
    });
  }, [form]);

  // Strip non-digits and clamp to length 10 while typing
  const onlyDigitsMax10 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    return digits;
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const response = await axios.post('/admin/create-test', values);
      const token = response?.data?.token;

      if (token) {
        setTestLink(`${window.location.origin}/test/${token}`);
        message.success('Test created successfully!');
      } else {
        message.error('Test created but no token received.');
      }
    } catch (err) {
      message.error('Error creating test. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #ece9e6, #ffffff)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
      }}
    >
      <Card
        style={{
          width: '600px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          borderRadius: '12px',
        }}
      >
        <Title level={3} style={{ textAlign: 'center', marginBottom: '24px' }}>
          Create New Test
        </Title>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          size="middle"
          requiredMark={false}
        >
          <Form.Item
            name="candidate_name"
            label="Candidate Name"
            hasFeedback
            rules={[
              { required: true, message: 'Please enter the name' },
              {
                validator: (_, value) =>
                  value && value.trim().length >= 5
                    ? Promise.resolve()
                    : Promise.reject(new Error('Name must be at least 5 characters')),
              },
            ]}
          >
            <Input placeholder="John Doe" maxLength={80} />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            hasFeedback
            rules={[
              { required: true, message: 'Please enter the email' },
              { type: 'email', message: 'Invalid email address' },
            ]}
          >
            <Input placeholder="john@example.com" />
          </Form.Item>

          <Form.Item
            name="phone"
            label="Phone Number"
            hasFeedback
            getValueFromEvent={onlyDigitsMax10}
            rules={[
              { required: true, message: 'Please enter the phone number' },
              {
                pattern: /^\d{10}$/,
                message: 'Phone must be exactly 10 digits',
              },
            ]}
          >
            <Input
              placeholder="9876543210"
              inputMode="numeric"
              maxLength={10}
              autoComplete="tel"
            />
          </Form.Item>

          <Form.Item
            name="experience_level"
            label="Experience Level"
            hasFeedback
            rules={[{ required: true, message: 'Please select an experience level' }]}
          >
            <Select>
              <Option value="junior">Junior</Option>
              <Option value="mid">Mid</Option>
              <Option value="senior">Senior</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="role_subject"
            label="Role / Subject"
            hasFeedback
            rules={[{ required: true, message: 'Please select the role or subject' }]}
          >
            <Select
              options={ROLE_OPTIONS}
              placeholder="Select a role/subject"
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item
            name="difficulty"
            label="Difficulty Level"
            hasFeedback
            rules={[{ required: true, message: 'Please select a difficulty' }]}
          >
            <Select>
              <Option value="easy">Easy</Option>
              <Option value="medium">Medium</Option>
              <Option value="hard">Hard</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="duration"
            label="Test Duration (in minutes)"
            hasFeedback
            rules={[
              { required: true, message: 'Please set a duration' },
              {
                validator: (_, value) =>
                  Number.isInteger(value) && value > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('Duration must be a positive integer')),
              },
            ]}
          >
            <InputNumber
              placeholder="e.g., 60"
              min={1}
              max={600}
              style={{ width: '100%' }}
              step={1}
              stringMode={false}
            />
          </Form.Item>

          <Form.Item
            name="numQuestions"
            label="Number of Questions"
            hasFeedback
            rules={[
              { required: true, message: 'Please set number of questions' },
              {
                validator: (_, value) =>
                  Number.isInteger(value) && value > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('Number of questions must be a positive integer')),
              },
            ]}
          >
            <InputNumber
              placeholder="e.g., 5"
              min={1}
              max={100}
              style={{ width: '100%' }}
              step={1}
              stringMode={false}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={{ width: '100%' }}
            >
              {loading ? 'Creating Test...' : 'Create Test'}
            </Button>
          </Form.Item>

          {testLink && (
            <>
              <Divider />
              <Text strong>Candidate Test Link:</Text>
              <div style={{ wordBreak: 'break-all', marginTop: '8px' }}>
                <a href={testLink} target="_blank" rel="noopener noreferrer">
                  {testLink}
                </a>
              </div>
            </>
          )}
        </Form>
      </Card>
    </div>
  );
};

export default AdminForm;
