import React, { useEffect, useRef } from "react";

interface WaveformVisualizerProps {
  stream: MediaStream;
  isActive: boolean;
}
export interface conversations{
  question: string;
  answer: string;
}

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  stream,
  isActive,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive || !stream) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 2048;

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    canvas.width = 200;
    canvas.height = 100;

    const draw = () => {
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1890ff";
      ctx.beginPath();

      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current!);
      audioContext.close();
    };
  }, [stream, isActive]);

  return <canvas ref={canvasRef} style={{ display: "block", marginTop: 8 }} />;
};

export default WaveformVisualizer;
