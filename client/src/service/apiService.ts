// frontend/src/services/apiService.ts - Updated for Flask Backend

export const API_BASE_URL = window.location.origin;


interface StageAccessResponse {
  allowed: boolean;
  redirect?: string | number;
  message?: string;
  current_stage?: number;
  token_state?: {
    current_stage: number;
    stages: {
      1: string;
      2: string;
      3: string;
    };
    terminated: boolean;
    completed: boolean;
  };
  session_data?: {
    candidate_name: string;
    duration: number;
    num_questions: number;
    role_subject: string;
    email: string;
  };
}

interface TestConfig {
  token: string;
  candidate_name: string;
  email: string;
  phone: string;
  experience_level: string;
  role_subject: string;
  difficulty: string;
  duration: number;
  num_questions: number;
  created_at: string;
  status: string;
}

interface ViolationData {
  type: string;
  timestamp?: string;
  details?: string;
}

interface InterviewResponse {
  questions_remaining: number;
  response_text: string;
  audio_url: string;
  question_number: number;
  is_complete?: boolean;
}

interface TranscribeResponse {
  transcription: string;
}

interface CredentialsData {
  name: string;
  email: string;
  domain: string;
}


class ApiService {
  private async fetchWithAuth(url: string, options: RequestInit = {}) {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
      // credentials: 'include',  Important for Flask sessions
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // ✅ EXISTING FLASK ENDPOINTS (Compatible)

  async processText(text: string) {
    const response = await fetch(`${API_BASE_URL}/api/process_text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `TTS request failed: ${response.status}`);
    }

    return response.json();
  }


  async getTestConfig(token: string): Promise<TestConfig> {
    return this.fetchWithAuth(`/api/test/${token}/config`);
  }


  async logAnswer(token: string, question: string, answer: string,) {
    return this.fetchWithAuth(`/api/test/${token}/log-answer`, {
      method: 'POST',
      body: JSON.stringify({ question, answer }),
    });
  }

  async uploadSnapshot(token: string, blob: Blob) {
    const formData = new FormData();
    formData.append('snapshot', blob, `snapshot_${Date.now()}.png`);

    const response = await fetch(`${API_BASE_URL}/api/test/${token}/snapshot`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Failed to upload snapshot');
    }

    return response.json();
  }



  async saveCredentials(credentials: CredentialsData) {
    return this.fetchWithAuth('/api/save_credentials', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  async startInterview(token: string): Promise<InterviewResponse> {
    return this.fetchWithAuth(`/api/test/${token}/start-interview`, {
      method: 'POST',
    });
  }

  async submitTextAnswer(token: string, text: string): Promise<InterviewResponse> {
    return this.fetchWithAuth(`/api/test/${token}/submit-text`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async transcribeAudio(token: string, audioBlob: Blob): Promise<TranscribeResponse> {
    const formData = new FormData();
    formData.append('file', audioBlob, 'answer.webm');

    const response = await fetch(`${API_BASE_URL}/api/test/${token}/submit-audio`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  async fetchNextQuestion(token: string): Promise<InterviewResponse> {
    return this.fetchWithAuth(`/api/test/${token}/next-question`, {
      method: 'POST'
    });
  }


  // ✅ TOKEN VALIDATION (Already exists in Flask)
  async checkTokenAccess(token: string, stage: number): Promise<StageAccessResponse> {
    return this.fetchWithAuth(`/api/test/${token}/validate/${stage}`);
  }

  // ❌ MISSING ENDPOINTS - Need to be added to Flask backend
  async updateTokenStage(token: string, stage: number, status: 'in_progress' | 'complete') {
    return this.fetchWithAuth(`/api/test/${token}/update-stage`, {
      method: 'POST',
      body: JSON.stringify({ stage, status }),
    });
  }

  async recordViolation(token: string, violation: ViolationData) {
    return this.fetchWithAuth(`/api/test/${token}/violations`, {
      method: 'POST',
      body: JSON.stringify(violation),
    });
  }

  // async getTestConfig(token: string) {
  //   return this.fetchWithAuth(`/api/test/${token}/config`);
  // }

  async saveInterview(token: string, interviewData: any): Promise<any> {
    return this.fetchWithAuth(`/api/test/${token}/save-interview`, {
      method: 'POST',
      body: JSON.stringify(interviewData),
    });
  }

  async terminateTest(token: string, reason: string) {
    return this.fetchWithAuth(`/api/test/${token}/terminate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async getTestStatus(token: string) {
    return this.fetchWithAuth(`/api/test/${token}/status`);
  }

  async createTest(testData: any) {
    return this.fetchWithAuth('/admin/create-test', {
      method: 'POST',
      body: JSON.stringify(testData),
    });
  }

  // Helper method to get audio file URL
  getAudioUrl(audioPath: string): string {
    return `${API_BASE_URL}/audio/${encodeURIComponent(audioPath)}`;
  }
}

export default new ApiService();