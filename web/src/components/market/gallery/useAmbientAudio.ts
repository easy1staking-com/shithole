"use client";

import { useEffect, useRef } from "react";

/**
 * Procedural ambience — no audio files. Three layers, all synthesized
 * with WebAudio the first time the player locks in (browsers require a
 * user gesture before audio, and pointer lock IS one):
 *
 *   1. brown-noise rumble through a lowpass — condemned-building air
 *   2. a detuned 55/110Hz hum — dying electrics behind the neon
 *   3. random echoey drips every few seconds — the building leaks
 *
 * While the pointer is unlocked the context suspends (menus are quiet);
 * relocking resumes it. Everything closes on unmount.
 */
export function useAmbientAudio(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const dripTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      ctxRef.current?.suspend().catch(() => {});
      return;
    }
    if (ctxRef.current) {
      ctxRef.current.resume().catch(() => {});
      return;
    }
    if (typeof AudioContext === "undefined") return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.05;
    master.connect(ctx.destination);

    // --- 1. brown-noise rumble ------------------------------------
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseLp = ctx.createBiquadFilter();
    noiseLp.type = "lowpass";
    noiseLp.frequency.value = 320;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    noise.connect(noiseLp).connect(noiseGain).connect(master);
    noise.start();

    // --- 2. electrical hum ------------------------------------------
    const humGain = ctx.createGain();
    humGain.gain.value = 0.1;
    humGain.connect(master);
    for (const [freq, level] of [
      [55, 1],
      [110, 0.45],
      [110.7, 0.3], // slight detune = the buzz beats
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(humGain);
      osc.start();
    }

    // --- 3. drips through a feedback-delay "echo" --------------------
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.28;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.45;
    delay.connect(feedback).connect(delay);
    delay.connect(master);

    const drip = () => {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1100 + Math.random() * 500, t0);
      osc.frequency.exponentialRampToValueAtTime(350, t0 + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.connect(g);
      g.connect(master);
      g.connect(delay);
      osc.start(t0);
      osc.stop(t0 + 0.12);
      dripTimer.current = setTimeout(drip, 2500 + Math.random() * 7000);
    };
    dripTimer.current = setTimeout(drip, 1500);
  }, [active]);

  // Teardown only on unmount.
  useEffect(
    () => () => {
      if (dripTimer.current) clearTimeout(dripTimer.current);
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    },
    [],
  );
}
