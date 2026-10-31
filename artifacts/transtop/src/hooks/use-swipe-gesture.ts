import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from 'react';

export const UNLOCK = 0.85;
export const STEP = 10;

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Right-to-left card swipe. Progress lives in a ref (source of truth) mirrored into state for rendering. */
export function useSwipeGesture(onDone: () => void, inset = 16) {
  const track = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const drag = useRef<{ id: number; startX: number; startP: number } | null>(null);
  const latched = useRef(false);
  const timer = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [p, setPState] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [travel, setTravel] = useState(1);

  const setP = (v: number) => { progress.current = v; setPState(v); };

  const measure = useCallback(() => {
    const t = track.current, c = card.current;
    const m = t && c ? Math.max(1, t.clientWidth - c.offsetWidth - inset) : 1;
    setTravel(m);
    return m;
  }, [inset]);

  const finish = useCallback(() => {
    if (latched.current) return;
    latched.current = true;
    drag.current = null;
    setDragging(false);
    setP(1);
    setLeaving(true);
    timer.current = window.setTimeout(() => doneRef.current(), prefersReducedMotion() ? 0 : 650);
  }, []);

  const cancel = useCallback(() => {
    if (latched.current) return;
    drag.current = null;
    setDragging(false);
    setP(0);
  }, []);

  useEffect(() => {
    measure();
    card.current?.focus({ preventScroll: true });
    const onResize = () => { measure(); cancel(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (timer.current != null) clearTimeout(timer.current);
    };
  }, [measure, cancel]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (latched.current || !e.isPrimary || e.button !== 0 || drag.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    measure();
    drag.current = { id: e.pointerId, startX: e.clientX, startP: progress.current };
    setDragging(true);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || latched.current) return;
    const dx = d.startX - e.clientX; // leftward = positive
    setP(Math.min(1, Math.max(0, d.startP + dx / travel)));
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (progress.current >= UNLOCK) finish(); else setP(0);
  };
  const onPointerCancel = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current && drag.current.id === e.pointerId) cancel();
  };
  const onLostPointerCapture = onPointerCancel;
  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (latched.current) return;
    const pct = Math.round(progress.current * 100);
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.min(100, pct + STEP);
    else if (e.key === 'ArrowRight') next = Math.max(0, pct - STEP);
    else if (e.key === 'Home') next = 0;
    if (next === null) return;
    e.preventDefault();
    if (next >= 100) finish(); else setP(next / 100);
  };

  const pct = Math.round(p * 100);
  return {
    track, card, p, pct, dragging, leaving, travel,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onKeyDown },
  };
}
