/**
 * core/types.ts — SharePoint List Formatting schema types.
 *
 * Self-contained (no imports from outside Workbench/) so the sandbox can be
 * lifted into a community repo (e.g. pnp/List-Formatting) as a standalone tool.
 *
 * Modeled on the official schema:
 * https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json
 * https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json
 */

export type ElmType =
  | 'div' | 'span' | 'a' | 'img' | 'button' | 'p'
  | 'svg' | 'path' | 'filepreview';

export interface CustomRowAction {
  action:
    | 'defaultClick' | 'share' | 'delete' | 'editProps'
    | 'openContextMenu' | 'setValue' | 'embed' | 'executeFlow' | '';
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
  txtContent?: SPExpr;
  style?: Record<string, SPExpr | undefined>;
  attributes?: Record<string, SPExpr | undefined>;
  children?: SPElement[];
  forEach?: string;
  customRowAction?: CustomRowAction;
  customCardProps?: CustomCardProps;
  inlineEditField?: string;
  columnFormatterReference?: string;
  defaultHoverField?: string;
  debugMode?: boolean;
  /** Provenance metadata (TwFw builder convention) — ignored by SharePoint. */
  _elmName?: string;
  _factory?: string;
  _debug?: Record<string, unknown>;
}

/** Root wrapper for a list-view (row) formatter. */
export interface SPViewFormatter {
  $schema?: string;
  hideSelection?: boolean;
  hideColumnHeader?: boolean;
  hideListHeader?: boolean;
  additionalRowClass?: string;
  commandBarProps?: { commands: Array<{ key: string; hide?: boolean; text?: string; position?: number }> };
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

export type DocumentKind = 'column' | 'row' | 'tile';

/** What the editor holds: one element tree + wrapper metadata. */
export interface FormatterDocument {
  kind: DocumentKind;
  root: SPElement;
  /** row formatter extras */
  hideSelection?: boolean;
  hideColumnHeader?: boolean;
  /** tile formatter extras */
  tileWidth?: number;
  tileHeight?: number;
  fillHorizontally?: boolean;
}

export const SCHEMA_URLS: Record<DocumentKind, string> = {
  column: 'https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json',
  row: 'https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json',
  tile: 'https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json',
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
