// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * core/types.ts — SharePoint List Formatting schema types.
 *
 * Self-contained (no imports from outside Workbench/) so the sandbox can be
 * lifted into a community repo (e.g. pnp/List-Formatting) as a standalone tool.
 *
 * Modeled on the official schema:
 * https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json
 * https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json
 */

export type ElmType =
  | 'div' | 'span' | 'a' | 'img' | 'button' | 'p'
  | 'svg' | 'path' | 'filepreview';

export interface CustomRowAction {
  action:
    // the published v2 column-formatting schema set
    | 'defaultClick' | 'share' | 'delete' | 'editProps'
    | 'openContextMenu' | 'setValue' | 'embed' | 'executeFlow'
    // runtime-accepted on lists AND libraries — verified working samples in
    // pnp/List-Formatting column-samples/generic-rowactions (issue #286)
    | 'copyLink' | 'comment' | 'openApprovalDialog'
    // runtime-accepted, DOCUMENT-LIBRARY only — do nothing on a plain list
    // (same PnP source; the linter says so instead of letting them fail silently)
    | 'previewFileAction' | 'copyFile' | 'moveFile'
    // unpublished/undocumented — fires an existing Quick Step by
    // actionInput.ruleTemplateId (docs/QUICK-STEPS.md §4.3); always
    // lint-warned as an undocumented identifier
    | 'executeQuickStep'
    | '';
  actionParams?: string;
  actionInput?: Record<string, unknown> | string;
}

export interface CustomCardProps {
  formatter: SPElement;
  openOnEvent: 'click' | 'hover';
  directionalHint?: string;
  isBeakVisible?: boolean;
  beakStyle?: Record<string, string>;
}

/**
 * An SP expression value. Two syntaxes are valid everywhere a value is
 * expected: Excel-style strings ("=if(...)") and the older object/tree
 * syntax ({"operator": "?", "operands": [...]}) used by many community
 * samples. Numbers and booleans are literals.
 */
export type SPExpr =
  | string | number | boolean
  | { operator: string; operands: SPExpr[] };

export interface SPElement {
  elmType: ElmType;
  /** Embed another column's LIVE formatter by reference ("[$FieldName]"; the
   *  bare "FieldName" form also appears in the wild). A real schema key that
   *  stands in for elmType on the element carrying it. The EDITOR never
   *  writes one (column looks are embedded clones since the model-B
   *  migration) but pasted JSON carrying it round-trips verbatim; the linter
   *  validates the referenced column instead of demanding elmType, and the
   *  preview renders a placeholder (HANDOFF §4 emulation gap). */
  columnFormatterReference?: string;
  txtContent?: SPExpr;
  style?: Record<string, SPExpr | undefined>;
  attributes?: Record<string, SPExpr | undefined>;
  children?: SPElement[];
  forEach?: string;
  customRowAction?: CustomRowAction;
  customCardProps?: CustomCardProps;
  inlineEditField?: string;
  defaultHoverField?: string;
  debugMode?: boolean;
  /** Provenance metadata (TwFw builder convention) — ignored by SharePoint. */
  _elmName?: string;
  _factory?: string;
  _debug?: Record<string, unknown>;
  /** Component-instance provenance (the ⬡ inventory): the ComponentDef id +
   *  the slot→column mapping this subtree was bound with. Ignored by
   *  SharePoint, stripped by keepMeta:false like _elmName. */
  _component?: { id: string; map: Record<string, string> };
  /** Component-NESTING placeholder (issue #225): names the embed record (its
   *  `ns`) this node stands in for inside a STORED component def's tree.
   *  flattenComponent replaces it before any bind/bake, so it never reaches a
   *  live document; stripped by keepMeta:false like the rest of the family. */
  _embed?: string;
  /** Which column a grid/view cell represents (editor meta, like _elmName —
   *  ignored by SharePoint, stripped by keepMeta:false). Column identity used
   *  to ride the § reference; a cell's look is embedded now, so the identity
   *  is stamped explicitly and survives multi-column looks. */
  _field?: string;
}

/** One command-bar customization entry (view-commandbar-formatting docs).
 *  `hide`/`text`/`title`/`iconName`/`primary`/`position` accept expressions
 *  (string or AST object) as well as literals; the catalog of `key` values —
 *  including Microsoft's rename aliases — lives in core/commandBar.ts. */
export interface SPCommandBarCommand {
  key: string;
  hide?: boolean | string | Record<string, unknown>;
  text?: string | Record<string, unknown>;
  title?: string | Record<string, unknown>;
  iconName?: string | Record<string, unknown>;
  primary?: boolean | string | Record<string, unknown>;
  position?: number | string | Record<string, unknown>;
  sectionType?: 'Primary' | 'Overflow';
  selectionModes?: Array<'NoSelection' | 'SingleSelection' | 'MultiSelection'>;
}

/** Root wrapper for a list-view (row) formatter. */
export interface SPViewFormatter {
  $schema?: string;
  hideSelection?: boolean;
  hideColumnHeader?: boolean;
  hideListHeader?: boolean;
  additionalRowClass?: string;
  commandBarProps?: { commands: SPCommandBarCommand[] };
  groupProps?: Record<string, unknown>;
  footerFormatter?: SPElement;
  rowFormatter?: SPElement;
}

/** Root wrapper for a gallery/tile formatter. */
export interface SPTileFormatter {
  $schema?: string;
  height?: number;
  width?: number;
  hideSelection?: boolean;
  fillHorizontally?: boolean;
  formatter: SPElement;
}

export type DocumentKind = 'column' | 'row' | 'tile' | 'grid';

/** What the editor holds: one element tree + wrapper metadata. */
export interface FormatterDocument {
  kind: DocumentKind;
  root: SPElement;
  /** row formatter extras */
  hideSelection?: boolean;
  hideColumnHeader?: boolean;
  /** Unmodeled view-formatter wrapper keys (footerFormatter, groupProps,
   *  commandBarProps, additionalRowClass, hideListHeader, …) carried verbatim
   *  through import → export so editing the rowFormatter never silently drops
   *  the parts the editor can't represent. */
  viewExtras?: Record<string, unknown>;
  /** tile formatter extras */
  tileWidth?: number;
  tileHeight?: number;
  fillHorizontally?: boolean;
}

export const SCHEMA_URLS: Record<DocumentKind, string> = {
  column: 'https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json',
  row: 'https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json',
  tile: 'https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json',
  // a grid is a row formatter in embryo — same wrapper, different canvas
  grid: 'https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json',
};

// ─── Mock data model ─────────────────────────────────────────────────────────

export type FieldType =
  | 'text' | 'note' | 'number' | 'currency' | 'choice' | 'choiceMulti'
  | 'date' | 'person' | 'personMulti' | 'boolean' | 'hyperlink'
  | 'lookup' | 'lookupMulti';

export interface PersonValue {
  title: string;
  email: string;
  picture?: string;
  sip?: string;
  id?: string;
  department?: string;
  jobTitle?: string;
}

/** SP lookup field value shape ([$Field.lookupValue] / [$Field.lookupId]). */
export interface LookupValue {
  lookupId: number;
  lookupValue: string;
}

export interface MockField {
  name: string;
  displayName?: string;
  type: FieldType;
  /** Lookup configuration — target list/column the lookup points at. */
  lookup?: { list: string; column: string };
  /** Read-only/system column (e.g. ID, Created, Modified) — locked in the data grid. */
  protected?: boolean;
  /** Choice options (choice/choiceMulti) — used for sample data + docs. */
  choices?: string[];
}

export type CellValue =
  | string | number | boolean | null
  | PersonValue | PersonValue[]
  | LookupValue | LookupValue[];

export interface MockRow {
  [field: string]: CellValue;
}

/** A path of child indices from the document root to a node. */
export type NodePath = number[];
