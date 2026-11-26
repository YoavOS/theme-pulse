import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVolumeData } from './useVolumeData';

const state = vi.hoisted(() => ({ awake: true }));
vi.mock('@/lib/appSleep', () => ({ isAwake: () => state.awake, onWake: () => () => {} }));
const symbols = Array.from({ length: 31 }, (_, i) => `S${i}`);
const answer = (url: string) => ({
  ok: true,
  json: async () => ({ results: url.split('=')[1].split(',').map(symbol => ({ symbol, today_vol: 100, avg_20d: 100, avg_10d: 100, avg_3m: 100 })) }),
}) as Response;

beforeEach(() => {
  vi.useFakeTimers();
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => cache.set(key, value),
    removeItem: (key: string) => cache.delete(key),
  });
  state.awake = true;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('dashboard volume queue', () => {
  it('never duplicates in-flight symbols and sends only one batch at a time', async () => {
    let release!: (r: Response) => void;
    const fetcher = vi.fn((url: string) => fetcher.mock.calls.length === 1
      ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(answer(url)));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useVolumeData);
    act(() => result.current.fetchVolume(symbols));
    await act(() => vi.advanceTimersByTimeAsync(300));
    act(() => result.current.fetchVolume(symbols));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { release(answer(fetcher.mock.calls[0][0])); });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetcher).toHaveBeenCalledTimes(3);
    const sent = fetcher.mock.calls.flatMap(([url]) => url.split('=')[1].split(','));
    expect(sent).toEqual(symbols);
    expect(Object.keys(result.current.volumeMap)).toHaveLength(31);
  });

  it('pauses pending work while hidden and resumes when visible', async () => {
    const fetcher = vi.fn(async (url: string) => answer(url));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useVolumeData);
    state.awake = false;
    act(() => result.current.fetchVolume(symbols));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetcher).not.toHaveBeenCalled();
    state.awake = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('cancels pending work on navigation away', async () => {
    const fetcher = vi.fn(async (url: string) => answer(url));
    vi.stubGlobal('fetch', fetcher);
    const { result, unmount } = renderHook(useVolumeData);
    act(() => result.current.fetchVolume(symbols));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
