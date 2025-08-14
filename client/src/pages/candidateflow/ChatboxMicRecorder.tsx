// frontend/src/components/ChatboxMicRecorder.tsx
import React, { useState, useRef } from "react";
import { Button, Space, Card, message, Spin } from "antd";
import { useParams } from "react-router-dom";
import WaveformVisualizer from "./WaveformVisualizer";
import apiService from "../../service/apiService";

interface ChatboxMicRecorderProps {
  // Fires right after Whisper finishes (so parent can enable "Next question")
  onTranscriptionReady: (text: string) => void;
  // Fires when candidate clicks "Save Answer" (still no GPT call here)
  onSave: (text: string) => void;
}

const ChatboxMicRecorder: React.FC<ChatboxMicRecorderProps> = ({
  onTranscriptionReady,
  onSave,
}) => {
  const { token } = useParams<{ token: string }>();
  const [messageApi, contextHolder] = message.useMessage();

  const [recording, setRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [finalTranscript, setFinalTranscript] = useState<string>("");
  const [retryCount, setRetryCount] = useState(0);
  const [hasSaved, setHasSaved] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  const startRecording = async () => {
    if (retryCount >= 1 && audioURL) {
      messageApi.error("No more retries allowed.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setAudioStream(stream);

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;
      audioChunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioURL(url);

        if (!token) {
          messageApi.error("Missing test token in URL.");
          return;
        }

        // 🔹 Transcribe only (no GPT here)
        setLoadingTranscript(true);
        try {
          const { transcription } = await apiService.transcribeAudio(token, blob);
          if (transcription?.trim()) {
            setFinalTranscript(transcription.trim());
            onTranscriptionReady(transcription.trim());
          } else {
            messageApi.error("No transcription returned from server.");
          }
        } catch (err) {
          console.error("Transcription error:", err);
          messageApi.error("Failed to transcribe audio. Please try again.");
        } finally {
          setLoadingTranscript(false);
        }
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
      messageApi.error("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    audioStream?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  const handleSave = () => {
    if (!finalTranscript) {
      messageApi.warning("Please record an answer before saving");
      return;
    }
    // ✅ Do NOT call GPT here. We only confirm the transcript and re-enable controls.
    onSave(finalTranscript);
    setHasSaved(true);
    messageApi.success("Answer saved. You can go to the next question when ready.");
  };

  const handleClearResponse = () => {
    if (retryCount >= 1) {
      messageApi.warning("You've already used your retry. Only one retry is allowed.");
      return;
    }
    setFinalTranscript("");
    setAudioURL(null);
    setRetryCount((prev) => prev + 1);
    setHasSaved(false);
    messageApi.info(`Answer cleared. You have ${1 - retryCount} retry remaining.`);
  };

  const anyDisabled = recording || loadingTranscript;

  return (
    <>
      {contextHolder}
      <div className="chatBox">
        <Card title="Your Answer">
          {recording && (
            <div style={{ width: "100%", overflowX: "hidden", marginBottom: 16 }}>
              {audioStream && <WaveformVisualizer stream={audioStream} isActive={recording} />}
            </div>
          )}

          {audioURL && (
            <div style={{ marginBottom: 16 }}>
              <audio controls src={audioURL} style={{ width: "100%" }}>
                Your browser does not support the audio element.
              </audio>
            </div>
          )}

          {/* Show the transcribed text (Whisper result) */}
          {finalTranscript && (
            <div style={{ marginBottom: 16, textAlign: "left" }}>
              <strong>Transcription:</strong> {finalTranscript}
            </div>
          )}

          {loadingTranscript && <Spin style={{ margin: "10px 0" }} tip="Transcribing..." />}

          <Space>
            {!recording && !hasSaved && (
              <Button type="primary" onClick={startRecording} disabled={recording || loadingTranscript}>
                🎙️ Start Recording
              </Button>
            )}
            {recording && (
              <Button danger onClick={stopRecording} disabled={!recording || loadingTranscript}>
                ⏹️ Stop Recording
              </Button>
            )}
            {finalTranscript && !recording && !hasSaved && (
              <>
                <Button type="primary" onClick={handleSave} disabled={loadingTranscript || recording || !finalTranscript}>
                  💾 Save Answer
                </Button>
                <Button onClick={handleClearResponse} disabled={loadingTranscript || recording || retryCount >= 1}>
                  🗑️ Clear Response
                </Button>
              </>
            )}
          </Space>

          {retryCount > 0 && !hasSaved && (
            <div style={{ marginTop: 10, color: "#ff4d4f" }}>
              Retries remaining: {1 - retryCount}
            </div>
          )}
          {hasSaved && (
            <div style={{ marginTop: 10, color: "#52c41a" }}>
              ✓ Answer saved. Use “Next question” to proceed.
            </div>
          )}
        </Card>
      </div>
    </>
  );
};

export default ChatboxMicRecorder;
