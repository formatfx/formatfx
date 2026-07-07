import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { state } from './state';

it('probe default looks', () => {
  const out = {
    keys: Object.keys(state.columnLooks),
    status: state.columnLooks['Status'],
    owner: state.columnLooks['Owner'],
    progress: state.columnLooks['Progress'],
    floorCh1: state.floorDoc.root.children![1],
    floorNames: state.floorDoc.root.children!.map((c) => c._elmName),
    floorFields: state.floorDoc.root.children!.map((c) => c._field),
  };
  writeFileSync('/tmp/claude-0/-home-user-formatfx/143c38f7-7284-5ee5-a99d-ed47554555ed/scratchpad/probe.json', JSON.stringify(out, null, 1));
  expect(true).toBe(true);
});
