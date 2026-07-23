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
/** Shared context for one-shot effects (rat extermination). */
let fxCtx: AudioContext | null = null;

/** Squeak + wet pop. Called from a click handler, so autoplay is fine. */
export function playRatSplat() {
  if (typeof AudioContext === "undefined") return;
  try {
    fxCtx ??= new AudioContext();
  } catch {
    return;
  }
  const ctx = fxCtx;
  ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;

  // Death squeak — a fast falling sawtooth.
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(1600, t0);
  osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.1);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.1, t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  osc.connect(og).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.14);

  // Wet pop — a decaying lowpassed noise burst.
  const len = Math.floor(ctx.sampleRate * 0.12);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 550;
  const g = ctx.createGain();
  g.gain.value = 0.3;
  src.connect(lp).connect(g).connect(ctx.destination);
  src.start(t0 + 0.02);
}

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
