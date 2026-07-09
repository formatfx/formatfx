// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/commandBar.test.ts — the contract for the command-bar hide brain
 * (docs/superpowers/specs/2026-07-09-view-chrome-workshop-design.md §A3).
 *
 * A LOGICAL BUTTON bundles every key alias Microsoft has used for one
 * command-bar button (the docs' rename table + the pnp commandbar-hide-all
 * field pattern). Hiding emits hide:true on EVERY alias; un-hiding removes
 * only the managed `hide` and cleans up empty entries/objects. Anything the
 * module doesn't own — unknown keys, text/iconName/position customizations,
 * commandBarProps siblings, other viewExtras keys — survives byte-for-byte.
 */

import { describe, it, expect } from 'vitest';
import {
  COMMAND_GROUPS, COMMAND_BUTTONS, COMMAND_PRESETS, commandButtonById,
  readCommandState, setCommandHidden, applyCommandPreset, hiddenCommandCount,
} from './commandBar';
import { importJson, exportJson } from './serializer';
import type { FormatterDocument } from './types';

type Extras = Record<string, unknown> | undefined;
const commandsOf = (extras: Extras): Array<Record<string, unknown>> =>
  ((extras?.commandBarProps as { commands?: Array<Record<string, unknown>> } | undefined)?.commands ?? []);
const entryFor = (extras: Extras, key: string): Record<string, unknown> | undefined =>
  commandsOf(extras).find((c) => c.key === key);

describe('the command catalog', () => {
  it('has five groups, 50+ buttons, and no duplicate ids or keys', () => {
    expect(COMMAND_GROUPS.length).toBe(5);
    expect(COMMAND_BUTTONS.length).toBeGreaterThanOrEqual(50);
    const ids = COMMAND_BUTTONS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = COMMAND_BUTTONS.flatMap((b) => [...b.keys]);
    expect(new Set(keys).size).toBe(keys.length); // an alias belongs to exactly one button
    for (const g of COMMAND_GROUPS) expect(g.buttons.length).toBeGreaterThan(0);
    // the flat list is exactly the groups, flattened in order
    expect(COMMAND_BUTTONS).toEqual(COMMAND_GROUPS.flatMap((g) => g.buttons));
  });

  it('carries the owner-example buttons with their full alias sets', () => {
    expect(commandButtonById('new')?.keys).toEqual(['new', 'newComposite']);
    expect(commandButtonById('rules')?.keys).toContain('rulesCommand');
    expect(commandButtonById('upload')?.keys).toContain('UploadCommand'); // the renamed key rides along
    expect(commandButtonById('properties')?.keys).toEqual(['properties', 'propertiesCommand']);
  });

  it('presets reference only real button ids; hideAll covers every button; showAll none', () => {
    const ids = new Set(COMMAND_BUTTONS.map((b) => b.id));
    for (const p of COMMAND_PRESETS) for (const id of p.hiddenIds) expect(ids.has(id)).toBe(true);
    expect(COMMAND_PRESETS.find((p) => p.id === 'hideAll')?.hiddenIds.length).toBe(COMMAND_BUTTONS.length);
    expect(COMMAND_PRESETS.find((p) => p.id === 'showAll')?.hiddenIds.length).toBe(0);
    // the owner's scenario: entry stays open, rules machinery stays, grid edit goes
    const entry = new Set(COMMAND_PRESETS.find((p) => p.id === 'entryOnly')!.hiddenIds);
    expect(entry.has('new')).toBe(false);
    expect(entry.has('rules')).toBe(false);
    expect(entry.has('alertMe')).toBe(false);
    expect(entry.has('editInGridView')).toBe(true);
    expect(entry.has('share')).toBe(true);
    // declutter keeps the work, hides the upsell
    const declutter = new Set(COMMAND_PRESETS.find((p) => p.id === 'declutter')!.hiddenIds);
    expect(declutter.has('powerApps')).toBe(true);
    expect(declutter.has('new')).toBe(false);
    expect(declutter.has('rules')).toBe(false);
  });
});

describe('readCommandState', () => {
  it('reads nothing from empty extras', () => {
    expect(readCommandState(undefined).hidden.size).toBe(0);
    expect(readCommandState({}).hidden.size).toBe(0);
    expect(hiddenCommandCount(undefined)).toBe(0);
  });

  it('maps any hidden alias back to its logical button', () => {
    const state = readCommandState({
      commandBarProps: { commands: [{ key: 'newComposite', hide: true }] },
    });
    expect(state.hidden.has('new')).toBe(true);
  });

  it('treats a formula hide as formula-driven, not hidden', () => {
    const state = readCommandState({
      commandBarProps: { commands: [{ key: 'share', hide: "=if([$Confidential]=='Yes',true,false)" }] },
    });
    expect(state.hidden.has('share')).toBe(false);
    expect(state.formula.has('share')).toBe(true);
  });
});

describe('setCommandHidden', () => {
  it('hiding emits hide:true on every alias of the button', () => {
    const next = setCommandHidden(undefined, 'upload', true);
    const keys = commandButtonById('upload')!.keys;
    expect(commandsOf(next).length).toBe(keys.length);
    for (const k of keys) expect(entryFor(next, k)).toEqual({ key: k, hide: true });
  });

  it('un-hiding removes only the managed hide, keeps customizations, drops empties', () => {
    let extras: Extras = setCommandHidden(undefined, 'upload', true);
    // simulate a foreign customization riding one alias entry
    entryFor(extras, 'upload')!.text = 'Add a file';
    extras = setCommandHidden(extras, 'upload', false);
    // the customized entry survives without its hide; bare entries are gone
    expect(entryFor(extras, 'upload')).toEqual({ key: 'upload', text: 'Add a file' });
    expect(entryFor(extras, 'UploadCommand')).toBeUndefined();
    // nothing else managed → only the customized entry remains
    expect(commandsOf(extras).length).toBe(1);
  });

  it('drops commands, commandBarProps and viewExtras itself when they empty out', () => {
    let extras: Extras = setCommandHidden(undefined, 'share', true);
    extras = setCommandHidden(extras, 'share', false);
    expect(extras).toBeUndefined();
    // …but keeps unrelated viewExtras keys
    let extras2: Extras = setCommandHidden({ additionalRowClass: 'zebra' }, 'share', true);
    extras2 = setCommandHidden(extras2, 'share', false);
    expect(extras2).toEqual({ additionalRowClass: 'zebra' });
  });

  it('preserves foreign command entries and commandBarProps siblings untouched', () => {
    const foreign = { key: 'SpfxCustomActionNavigationCommand_abc123CMD_2', hide: true };
    const start: Extras = {
      commandBarProps: { commands: [{ ...foreign }], someFutureProp: 7 },
      hideListHeader: true,
    };
    let extras = setCommandHidden(start, 'new', true);
    extras = setCommandHidden(extras, 'new', false);
    expect(entryFor(extras, foreign.key)).toEqual(foreign);
    expect((extras!.commandBarProps as Record<string, unknown>).someFutureProp).toBe(7);
    expect(extras!.hideListHeader).toBe(true);
  });

  it('an explicit toggle overwrites a formula hide with the boolean', () => {
    const start: Extras = {
      commandBarProps: { commands: [{ key: 'share', hide: '=1==1' }] },
    };
    const next = setCommandHidden(start, 'share', true);
    expect(entryFor(next, 'share')).toEqual({ key: 'share', hide: true });
    expect(readCommandState(next).formula.has('share')).toBe(false);
  });

  it('does not mutate its input', () => {
    const start: Extras = { commandBarProps: { commands: [{ key: 'new', hide: true }] } };
    const frozen = JSON.stringify(start);
    setCommandHidden(start, 'share', true);
    setCommandHidden(start, 'new', false);
    applyCommandPreset(start, 'hideAll');
    expect(JSON.stringify(start)).toBe(frozen);
  });
});

describe('applyCommandPreset', () => {
  it('replaces the managed hide set wholesale', () => {
    let extras = applyCommandPreset(undefined, 'entryOnly');
    let state = readCommandState(extras);
    expect(state.hidden.has('editInGridView')).toBe(true);
    expect(state.hidden.has('new')).toBe(false);
    // a second preset does not accumulate — hides not in the new preset clear
    extras = applyCommandPreset(extras, 'declutter');
    state = readCommandState(extras);
    expect(state.hidden.has('editInGridView')).toBe(false);
    expect(state.hidden.has('powerApps')).toBe(true);
  });

  it('showAll clears every managed hide but leaves foreign entries alone', () => {
    const foreign = { key: 'SpfxCustomActionNavigationCommand_abc123CMD_2', hide: true };
    let extras: Extras = { commandBarProps: { commands: [{ ...foreign }] } };
    extras = applyCommandPreset(extras, 'hideAll');
    expect(hiddenCommandCount(extras)).toBe(COMMAND_BUTTONS.length);
    extras = applyCommandPreset(extras, 'showAll');
    expect(hiddenCommandCount(extras)).toBe(0);
    expect(commandsOf(extras)).toEqual([foreign]);
  });
});

describe('serializer round trip', () => {
  it('a preset survives export → import → read', () => {
    const doc: FormatterDocument = {
      kind: 'row',
      root: { elmType: 'div' },
      viewExtras: applyCommandPreset(undefined, 'entryOnly'),
    };
    const reimported = importJson(exportJson(doc));
    const state = readCommandState(reimported.viewExtras);
    const want = new Set(COMMAND_PRESETS.find((p) => p.id === 'entryOnly')!.hiddenIds);
    expect(state.hidden).toEqual(want);
  });
});
