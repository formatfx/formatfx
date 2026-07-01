
## 2024-05-18 - [Add AST cache for expressions]
**Learning:** SharePoint expressions are evaluated on every render of a node's property (txtContent, style, attributes), causing redundant string parsing. In the AST evaluation process `parseExpression` gets called very frequently for the exact same expression string.
**Action:** Implemented a simple, bounded `Map` cache (`_AST_CACHE`) in `src/core/expressions.ts` inside the `evaluate` function. When an expression is seen, its parsed AST is cached up to a maximum of 2000 entries (cleared if exceeded to prevent memory leaks). This avoids repeatedly parsing identical expressions, boosting render performance significantly.
