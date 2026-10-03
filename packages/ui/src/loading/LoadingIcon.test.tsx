import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LoadingIcon from './LoadingIcon.jsx';
Object.assign(globalThis, { React });

let reduce = false;
beforeEach(() => {
  reduce = false;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') && reduce, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.className = ''; });
const moving = (container: HTMLElement) => container.querySelector('svg')!.getAttribute('data-loading-icon') === 'moving';

it('animates unless the system or the host asks for reduced motion, and reads no host class', () => {
  const { container, rerender } = render(<LoadingIcon />);
  expect(moving(container)).toBe(true);
  expect(container.querySelectorAll('animate').length).toBeGreaterThan(0);
  // A host's own class on <html> is the host's business: only the explicit prop counts.
  document.documentElement.classList.add('reduce-motion');
  rerender(<LoadingIcon key="class" />);
  expect(moving(container)).toBe(true);
  rerender(<LoadingIcon key="prop" reducedMotion />);
  expect(moving(container)).toBe(false);
  expect(container.querySelectorAll('animate').length).toBe(0);
  reduce = true;
  rerender(<LoadingIcon key="system" />);
  expect(moving(container)).toBe(false);
});

it('holds a still pose when inactive and stays decorative', () => {
  const { container } = render(<LoadingIcon active={false} size={24} />);
  const svg = container.querySelector('svg')!;
  expect(moving(container)).toBe(false);
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.getAttribute('width')).toBe('24');
});
