import { describe, it, expect } from 'vitest';
import {
  classifySettingsLink,
  settingsPageKind,
  parseLensMode,
  LENS_RULES,
  LENS_MODE_KEY,
} from '../../extension/src/modernLens';

const BASE = 'https://contoso.sharepoint.com/sites/Team/_layouts/15/settings.aspx';

describe('settingsPageKind', () => {
  it('recognizes the two classic settings hubs, at any depth and any case', () => {
    expect(settingsPageKind(BASE)).toBe('site');
    expect(settingsPageKind('https://contoso.sharepoint.com/_layouts/15/settings.aspx')).toBe('site'); // root site
    expect(settingsPageKind('https://contoso.sharepoint.com/sites/A/subweb/_layouts/15/Settings.aspx')).toBe('site');
    expect(settingsPageKind('https://contoso.sharepoint.com/sites/Team/_layouts/15/listedit.aspx?List=%7B8f4%7D')).toBe('list');
    expect(settingsPageKind('https://contoso.sharepoint.com/sites/Team/_layouts/15/ListEdit.aspx?List=x')).toBe('list');
  });

  it('rejects everything else', () => {
    expect(settingsPageKind('https://contoso.sharepoint.com/sites/Team/SitePages/Home.aspx')).toBe(null);
    expect(settingsPageKind('https://contoso.sharepoint.com/sites/Team/_layouts/15/user.aspx')).toBe(null);
    // the filename alone is not enough — it must live under _layouts
    expect(settingsPageKind('https://contoso.sharepoint.com/sites/Team/Docs/settings.aspx')).toBe(null);
    expect(settingsPageKind('not a url')).toBe(null);
  });
});

describe('classifySettingsLink', () => {
  it('dims retired/classic-only pages, with a tooltip-ready reason', () => {
    for (const href of [
      'savetmpl.aspx', // save site/list as template (custom-script era)
      'wrkmng.aspx?List={8f4}', // site + list workflow settings…
      'wrksetng.aspx?List={8f4}', // …and the alternate list filename
      'topnav.aspx',
      'sharepointdesignersettings.aspx',
      '/sites/Team/_layouts/15/ProjectPolicies.aspx', // site closure & deletion
      'https://contoso.sharepoint.com/sites/Team/_layouts/15/Reporting.aspx?Category=Auditing',
    ]) {
      const c = classifySettingsLink(href, BASE);
      expect(c?.verdict, href).toBe('dim');
      expect(c?.reason, href).toBeTruthy();
    }
  });

  it('dims the classic galleries by their _catalogs segment', () => {
    for (const seg of ['wp', 'lt', 'masterpage', 'theme', 'solutions', 'design']) {
      const c = classifySettingsLink(`/sites/Team/_catalogs/${seg}/Forms/AllItems.aspx`, BASE);
      expect(c?.verdict, seg).toBe('dim');
    }
    // an unclassified catalog stays untouched
    expect(classifySettingsLink('/sites/Team/_catalogs/hubsite', BASE)?.verdict).toBe('unknown');
  });

  it('keeps the pages modern still depends on — including the look-legacy traps', () => {
    for (const href of [
      'mngfield.aspx', // site columns
      'user.aspx?obj={8f4},list', // permissions
      'appprincipals.aspx', // modern Entra grants list here too — only ACS died
      'navoptions.aspx', // its Enable Quick Launch drives the MODERN left nav
      'listqueryrules.aspx', // promoted results still serve modern search
      'metanavsettings.aspx', // key filters feed the modern Filters pane
      'htmlfieldsecurity.aspx', // modern Embed web part domain allow-list
      'audiencetargetingsettings.aspx', // modern audience targeting switch
      'srchvis.aspx', // NoCrawl still governs modern search
      'lstsetng.aspx', // versioning
      'managefeatures.aspx?Scope=Site',
    ]) {
      expect(classifySettingsLink(href, BASE)?.verdict, href).toBe('keep');
    }
  });

  it('classifies by filename case-insensitively, ignoring query and fragment', () => {
    expect(classifySettingsLink('SaveTmpl.ASPX?List={8f4}#top', BASE)?.verdict).toBe('dim');
    expect(classifySettingsLink('MngField.aspx', BASE)?.verdict).toBe('keep');
  });

  it('returns unknown for unclassified pages and non-layouts links — never dims them', () => {
    expect(classifySettingsLink('somefuturepage.aspx', BASE)?.verdict).toBe('unknown');
    expect(classifySettingsLink('/sites/Team/SitePages/Home.aspx', BASE)?.verdict).toBe('unknown');
  });

  it('returns null for links that cannot carry a verdict', () => {
    expect(classifySettingsLink('javascript:void(0)', BASE)).toBe(null);
    expect(classifySettingsLink('mailto:owner@contoso.com', BASE)).toBe(null);
    // '#' resolves to the page itself — a real URL, just not a layouts page
    expect(classifySettingsLink('#', 'not a base url')).toBe(null);
  });
});

describe('the ruleset contract', () => {
  const { DIM_LAYOUTS, KEEP_LAYOUTS, DIM_CATALOGS } = LENS_RULES;

  it('every dim rule carries a tooltip-sized reason', () => {
    for (const [file, why] of [...Object.entries(DIM_LAYOUTS), ...Object.entries(DIM_CATALOGS)]) {
      expect(why.length, file).toBeGreaterThan(20);
      expect(why.length, file).toBeLessThanOrEqual(160);
    }
  });

  it('keys are lowercase and shaped right (match is by lowercased filename)', () => {
    for (const file of [...Object.keys(DIM_LAYOUTS), ...KEEP_LAYOUTS]) {
      expect(file, file).toBe(file.toLowerCase());
      expect(file, file).toMatch(/^[a-z0-9]+\.aspx$/);
    }
    for (const seg of Object.keys(DIM_CATALOGS)) {
      expect(seg).toBe(seg.toLowerCase());
      expect(seg).not.toContain('/');
    }
  });

  it('no page is both dimmed and kept', () => {
    for (const file of KEEP_LAYOUTS) {
      expect(DIM_LAYOUTS[file], file).toBeUndefined();
    }
  });

  it('the mode key stays out of the app’s frozen wb- namespace', () => {
    expect(LENS_MODE_KEY.startsWith('wb-')).toBe(false);
  });
});

describe('parseLensMode', () => {
  it('accepts the three modes and defaults everything else to dim', () => {
    expect(parseLensMode('dim')).toBe('dim');
    expect(parseLensMode('hide')).toBe('hide');
    expect(parseLensMode('off')).toBe('off');
    expect(parseLensMode(null)).toBe('dim');
    expect(parseLensMode(undefined)).toBe('dim');
    expect(parseLensMode('bright')).toBe('dim');
  });
});
