import React, { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';

const TTS_API_BASE = import.meta.env.VITE_TTS_API_URL || '';

const TtsAudioTestPage = () => {
  const audioRef = useRef(null);
  const [message, setMessage] = useState('Ready');
  const [lastUrl, setLastUrl] = useState('');
  const [ssbrId, setSsbrId] = useState('A102');
  const [objectUrl, setObjectUrl] = useState('');

  const setAudioBlob = async (blob) => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    const nextObjectUrl = URL.createObjectURL(blob);
    setObjectUrl(nextObjectUrl);
    setLastUrl(nextObjectUrl);

    const audio = audioRef.current;
    if (!audio) return;

    audio.src = nextObjectUrl;
    audio.load();
    await audio.play();
  };

  const readErrorMessage = async (response) => {
    try {
      const data = await response.json();
      return data.detail || data.error || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  };

  const generateAudio = async () => {
    const cleaned = ssbrId.trim();
    if (!cleaned) {
      setMessage('SSBR ID wajib diisi');
      return;
    }

    setMessage('Generate audio...');
    try {
      const response = await fetch(`${TTS_API_BASE}/tts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssbr_id: cleaned }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = await response.json();
      setMessage(`Audio dibuat: ${data.path_mp3}`);
    } catch (err) {
      setMessage(`Generate gagal: ${err.message}`);
    }
  };

  const playNextAudio = async () => {
    const url = `${TTS_API_BASE}/tts/audio/next?t=${Date.now()}`;
    setLastUrl(url);
    setMessage('Mengambil audio...');

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('audio')) {
        throw new Error(`Response bukan audio: ${contentType || '-'}`);
      }

      const blob = await response.blob();
      await setAudioBlob(blob);
      setMessage('Audio sedang diputar');
    } catch (err) {
      setMessage(`Tidak bisa play audio: ${err.message}`);
    }
  };

  useEffect(() => {
    playNextAudio();
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  return (
    <div>
      <h1><Volume2 size={24} /> TTS Audio Test</h1>
      <p>{message}</p>
      <input
        value={ssbrId}
        onChange={(e) => setSsbrId(e.target.value)}
        placeholder="SSBR ID"
      />
      <button type="button" onClick={generateAudio}>Generate test audio</button>
      <button type="button" onClick={playNextAudio}>
        <Volume2 size={16} /> Play next announcement
      </button>
      <p>URL: {lastUrl || '-'}</p>
      <audio ref={audioRef} controls onEnded={() => setMessage('Audio selesai')} />
    </div>
  );
};

export default TtsAudioTestPage;
