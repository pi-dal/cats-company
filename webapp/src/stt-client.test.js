import {
  createPCM16Capture,
  releaseReusableMicrophoneStream,
  StreamingSTTSession,
} from './stt-client';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.sent = [];
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('StreamingSTTSession', () => {
  afterEach(() => {
    releaseReusableMicrophoneStream();
  });

  it('reuses an authorized microphone stream for consecutive foreground captures', async () => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    const originalAudioContext = globalThis.AudioContext;
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    const track = {
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      addEventListener: vi.fn(),
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const contexts = [];

    class FakeAudioContext {
      constructor() {
        this.state = 'running';
        this.audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
        this.close = vi.fn().mockResolvedValue(undefined);
        this.source = { connect: vi.fn(), disconnect: vi.fn() };
        contexts.push(this);
      }

      createMediaStreamSource() {
        return this.source;
      }
    }

    class FakeAudioWorkletNode {
      constructor() {
        this.port = { onmessage: null };
        this.disconnect = vi.fn();
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    globalThis.AudioContext = FakeAudioContext;
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    try {
      const firstCapture = await createPCM16Capture({ onFrame: vi.fn() });
      firstCapture.stop();
      expect(track.enabled).toBe(false);

      const secondCapture = await createPCM16Capture({ onFrame: vi.fn() });
      secondCapture.stop();

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(contexts).toHaveLength(2);
      expect(track.stop).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('pagehide'));
      expect(track.stop).toHaveBeenCalledTimes(1);
    } finally {
      releaseReusableMicrophoneStream();
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
      else delete navigator.mediaDevices;
      if (originalAudioContext === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = originalAudioContext;
      if (originalAudioWorkletNode === undefined) delete globalThis.AudioWorkletNode;
      else globalThis.AudioWorkletNode = originalAudioWorkletNode;
    }
  });

  it('buffers PCM before ready and publishes only the final transcript', async () => {
    let emitFrame;
    const capture = { stop: vi.fn() };
    const partials = [];
    const finals = [];
    const sockets = [];
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-1', max_session_seconds: 90 }),
      createCapture: vi.fn(async ({ onFrame }) => {
        emitFrame = onFrame;
        return capture;
      }),
      createWebSocket: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
      resolveWebSocketURL: (ticket) => `wss://app.catsco.cc/api/stt/realtime?ticket=${ticket}`,
      onPartial: (text) => partials.push(text),
      onFinal: (text) => finals.push(text),
    });

    const starting = session.start();
    await Promise.resolve();
    emitFrame(new Uint8Array([1, 2, 3, 4]).buffer);
    await starting;

    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toHaveLength(0);
    sockets[0].open();
    sockets[0].receive({ type: 'ready', max_session_seconds: 90 });
    expect(sockets[0].sent[0]).toBeInstanceOf(ArrayBuffer);

    sockets[0].receive({ type: 'partial', text: '你好' });
    expect(partials).toEqual(['你好']);
    expect(finals).toEqual([]);

    sockets[0].receive({ type: 'final', text: '你好世界' });
    expect(finals).toEqual(['你好世界']);
    expect(capture.stop).toHaveBeenCalledTimes(1);
  });

  it('flushes the newest coalesced partial before publishing the final transcript', async () => {
    const partials = [];
    const finals = [];
    let socket;
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-flush', max_session_seconds: 90 }),
      createCapture: vi.fn().mockResolvedValue({ stop: vi.fn() }),
      createWebSocket: () => {
        socket = new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime?ticket=ticket-flush');
        return socket;
      },
      onPartial: (text) => partials.push(text),
      onFinal: (text) => finals.push(text),
    });

    await session.start();
    socket.open();
    socket.receive({ type: 'ready' });
    socket.receive({ type: 'partial', text: '第一段' });
    socket.receive({ type: 'partial', text: '最新的一段' });
    socket.receive({ type: 'final', text: '最终文字' });

    expect(partials).toEqual(['第一段', '最新的一段']);
    expect(finals).toEqual(['最终文字']);
  });

  it('maps capture RMS through the VoicePi-style decibel curve', async () => {
    let emitLevel;
    const levels = [];
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-level' }),
      createCapture: vi.fn(async ({ onLevel }) => {
        emitLevel = onLevel;
        return { stop: vi.fn() };
      }),
      createWebSocket: () => new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime'),
      onAudioLevel: (level) => levels.push(level),
    });

    await session.start();
    emitLevel(0.002);
    emitLevel(0.1);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[1]).toBeGreaterThan(levels[0]);
    expect(levels[1]).toBeLessThanOrEqual(1);
    session.cancel();
  });

  it('fails closed when browser websocket backpressure exceeds the audio buffer limit', async () => {
    let emitFrame;
    let socket;
    const errors = [];
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-2', max_session_seconds: 90 }),
      createCapture: vi.fn(async ({ onFrame }) => {
        emitFrame = onFrame;
        return { stop: vi.fn() };
      }),
      createWebSocket: (url) => {
        socket = new FakeWebSocket(url);
        return socket;
      },
      resolveWebSocketURL: () => 'wss://app.catsco.cc/api/stt/realtime?ticket=ticket-2',
      onError: (error) => errors.push(error.message),
    });

    await session.start();
    socket.open();
    socket.receive({ type: 'ready' });
    socket.bufferedAmount = 200_000;
    emitFrame(new Uint8Array([1, 2]).buffer);

    expect(errors).toEqual(['网络较慢，语音输入已停止']);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('stops capture when cancelled while microphone startup is pending', async () => {
    let resolveCapture;
    const capture = { stop: vi.fn() };
    const session = new StreamingSTTSession({
      createCapture: vi.fn(() => new Promise((resolve) => { resolveCapture = resolve; })),
      createSession: vi.fn(),
    });

    const starting = session.start();
    session.cancel();
    resolveCapture(capture);
    await starting;

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(session.createSession).not.toHaveBeenCalled();
    expect(session.state).toBe('cancelled');
  });

  it('keeps a release requested during session admission until the final transcript arrives', async () => {
    let resolveSession;
    let socket;
    const finals = [];
    const capture = { stop: vi.fn() };
    const session = new StreamingSTTSession({
      createCapture: vi.fn().mockResolvedValue(capture),
      createSession: vi.fn(() => new Promise((resolve) => {
        resolveSession = resolve;
      })),
      createWebSocket: () => {
        socket = new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime?ticket=admission-stop');
        return socket;
      },
      onFinal: (text) => finals.push(text),
    });

    const starting = session.start();
    await Promise.resolve();
    await session.stop();

    resolveSession({ ticket: 'admission-stop' });
    await starting;

    expect(socket).not.toBeUndefined();
    socket.open();
    socket.receive({ type: 'ready' });
    expect(socket.sent).toContain(JSON.stringify({ type: 'stop' }));

    socket.receive({ type: 'final', text: '松手后的最终文字' });
    expect(finals).toEqual(['松手后的最终文字']);
    expect(capture.stop).toHaveBeenCalledTimes(1);
  });

  it('does not admit a voice session after capture was stopped during microphone startup', async () => {
    let resolveCapture;
    const capture = { stop: vi.fn() };
    const session = new StreamingSTTSession({
      createCapture: vi.fn(() => new Promise((resolve) => { resolveCapture = resolve; })),
      createSession: vi.fn(),
    });

    const starting = session.start();
    await session.stop();
    resolveCapture(capture);
    await starting;

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(session.createSession).not.toHaveBeenCalled();
    expect(session.state).toBe('complete');
  });

  it('fails and releases the session when finalizing never reaches a terminal event', async () => {
    vi.useFakeTimers();
    let socket;
    const errors = [];
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-stalled-final', max_session_seconds: 150 }),
      createCapture: vi.fn().mockResolvedValue({ stop: vi.fn() }),
      createWebSocket: () => {
        socket = new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime?ticket=ticket-stalled-final');
        return socket;
      },
      onError: (error) => errors.push(error.message),
    });

    try {
      await session.start();
      socket.open();
      socket.receive({ type: 'ready', max_session_seconds: 150 });
      await session.stop();

      expect(session.state).toBe('finalizing');
      vi.advanceTimersByTime(5000);

      expect(session.state).toBe('error');
      expect(errors).toEqual(['语音识别结束超时，请重试']);
      expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    } finally {
      vi.useRealTimers();
      session.cancel();
    }
  });

  it('surfaces structured websocket admission errors', async () => {
    let socket;
    const errors = [];
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-quota', max_session_seconds: 150 }),
      createCapture: vi.fn().mockResolvedValue({ stop: vi.fn() }),
      createWebSocket: () => {
        socket = new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime?ticket=ticket-quota');
        return socket;
      },
      onError: (error) => errors.push(error.message),
    });

    await session.start();
    socket.open();
    socket.receive({
      type: 'error',
      code: 'quota_exhausted',
      message: '语音输入额度已用完，请稍后再试',
    });

    expect(session.state).toBe('error');
    expect(errors).toEqual(['语音输入额度已用完，请稍后再试']);
  });

  it('maps other structured websocket admission errors to actionable messages', async () => {
    let socket;
    const errors = [];
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-active', max_session_seconds: 150 }),
      createCapture: vi.fn().mockResolvedValue({ stop: vi.fn() }),
      createWebSocket: () => {
        socket = new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime?ticket=ticket-active');
        return socket;
      },
      onError: (error) => errors.push(error.message),
    });

    await session.start();
    socket.open();
    socket.receive({ type: 'error', code: 'session_active', message: 'internal detail' });

    expect(errors).toEqual(['已有语音输入正在进行']);
  });

  it('uses the precise remaining duration returned after websocket admission', async () => {
    vi.useFakeTimers();
    let socket;
    const capture = { stop: vi.fn() };
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-precise-limit', max_session_ms: 150_000 }),
      createCapture: vi.fn().mockResolvedValue(capture),
      createWebSocket: () => {
        socket = new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime?ticket=ticket-precise-limit');
        return socket;
      },
    });

    try {
      await session.start();
      socket.open();
      socket.receive({ type: 'ready', max_session_ms: 25 });
      vi.advanceTimersByTime(25);

      expect(session.state).toBe('finalizing');
      expect(capture.stop).toHaveBeenCalledTimes(1);
    } finally {
      session.cancel();
      vi.useRealTimers();
    }
  });

  it('keeps the session duration when an older ready event omits duration fields', async () => {
    vi.useFakeTimers();
    let socket;
    const capture = { stop: vi.fn() };
    const session = new StreamingSTTSession({
      createSession: vi.fn().mockResolvedValue({ ticket: 'ticket-legacy-ready', max_session_ms: 25 }),
      createCapture: vi.fn().mockResolvedValue(capture),
      createWebSocket: () => {
        socket = new FakeWebSocket('wss://app.catsco.cc/api/stt/realtime?ticket=ticket-legacy-ready');
        return socket;
      },
    });

    try {
      await session.start();
      socket.open();
      socket.receive({ type: 'ready' });
      vi.advanceTimersByTime(25);

      expect(session.state).toBe('finalizing');
      expect(capture.stop).toHaveBeenCalledTimes(1);
    } finally {
      session.cancel();
      vi.useRealTimers();
    }
  });
});
