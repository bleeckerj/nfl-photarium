import { describe, expect, it } from 'vitest';

import { resolveDraftDateFilter } from '@/components/DateNavigator';

describe('DateNavigator date filter drafting', () => {
  it('does not resolve an empty draft into a committed filter', () => {
    expect(resolveDraftDateFilter(null, null)).toBeNull();
  });

  it('resolves a single selected day into a one-day filter', () => {
    expect(resolveDraftDateFilter('2026-02-03', null)).toEqual({
      startDate: '2026-02-03',
      endDate: '2026-02-03',
    });
  });

  it('normalizes reversed date ranges before commit', () => {
    expect(resolveDraftDateFilter('2026-02-05', '2026-02-01')).toEqual({
      startDate: '2026-02-01',
      endDate: '2026-02-05',
    });
  });
});
