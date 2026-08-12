let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  return audioCtx;
}

export class AudioFeedbackService {
  /**
   * Generates a basic tone of specified frequency (Hz), duration (ms), and gain (volume).
   */
  public static playBeep(frequency: number, durationMs: number, type: OscillatorType = 'sine', volume = 0.1): Promise<void> {
    return new Promise((resolve) => {
      const ctx = getAudioContext();
      if (!ctx) {
        resolve();
        return;
      }

      // Resume context if suspended (common browser security constraint)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      try {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);

        // Gain/Volume fade out to prevent speaker clicks/pops
        gainNode.gain.setValueAtTime(volume, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + durationMs / 1000);

        osc.onended = () => {
          osc.disconnect();
          gainNode.disconnect();
          resolve();
        };
      } catch (e) {
        console.warn('Audio feedback failed to play:', e);
        resolve();
      }
    });
  }

  /**
   * Plays a crisp high-pitched single beep for success (1100 Hz, 80 ms)
   */
  public static async playSuccessBeep(): Promise<void> {
    await this.playBeep(1100, 80, 'sine', 0.15);
  }

  /**
   * Plays a double low-pitched warning beep for errors (380 Hz, 120 ms, pause, 380 Hz, 120 ms)
   */
  public static async playErrorBeep(): Promise<void> {
    await this.playBeep(380, 120, 'triangle', 0.2);
    await new Promise((r) => setTimeout(r, 60)); // Short silence interval
    await this.playBeep(380, 120, 'triangle', 0.2);
  }
}
