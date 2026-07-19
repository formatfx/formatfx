// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * branding.ts — single source of truth for the product identity.
 * Everything user-visible reads from here; rename the product by editing
 * this file only. (localStorage keys deliberately do NOT derive from this —
 * renaming must never wipe anyone's autosaved work.)
 */
export const PRODUCT_NAME = 'FormatFX';
export const PRODUCT_TAGLINE = 'formatting effects for SharePoint lists and libraries';
export const PRODUCT_PITCH = 'Design your SharePoint list formatting visually.';
export const PROJECT_FILE_NAME = 'formatfx-project.json';
export const HOME_URL = 'https://formatfx.dev';
