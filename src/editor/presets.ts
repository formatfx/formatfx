/**
 * editor/presets.ts — Element palette definitions.
 *
 * Two tiers:
 *  - Primitives: the raw schema building blocks.
 *  - Components: parameterized patterns distilled from the TwFw factory
 *    library (Formatters/lib) and years of community samples in
 *    pnp/List-Formatting (status pills, data bars, facepiles, action
 *    buttons, traffic lights, hover cards, date badges, ...).
 *
 * Every preset is a factory returning a fresh SPElement fragment wired to the
 * sandbox's default mock fields, so it renders meaningfully on first drop.
 */

import type { SPElement, MockField, FieldType } from '../core/types';

export interface PaletteItem {
  id: string;
  label: string;
  icon: string;          // Fluent icon name (also used to exercise icon rendering)
  group: 'Primitives' | 'Text & Status' | 'People' | 'Actions' | 'Data & Charts' | 'Layout Shells';
  description: string;
  /**
   * Shown in basic mode. The bar: something people actually reach for, that
   * drops in looking right, and that a misclick can't break — no forEach
   * shapes to mismatch, no actions to configure, no structure replaced.
   */
  basic?: boolean;
  create: () => SPElement;
}

const flex = (direction: 'row' | 'column', children: SPElement[] = []): SPElement => ({
  elmType: 'div',
  style: {
    'display': 'flex',
    'flex-direction': direction,
    'align-items': direction === 'row' ? 'center' : 'stretch',
  },
  children,
});

export const PALETTE: PaletteItem[] = [
  // ─── Primitives ────────────────────────────────────────────────────────────
  {
    id: 'div', label: 'Container', icon: 'CubeShape', group: 'Primitives',
    description: 'Generic div container',
    create: () => ({ elmType: 'div', style: { 'padding': '4px' }, children: [] }),
  },
  {
    id: 'hstack', label: 'Row (flex)', icon: 'DistributeRight', group: 'Primitives',
    description: 'Horizontal flex container. SP has no gap support — use child margins.',
    create: () => flex('row'),
  },
  {
    id: 'vstack', label: 'Column (flex)', icon: 'DistributeDown', group: 'Primitives',
    description: 'Vertical flex container',
    create: () => flex('column'),
  },
  {
    id: 'text', label: 'Text', icon: 'PlainText', group: 'Primitives', basic: true,
    description: 'Span bound to @currentField',
    create: () => ({ elmType: 'span', txtContent: '@currentField', style: { 'font-size': '13px' } }),
  },
  {
    id: 'icon', label: 'Icon', icon: 'Emoji2', group: 'Primitives', basic: true,
    description: 'Fluent UI icon via the iconName attribute (always pair with a title tooltip)',
    create: () => ({
      elmType: 'span',
      attributes: { iconName: 'CheckMark', title: 'Done' },
      style: { 'color': '#107c10', 'font-size': '14px' },
    }),
  },
  {
    id: 'link', label: 'Link', icon: 'Link', group: 'Primitives', basic: true,
    description: 'Anchor with target=_blank',
    create: () => ({
      elmType: 'a',
      txtContent: 'Open',
      attributes: { href: '=[$Link]', target: '_blank', class: 'ms-fontColor-themePrimary' },
      style: { 'text-decoration': 'none' },
    }),
  },
  {
    id: 'image', label: 'Image', icon: 'Photo2', group: 'Primitives', basic: true,
    description: 'img element',
    create: () => ({
      elmType: 'img',
      attributes: { src: "=getUserImage([$Owner.email],'M')", title: '=[$Owner.title]' },
      style: { 'width': '32px', 'height': '32px', 'border-radius': '50%' },
    }),
  },

  // ─── Text & Status ─────────────────────────────────────────────────────────
  {
    id: 'status-pill', label: 'Status pill', icon: 'StatusCircleInner', group: 'Text & Status', basic: true,
    description: 'Conditional colored pill (generic-issuestatus-pill / statusBadge pattern)',
    create: () => ({
      elmType: 'div',
      txtContent: "=if([$Status]=='','None',[$Status])",
      style: {
        'display': 'inline-flex', 'align-items': 'center', 'justify-content': 'center',
        'border-radius': '12px', 'padding': '2px 10px',
        'font-size': '12px', 'font-weight': '600', 'color': '#ffffff',
        'background-color': "=if([$Status]=='Done','#107c10',if([$Status]=='Blocked','#d13438',if([$Status]=='In Progress','#0078d4','#737a7f')))",
      },
    }),
  },
  {
    id: 'traffic-light', label: 'Traffic light', icon: 'CircleFill', group: 'Text & Status', basic: true,
    description: 'Dot + label severity indicator (generic-traffic-light-status)',
    create: () => flex('row', [
      {
        elmType: 'div',
        style: {
          'width': '10px', 'height': '10px', 'border-radius': '50%', 'margin-right': '6px',
          'background-color': "=if([$Status]=='Done','#107c10',if([$Status]=='Blocked','#d13438','#ffb900'))",
        },
      },
      { elmType: 'span', txtContent: '[$Status]', style: { 'font-size': '13px' } },
    ]),
  },
  {
    id: 'severity-class', label: 'Severity (SP classes)', icon: 'ShieldAlert', group: 'Text & Status',
    description: 'Theme-reactive severity background using sp-field-severity-- classes',
    create: () => ({
      elmType: 'div',
      txtContent: '[$Status]',
      attributes: {
        class: "=if([$Status]=='Done','sp-field-severity--good',if([$Status]=='Blocked','sp-field-severity--blocked','sp-field-severity--warning'))+' sp-field-customFormatBackground'",
      },
      style: { 'display': 'inline-block', 'border-radius': '4px', 'font-size': '12px' },
    }),
  },
  {
    id: 'tag-pills', label: 'Tag pills (forEach)', icon: 'Tag', group: 'Text & Status',
    description: 'Split a delimited field into pills (dynamic-colored-pills). NOTE: forEach+split only survives inside customCardProps in production columns — multi-choice fields iterate directly.',
    create: () => ({
      elmType: 'div',
      style: { 'display': 'flex', 'flex-wrap': 'wrap' },
      children: [{
        elmType: 'span',
        forEach: "_tag in split([$Tags],';')",
        txtContent: '=[$_tag]',
        attributes: { class: 'ms-bgColor-themeLighter ms-fontColor-themeDarker' },
        style: {
          'border-radius': '10px', 'padding': '2px 8px', 'margin': '2px', 'font-size': '11px',
        },
      }],
    }),
  },
  {
    id: 'date-badge', label: 'Due-date badge', icon: 'Calendar', group: 'Text & Status', basic: true,
    description: 'Red when overdue, neutral otherwise (date-range-rag pattern)',
    create: () => ({
      elmType: 'div',
      txtContent: "=toLocaleDateString([$DueDate])",
      attributes: {
        class: "=if([$DueDate]<=@now&&[$Status]!='Done','sp-field-severity--blocked ms-fontColor-redDark','ms-bgColor-neutralLighter ms-fontColor-neutralPrimary')",
      },
      style: {
        'display': 'inline-block', 'padding': '2px 8px', 'border-radius': '4px', 'font-size': '12px',
      },
    }),
  },
  {
    id: 'day-counter', label: 'Days-until counter', icon: 'Timer', group: 'Text & Status', basic: true,
    description: 'Day arithmetic via Number(date) milliseconds (date-day-counter)',
    create: () => ({
      elmType: 'span',
      txtContent: "=if([$DueDate]=='','',if(floor((Number([$DueDate])-Number(@now))/86400000)>=0,floor((Number([$DueDate])-Number(@now))/86400000)+' days left',abs(floor((Number([$DueDate])-Number(@now))/86400000))+' days overdue'))",
      style: { 'font-size': '12px', 'font-weight': '600' },
    }),
  },

  {
    id: 'lookup-chip', label: 'Lookup chip', icon: 'Relationship', group: 'Text & Status',
    description: 'Lookup field rendered as a chip — [$Field.lookupValue] / [$Field.lookupId]',
    create: () => ({
      elmType: 'a',
      txtContent: '[$Project.lookupValue]',
      attributes: {
        href: "='https://contoso.sharepoint.com/sites/sandbox/Lists/Projects/DispForm.aspx?ID='+[$Project.lookupId]",
        target: '_blank',
        title: "='Open '+[$Project.lookupValue]",
        class: 'ms-bgColor-themeLighterAlt ms-fontColor-themeDark ms-borderColor-themeLight',
      },
      style: {
        'display': 'inline-block', 'padding': '2px 10px', 'border-radius': '10px',
        'font-size': '12px', 'text-decoration': 'none',
        'border-width': '1px', 'border-style': 'solid',
      },
    }),
  },

  // ─── People ───────────────────────────────────────────────────────────────
  {
    id: 'persona', label: 'Persona', icon: 'Contact', group: 'People', basic: true,
    description: 'Avatar + display name for a single person field',
    create: () => flex('row', [
      {
        elmType: 'img',
        attributes: { src: "=getUserImage([$Owner.email],'S')", title: '=[$Owner.title]' },
        style: { 'width': '24px', 'height': '24px', 'border-radius': '50%', 'margin-right': '6px' },
      },
      { elmType: 'span', txtContent: '[$Owner.title]', style: { 'font-size': '13px' } },
    ]),
  },
  {
    id: 'facepile', label: 'Facepile', icon: 'People', group: 'People',
    description: 'Overlapping avatars for a multi-person field (forEach over the field)',
    create: () => ({
      elmType: 'div',
      style: { 'display': 'flex', 'align-items': 'center' },
      children: [{
        elmType: 'img',
        forEach: '_person in [$AssignedTo]',
        attributes: {
          src: "=getUserImage([$_person.email],'S')", title: '=[$_person.title]',
          class: 'ms-borderColor-white',
        },
        style: {
          'width': '26px', 'height': '26px', 'border-radius': '50%',
          'border-width': '2px', 'border-style': 'solid',
          'margin-left': "=if(loopIndex('_person')==0,'0','-8px')",
        },
      }],
    }),
  },
  {
    id: 'member-count', label: 'Member count', icon: 'PeopleAdd', group: 'People',
    description: '"N members" chip (memberCountBadge pattern)',
    create: () => flex('row', [
      { elmType: 'span', attributes: { iconName: 'People', title: 'Team size' }, style: { 'font-size': '12px', 'margin-right': '4px' } },
      { elmType: 'span', txtContent: "=length([$AssignedTo])+' members'", style: { 'font-size': '12px' } },
    ]),
  },

  // ─── Actions ──────────────────────────────────────────────────────────────
  {
    id: 'action-button', label: 'Action button', icon: 'TouchPointer', group: 'Actions',
    description: 'div role=button with a customRowAction (generic-action-buttons)',
    create: () => ({
      elmType: 'div',
      attributes: { role: 'button', title: 'Open the edit form', class: 'sp-field-quickActionButton ms-fontColor-themePrimary ms-borderColor-themePrimary' },
      customRowAction: { action: 'editProps' },
      style: {
        'display': 'inline-flex', 'align-items': 'center', 'cursor': 'pointer',
        'padding': '4px 10px', 'border-radius': '4px', 'font-size': '12px',
        'border-width': '1px', 'border-style': 'solid',
      },
      children: [
        { elmType: 'span', attributes: { iconName: 'Edit', title: 'Edit' }, style: { 'margin-right': '4px' } },
        { elmType: 'span', txtContent: 'Edit' },
      ],
    }),
  },
  {
    id: 'flow-button', label: 'Start Flow button', icon: 'Flow', group: 'Actions',
    description: 'executeFlow with actionParams (generic-start-flow)',
    create: () => ({
      elmType: 'button',
      txtContent: 'Send reminder',
      customRowAction: {
        action: 'executeFlow',
        actionParams: '{"id":"YOUR-FLOW-GUID","headerText":"Send reminder","runFlowButtonText":"Run"}',
      },
      attributes: { class: 'ms-bgColor-themePrimary' },
      style: {
        'border': 'none', 'color': '#ffffff',
        'padding': '5px 12px', 'border-radius': '4px', 'cursor': 'pointer', 'font-size': '12px',
      },
    }),
  },
  {
    id: 'setvalue-button', label: 'Set-value button', icon: 'CheckboxComposite', group: 'Actions',
    description: 'One-click field update (approval-buttons / date-button-setValue pattern)',
    create: () => ({
      elmType: 'div',
      attributes: { role: 'button', title: 'Mark this item Done' },
      customRowAction: { action: 'setValue', actionInput: { Status: 'Done' } },
      style: {
        'display': 'inline-flex', 'align-items': 'center', 'cursor': 'pointer',
        'padding': '4px 10px', 'border-radius': '4px', 'background-color': '#107c10',
        'color': '#ffffff', 'font-size': '12px',
      },
      children: [
        { elmType: 'span', attributes: { iconName: 'CheckMark', title: 'Mark done' }, style: { 'margin-right': '4px' } },
        { elmType: 'span', txtContent: 'Mark done' },
      ],
    }),
  },
  {
    id: 'mailto', label: 'Mail-to button', icon: 'Mail', group: 'Actions',
    description: 'mailto: link with subject/body (generic-mailto-button)',
    create: () => ({
      elmType: 'a',
      attributes: {
        href: "='mailto:'+[$Owner.email]+'?subject=Re: '+[$Title]",
        target: '_blank',
        title: 'Email the owner',
        class: 'ms-fontColor-themePrimary',
      },
      style: { 'text-decoration': 'none', 'font-size': '12px' },
      children: [{ elmType: 'span', attributes: { iconName: 'Mail', title: 'Email owner' } }],
    }),
  },
  {
    id: 'hover-card', label: 'Hover card trigger', icon: 'ContactCard', group: 'Actions',
    description: 'button elmType carrying customCardProps (custom-hover-card). txtContent goes directly on the button — children have been seen to swallow the click (an absolute overlay div is the other robust trigger).',
    create: () => ({
      elmType: 'button',
      txtContent: 'Details',
      customCardProps: {
        openOnEvent: 'click',
        directionalHint: 'bottomCenter',
        isBeakVisible: true,
        formatter: {
          elmType: 'div',
          style: { 'display': 'flex', 'flex-direction': 'column', 'padding': '12px', 'min-width': '220px' },
          children: [
            { elmType: 'span', txtContent: '[$Title]', attributes: { class: 'ms-fontColor-neutralPrimary' }, style: { 'font-size': '14px', 'font-weight': '600', 'margin-bottom': '6px' } },
            { elmType: 'span', txtContent: "='Status: '+[$Status]", attributes: { class: 'ms-fontColor-neutralSecondary' }, style: { 'font-size': '12px', 'margin-bottom': '2px' } },
            { elmType: 'span', txtContent: "='Due: '+toLocaleDateString([$DueDate])", attributes: { class: 'ms-fontColor-neutralSecondary' }, style: { 'font-size': '12px' } },
          ],
        },
      },
      attributes: { class: 'ms-bgColor-white ms-fontColor-neutralPrimary sp-css-borderColor-neutralTertiaryAlt' },
      style: {
        'border-width': '1px', 'border-style': 'solid', 'border-radius': '4px',
        'padding': '4px 10px', 'cursor': 'pointer', 'font-size': '12px',
      },
    }),
  },

  // ─── Data & Charts ────────────────────────────────────────────────────────
  {
    id: 'data-bar', label: 'Data bar', icon: 'BarChartHorizontal', group: 'Data & Charts', basic: true,
    description: 'Width-bound percentage bar (number-data-bar)',
    create: () => ({
      elmType: 'div',
      attributes: { class: 'ms-bgColor-neutralLighter' },
      style: { 'width': '120px', 'border-radius': '3px', 'overflow': 'hidden' },
      children: [{
        elmType: 'div',
        txtContent: "=[$Progress]+'%'",
        style: {
          'width': "=[$Progress]+'%'", 'min-width': '24px',
          'background-color': "=if([$Progress]>=100,'#107c10','#0078d4')",
          'color': '#ffffff', 'font-size': '11px', 'padding': '2px 4px', 'box-sizing': 'border-box',
        },
      }],
    }),
  },
  {
    id: 'progress-ring', label: 'Progress donut', icon: 'DonutChart', group: 'Data & Charts', basic: true,
    description: 'Conic-style donut faked with SVG stroke-dasharray (generic-gauge family)',
    create: () => ({
      elmType: 'div',
      style: { 'display': 'flex', 'align-items': 'center' },
      children: [
        {
          elmType: 'svg',
          attributes: { viewBox: '0 0 36 36' },
          style: { 'width': '32px', 'height': '32px' },
          children: [
            {
              elmType: 'path',
              attributes: { d: 'M18 2.5 a 15.5 15.5 0 1 1 0 31 a 15.5 15.5 0 1 1 0 -31' },
              style: { 'fill': 'none', 'stroke': '#f3f2f1', 'stroke-width': '4' },
            },
            {
              elmType: 'path',
              attributes: { d: 'M18 2.5 a 15.5 15.5 0 1 1 0 31 a 15.5 15.5 0 1 1 0 -31' },
              style: {
                'fill': 'none', 'stroke': "=if([$Progress]>=100,'#107c10','#0078d4')", 'stroke-width': '4',
                'stroke-dasharray': "=([$Progress]*97/100)+',100'",
              },
            },
          ],
        },
        { elmType: 'span', txtContent: "=[$Progress]+'%'", style: { 'font-size': '12px', 'margin-left': '6px' } },
      ],
    }),
  },
  {
    id: 'data-table', label: 'Key/value table', icon: 'Table', group: 'Data & Charts',
    description: 'CSS display:table spec sheet (dataTable factory pattern)',
    create: () => ({
      elmType: 'div',
      style: { 'display': 'table', 'width': '100%', 'border-collapse': 'collapse', 'table-layout': 'fixed' },
      children: [
        tableRow('Status', '[$Status]'),
        tableRow('Due', '=toLocaleDateString([$DueDate])'),
        tableRow('Progress', "=[$Progress]+'%'"),
        tableRow('Owner', '[$Owner.title]'),
      ],
    }),
  },
  {
    id: 'star-rating', label: 'Star rating', icon: 'FavoriteStarFill', group: 'Data & Charts', basic: true,
    description: 'Repeat icons via forEach over a padded string (generic-star-icon trick)',
    create: () => ({
      elmType: 'div',
      style: { 'display': 'flex' },
      children: [{
        elmType: 'span',
        forEach: "_star in split(padStart('',ceiling([$Progress]/20),'x'),'')",
        attributes: { iconName: 'FavoriteStarFill', title: 'Rating' },
        style: { 'color': '#ffb900', 'font-size': '13px' },
      }],
    }),
  },

  // ─── Layout shells ────────────────────────────────────────────────────────
  {
    id: 'row-card', label: 'Row card shell', icon: 'GroupedList', group: 'Layout Shells',
    description: 'Bordered card row for view formatters — theme classes only, so dark mode stays readable',
    create: () => ({
      elmType: 'div',
      attributes: { class: 'ms-bgColor-white sp-css-borderColor-neutralLight' },
      style: {
        'display': 'flex', 'flex-direction': 'column', 'width': '100%',
        'padding': '12px', 'margin': '6px 0', 'border-radius': '6px',
        'border-width': '1px', 'border-style': 'solid',
        'box-shadow': '0 1.6px 3.6px rgba(0,0,0,.13)',
      },
      children: [
        { elmType: 'span', txtContent: '[$Title]', attributes: { class: 'ms-fontColor-neutralPrimary' }, style: { 'font-size': '14px', 'font-weight': '600', 'margin-bottom': '4px' } },
        { elmType: 'span', txtContent: '[$Status]', attributes: { class: 'ms-fontColor-neutralSecondary' }, style: { 'font-size': '12px' } },
      ],
    }),
  },
  {
    id: 'tile-card', label: 'Gallery card (3-layer)', icon: 'GridViewMedium', group: 'Layout Shells',
    description: 'Canonical sp-card-container scaffold: container → click blocker → subContainer',
    create: () => ({
      elmType: 'div',
      attributes: { class: 'sp-card-container sp-card-showOnHoverParent' },
      children: [
        {
          elmType: 'div',
          attributes: { class: 'sp-card-defaultClickButton', role: 'button', title: 'Open item' },
          customRowAction: { action: 'defaultClick' },
        },
        {
          elmType: 'div',
          attributes: { class: 'sp-card-subContainer sp-card-borderHighlight ms-bgColor-white sp-css-borderColor-neutralLight' },
          children: [
            {
              elmType: 'div',
              attributes: { class: 'sp-card-displayColumnContainer' },
              children: [
                { elmType: 'p', txtContent: '[!Title.DisplayName]', attributes: { class: 'sp-card-label' } },
                { elmType: 'p', txtContent: '[$Title]', attributes: { class: 'sp-card-content sp-card-highlightedContent' } },
              ],
            },
            {
              elmType: 'div',
              attributes: { class: 'sp-card-displayColumnContainer' },
              children: [
                { elmType: 'p', txtContent: 'Status', attributes: { class: 'sp-card-label' } },
                { elmType: 'p', txtContent: '[$Status]', attributes: { class: 'sp-card-content' } },
              ],
            },
          ],
        },
      ],
    }),
  },
];

function tableRow(label: string, valueExpr: string): SPElement {
  return {
    elmType: 'div',
    style: { 'display': 'table-row' },
    children: [
      {
        elmType: 'div', txtContent: label,
        attributes: { class: 'ms-fontColor-neutralSecondary sp-css-borderColor-neutralLight' },
        style: {
          'display': 'table-cell', 'width': '40%', 'padding': '6px 8px', 'font-size': '12px',
          'border-bottom-width': '1px', 'border-bottom-style': 'solid',
        },
      },
      {
        elmType: 'div', txtContent: valueExpr,
        attributes: { class: 'ms-fontColor-neutralPrimary sp-css-borderColor-neutralLight' },
        style: {
          'display': 'table-cell', 'padding': '6px 8px', 'font-size': '12px',
          'border-bottom-width': '1px', 'border-bottom-style': 'solid',
        },
      },
    ],
  };
}

// ─── Schema-aware binding ─────────────────────────────────────────────────────

/**
 * Presets are authored against the default mock fields (Status, Progress,
 * AssignedTo, ...). When the user has imported their own list schema, remap
 * each default reference to the user's best-matching field by type, so a
 * dropped "Status pill" binds to *their* choice column instead of breaking.
 */
const PRESET_FIELD_TYPES: Record<string, FieldType[]> = {
  Title: ['text'],
  Tags: ['text'],
  Status: ['choice', 'text'],
  Progress: ['number', 'currency'],
  DueDate: ['date'],
  Owner: ['person', 'personMulti'],
  AssignedTo: ['personMulti', 'person'],
  Project: ['lookup', 'lookupMulti'],
  Link: ['hyperlink'],
};

/** Pure remap — exported for tests. Returns a new tree; input is not mutated. */
export function bindFragmentToSchema(fragment: SPElement, fields: MockField[]): SPElement {
  const names = new Set(fields.map((f) => f.name));
  const replacements = new Map<string, string>();
  const taken = new Set<string>();

  for (const [defaultName, types] of Object.entries(PRESET_FIELD_TYPES)) {
    if (names.has(defaultName)) continue; // user has this exact column
    for (const type of types) {
      const candidate =
        fields.find((f) => f.type === type && !f.protected && !taken.has(f.name)) ??
        fields.find((f) => f.type === type && !f.protected);
      if (candidate) {
        replacements.set(defaultName, candidate.name);
        taken.add(candidate.name);
        break;
      }
    }
  }
  if (replacements.size === 0) return fragment;

  const remapString = (s: string): string => {
    let out = s;
    for (const [from, to] of replacements) {
      // [$Field] / [$Field.prop] / [!Field.DisplayName] boundaries
      out = out.replace(new RegExp(`\\[(\\$|!)${from}(?=[\\].])`, 'g'), `[$1${to}`);
    }
    return out;
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return remapString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  return walk(JSON.parse(JSON.stringify(fragment))) as SPElement;
}

/** Create a palette fragment bound to the given schema. */
export function instantiate(item: PaletteItem, fields: MockField[]): SPElement {
  const el = bindFragmentToSchema(item.create(), fields);
  // arrive named — the Structure pane reads "Status pill", not "div"
  el._elmName = el._elmName ?? item.label;
  return el;
}
