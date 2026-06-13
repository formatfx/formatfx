/**
 * lib.ts — the `formatfx` npm package surface: the UI-free engine, curated.
 *
 * Everything here runs headlessly (the unit tests import it in node).
 * Deliberately NOT exported: the renderer (it builds real DOM — the sandbox
 * at https://formatfx.dev IS the renderer) and anything from src/editor
 * (the app shell). The expression evaluator note: a handful of tokens
 * (@window.innerWidth/…) read from a browser at CALL time; linting never
 * evaluates, so the CLI stays pure.
 */

// schema + document types
export type {
  SPElement, SPExpr, ElmType, FormatterDocument, DocumentKind,
  CustomRowAction, CustomCardProps, SPViewFormatter, SPTileFormatter,
  MockField, MockRow, FieldType, CellValue, PersonValue, LookupValue, NodePath,
} from './core/types';
export { SCHEMA_URLS } from './core/types';

// JSON ⇄ document, with the Zero-Whitespace and CSOM-safe options
export {
  importJson, exportJson, treeHasNames, detectKindLabel,
  type ExportOptions,
} from './core/serializer';

// the teaching linter — the reason this package exists
export {
  lintDocument, stripExpressionWhitespace,
  type LintIssue, type Severity,
} from './core/linter';

// the expression engine (both syntaxes: Excel-style strings + AST objects)
export {
  parseExpression, evaluate, evalAny, evaluateToString, parseForEach,
  ExpressionError, type EvalContext, type SPValue,
} from './core/expressions';

// allow-lists and vocabulary
export {
  ELM_TYPES, ALLOWED_ATTRIBUTES, ALLOWED_STYLES, KNOWN_UNSUPPORTED_STYLES,
  SP_FUNCTIONS, SPECIAL_TOKENS,
} from './core/schema';

// list schema import — all four formats, incl. the List Snapshot
export {
  importSchema, mapSpFieldType, buildSampleRows, sampleValue,
  isListSnapshot, LIST_SNAPSHOT_VERSION,
  type ImportedSchema, type ImportedView,
} from './core/schemaImport';

// Fluent theme emulation (CSS generation is pure; injection is the app's job)
export { themePalette, buildThemeCss, parseThemeJson } from './core/theme';

// the Tier-0 connectivity bridge (docs/CONNECTIVITY.md)
export {
  buildExtractSnippet, EXPAND_CAP, type ExtractSnippetOptions,
} from './bridge/extractSnippet';
export {
  buildDeploySnippet, type DeploySnippetOptions,
} from './bridge/deploySnippet';
