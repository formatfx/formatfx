// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * core/commandBar.ts — the command-bar hide brain (pure, node-tested;
 * commandBar.test.ts is the contract).
 *
 * SharePoint's `commandBarProps.commands[{key, hide}]` is the only way to
 * hide command-bar buttons — there is no "hide the bar" boolean. Microsoft
 * has RENAMED several keys mid-flight (learn.microsoft.com
 * view-commandbar-formatting, "Recent updates" table), and the field-proven
 * pattern (pnp commandbar-hide-all) is to emit BOTH the old and new keys so
 * a hide keeps working across rollout waves. So the UI deals in LOGICAL
 * BUTTONS: one button = every alias key it has ever had. Hiding emits
 * hide:true on every alias; un-hiding removes only the managed `hide`.
 *
 * Anything this module doesn't own survives byte-for-byte: unknown keys
 * (SPFx ListView Command Set customs), per-entry customizations (text,
 * iconName, position…), commandBarProps siblings, and other viewExtras keys.
 * SP silently ignores hides on keys a surface doesn't show, so the catalog
 * can safely span lists AND libraries.
 */

export interface CommandButton {
  /** Stable FormatFX id — NOT a SharePoint key. */
  id: string;
  /** The button's UI name, as SharePoint labels it. */
  label: string;
  /** Every `commands[].key` alias that addresses this button. */
  keys: readonly string[];
  /** Optional teaching hint (menu-parents, non-obvious scopes). */
  hint?: string;
}

export interface CommandGroup {
  id: string;
  label: string;
  buttons: readonly CommandButton[];
}

const b = (id: string, label: string, keys: readonly string[], hint?: string): CommandButton =>
  hint ? { id, label, keys, hint } : { id, label, keys };

export const COMMAND_GROUPS: readonly CommandGroup[] = [
  {
    id: 'toolbar',
    label: 'List toolbar',
    buttons: [
      b('new', 'New', ['new', 'newComposite'], 'the + New button and its menu'),
      b('editInGridView', 'Edit in grid view', ['editInGridView']),
      b('exitGridView', 'Exit grid view', ['exitGridView']),
      b('undoGrid', 'Undo (grid editing)', ['undo']),
      b('share', 'Share', ['share']),
      b('copyLink', 'Copy link', ['copyLink']),
      b('export', 'Export (menu)', ['export'], 'hides the whole Export menu'),
      b('exportExcel', 'Export to Excel', ['exportExcel']),
      b('exportCSV', 'Export to CSV', ['exportCSV']),
    ],
  },
  {
    id: 'automate',
    label: 'Automate & alerts',
    buttons: [
      b('automate', 'Automate (menu)', ['automate'], 'hides the whole menu: rules, Quick steps, flows'),
      b('rules', 'Rules', ['automateCreateRule', 'automateManageRules', 'rulesCommand'], 'Create a rule / Manage rules'),
      b('quickSteps', 'Quick steps', ['quickStepsCommand']),
      b('flows', 'Power Automate flows', ['powerAutomate', 'powerAutomateCreateFlow', 'powerAutomateSeeFlows', 'powerAutomateConfigureFlows']),
      b('workflows', 'Workflows (classic)', ['workflowsCommand']),
      b('approvals', 'Approvals', ['approvalsCommand', 'requestApprovalCommand']),
      b('alertMe', 'Alert me', ['alertMe']),
      b('manageAlert', 'Manage my alerts', ['manageAlert']),
    ],
  },
  {
    id: 'integrate',
    label: 'Integrate & AI',
    buttons: [
      b('integrate', 'Integrate (menu)', ['integrate'], 'hides the whole menu: Power Apps, Power BI, AI Builder'),
      b('powerApps', 'Power Apps', ['powerApps', 'powerAppsCreateApp', 'powerAppsSeeAllApps', 'powerAppsCustomizeForms']),
      b('powerBI', 'Power BI', ['powerBI', 'powerBIVisualizeList']),
      b('aiBuilder', 'AI Builder', ['aiBuilder', 'aiBuilderCreate', 'aiBuilderGoto']),
      b('copilot', 'Copilot agent', ['createCopilot']),
      b('forms', 'Microsoft Forms', ['manageForms']),
      b('syntex', 'Syntex / Classify & extract', ['classifyAndExtract', 'viewDocumentUnderstandingModels', 'syntexTranslateCommand']),
    ],
  },
  {
    id: 'items',
    label: 'Item & selection',
    buttons: [
      b('editItem', 'Edit', ['edit'], 'appears when items are selected'),
      b('deleteItem', 'Delete', ['delete']),
      b('comment', 'Comment', ['comment']),
      b('openItem', 'Open', ['open']),
      b('properties', 'Properties', ['properties', 'propertiesCommand']),
      b('versionHistory', 'Version history', ['versionHistory', 'versionHistoryCommand']),
      b('pinItem', 'Pin to top', ['pinItem', 'pinItemCommand']),
      b('favorite', 'Favorite', ['favoriteCommand']),
      b('immersiveReader', 'Open in Immersive Reader', ['openInImmersiveReader']),
      b('teamsChannel', 'Go to channel in Teams', ['GoToChannelInTeams']),
      b('previewFile', 'Preview', ['previewFileCommand'], 'the right-click context menu entry'),
      b('compliance', 'Compliance details', ['complianceDetails']),
      b('moreMenu', 'More (context submenu)', ['more'], 'hides the whole right-click More submenu'),
    ],
  },
  {
    id: 'library',
    label: 'Library & files',
    buttons: [
      b('upload', 'Upload', ['upload', 'UploadCommand', 'uploadFile', 'uploadFileCommand', 'uploadFolder', 'uploadFolderCommand']),
      b('sync', 'Sync', ['sync', 'syncCommand']),
      b('addShortcut', 'Add shortcut to OneDrive', ['addShortcut', 'addShortcutToOneDriveCommand', 'stasherContextMenuCommand', 'stasherCommand.myFiles', 'stasherCommand.otherLocations']),
      b('pinToQuickAccess', 'Pin to Quick access', ['pinToQuickAccess', 'PinToQuickAccessCommand', 'unpinFromQuickAccess']),
      b('newFolder', 'New folder', ['newFolder']),
      b('newOffice', 'New Office documents', ['newWordDocument', 'newExcelWorkbook', 'newPowerPointPresentation', 'newOneNoteNotebook', 'newFormsForExcel', 'newVisioDrawing', 'newLink'], 'the New menu’s document types'),
      b('editNewMenu', 'Edit New menu', ['editNewMenu']),
      b('templates', 'New-menu templates', ['uploadTemplate', 'uploadTemplateCommand', 'addTemplate']),
      b('download', 'Download', ['download']),
      b('rename', 'Rename', ['rename']),
      b('copyTo', 'Copy to', ['copyTo']),
      b('moveTo', 'Move to', ['moveTo']),
      b('checkInOut', 'Check out / Check in', ['checkOut', 'checkIn', 'undoCheckOut']),
      b('openOnline', 'Open in Office (web)', ['openInOfficeOnline']),
      b('openDesktop', 'Open in Office (desktop)', ['openInOfficeClient']),
      b('publish', 'Publish', ['PublishCommand']),
    ],
  },
];

/** The groups, flattened in display order. */
export const COMMAND_BUTTONS: readonly CommandButton[] =
  COMMAND_GROUPS.flatMap((g) => [...g.buttons]);

const BY_ID = new Map(COMMAND_BUTTONS.map((btn) => [btn.id, btn]));
const BUTTON_BY_KEY = new Map(
  COMMAND_BUTTONS.flatMap((btn) => btn.keys.map((k) => [k, btn] as const)),
);

export function commandButtonById(id: string): CommandButton | undefined {
  return BY_ID.get(id);
}

export interface CommandPreset {
  id: 'hideAll' | 'showAll' | 'entryOnly' | 'readOnly' | 'declutter';
  label: string;
  hint: string;
  hiddenIds: readonly string[];
}

const ALL_IDS = COMMAND_BUTTONS.map((btn) => btn.id);
const except = (...visible: string[]): string[] => {
  const keep = new Set(visible);
  return ALL_IDS.filter((id) => !keep.has(id));
};

export const COMMAND_PRESETS: readonly CommandPreset[] = [
  {
    id: 'hideAll',
    label: 'Hide all',
    hint: 'Hide every button SharePoint lets a formatter hide — the embedded/kiosk look.',
    hiddenIds: ALL_IDS,
  },
  {
    id: 'showAll',
    label: 'Show all',
    hint: 'Back to SharePoint’s defaults — clears every hide this panel manages.',
    hiddenIds: [],
  },
  {
    id: 'entryOnly',
    label: 'Collect entries',
    hint: 'Keep + New and the rules/alerts machinery; hide editing, sharing, export and the rest.',
    hiddenIds: except('new', 'automate', 'rules', 'quickSteps', 'alertMe', 'manageAlert'),
  },
  {
    id: 'readOnly',
    label: 'Read only',
    hint: 'Hide anything that changes data; keep viewing, sharing, export and alerts.',
    hiddenIds: [
      'new', 'editInGridView', 'exitGridView', 'undoGrid', 'editItem', 'deleteItem',
      'properties', 'automate', 'rules', 'quickSteps', 'flows', 'workflows', 'approvals',
      'powerApps', 'aiBuilder', 'copilot', 'forms', 'syntex',
      'upload', 'newFolder', 'newOffice', 'editNewMenu', 'templates',
      'rename', 'copyTo', 'moveTo', 'checkInOut', 'publish',
    ],
  },
  {
    id: 'declutter',
    label: 'Declutter',
    hint: 'Hide the Power Platform / AI upsell; keep the working buttons, rules and alerts.',
    hiddenIds: [
      'integrate', 'powerApps', 'powerBI', 'aiBuilder', 'copilot', 'forms', 'syntex',
      'flows', 'workflows', 'teamsChannel',
    ],
  },
];

/** One commands[] entry — `key` plus whatever SharePoint/the user put there. */
type CommandEntry = { key?: unknown } & Record<string, unknown>;

const entriesOf = (extras: Record<string, unknown> | undefined): CommandEntry[] => {
  const cbp = extras?.commandBarProps;
  if (!cbp || typeof cbp !== 'object' || Array.isArray(cbp)) return [];
  const commands = (cbp as Record<string, unknown>).commands;
  if (!Array.isArray(commands)) return [];
  return commands.filter((c): c is CommandEntry => !!c && typeof c === 'object' && !Array.isArray(c));
};

export interface CommandBarState {
  /** Logical button ids with any alias at hide === true. */
  hidden: Set<string>;
  /** Logical button ids whose hide is expression-driven (string / AST object). */
  formula: Set<string>;
}

export function readCommandState(extras: Record<string, unknown> | undefined): CommandBarState {
  const hidden = new Set<string>();
  const formula = new Set<string>();
  for (const entry of entriesOf(extras)) {
    const btn = typeof entry.key === 'string' ? BUTTON_BY_KEY.get(entry.key) : undefined;
    if (!btn || entry.hide === undefined) continue;
    if (entry.hide === true) hidden.add(btn.id);
    else if (typeof entry.hide !== 'boolean') formula.add(btn.id);
  }
  return { hidden, formula };
}

export function hiddenCommandCount(extras: Record<string, unknown> | undefined): number {
  return readCommandState(extras).hidden.size;
}

/** Rebuild extras around a new commands list, dropping empty layers so the
 *  exported JSON stays clean (the additionalRowClass precedent). */
function withCommands(
  extras: Record<string, unknown> | undefined,
  commands: CommandEntry[],
): Record<string, unknown> | undefined {
  const prevCbp = extras?.commandBarProps;
  const siblings = prevCbp && typeof prevCbp === 'object' && !Array.isArray(prevCbp)
    ? Object.fromEntries(Object.entries(prevCbp as Record<string, unknown>).filter(([k]) => k !== 'commands'))
    : {};
  const next: Record<string, unknown> = { ...extras };
  if (commands.length || Object.keys(siblings).length) {
    next.commandBarProps = commands.length ? { ...siblings, commands } : { ...siblings };
  } else {
    delete next.commandBarProps;
  }
  return Object.keys(next).length ? next : undefined;
}

/** Set one logical button hidden/shown. Pure — returns the next viewExtras
 *  (undefined when it empties out); the caller owns the one undoable write. */
export function setCommandHidden(
  extras: Record<string, unknown> | undefined,
  id: string,
  hidden: boolean,
): Record<string, unknown> | undefined {
  const btn = BY_ID.get(id);
  if (!btn) return extras;
  const aliasKeys = new Set(btn.keys);
  let commands = entriesOf(extras).map((e) => ({ ...e }));
  if (hidden) {
    const present = new Set(
      commands.filter((e) => typeof e.key === 'string' && aliasKeys.has(e.key)).map((e) => e.key as string),
    );
    // flip existing alias entries (an explicit gesture overrides a formula)…
    commands = commands.map((e) =>
      typeof e.key === 'string' && aliasKeys.has(e.key) ? { ...e, hide: true } : e);
    // …and add the missing aliases in catalog order
    for (const k of btn.keys) {
      if (!present.has(k)) commands.push({ key: k, hide: true });
    }
  } else {
    commands = commands
      .map((e) => {
        if (typeof e.key !== 'string' || !aliasKeys.has(e.key)) return e;
        const { hide: _hide, ...rest } = e;
        return rest as CommandEntry;
      })
      // a bare { key } carries no information — drop it
      .filter((e) => !(typeof e.key === 'string' && aliasKeys.has(e.key) && Object.keys(e).length === 1));
  }
  return withCommands(extras, commands);
}

/** Apply a preset: the managed hide set becomes exactly the preset's. Foreign
 *  entries and non-`hide` customizations are untouched. */
export function applyCommandPreset(
  extras: Record<string, unknown> | undefined,
  presetId: CommandPreset['id'],
): Record<string, unknown> | undefined {
  const preset = COMMAND_PRESETS.find((p) => p.id === presetId);
  if (!preset) return extras;
  const target = new Set(preset.hiddenIds);
  let next = extras;
  for (const btn of COMMAND_BUTTONS) {
    next = setCommandHidden(next, btn.id, target.has(btn.id));
  }
  return next;
}
