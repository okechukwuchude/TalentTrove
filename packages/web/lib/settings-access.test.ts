import { afterEach, describe, expect, it } from 'vitest';
import { isSettingsAdmin } from './settings-access.ts';

describe('isSettingsAdmin', () => {
  afterEach(() => {
    delete process.env.SETTINGS_ADMIN_EMAILS;
  });

  it('allows any signed-in email when SETTINGS_ADMIN_EMAILS is unset (today\'s default, unchanged)', () => {
    expect(isSettingsAdmin('anyone@example.com')).toBe(true);
  });

  it('allows any signed-in email when SETTINGS_ADMIN_EMAILS is set but empty', () => {
    process.env.SETTINGS_ADMIN_EMAILS = '   ';
    expect(isSettingsAdmin('anyone@example.com')).toBe(true);
  });

  it('allows an email present in the list', () => {
    process.env.SETTINGS_ADMIN_EMAILS = 'owner@example.com,ops@example.com';
    expect(isSettingsAdmin('owner@example.com')).toBe(true);
    expect(isSettingsAdmin('ops@example.com')).toBe(true);
  });

  it('denies an email absent from the list', () => {
    process.env.SETTINGS_ADMIN_EMAILS = 'owner@example.com';
    expect(isSettingsAdmin('stranger@example.com')).toBe(false);
  });

  it('compares case-insensitively and tolerates whitespace around entries', () => {
    process.env.SETTINGS_ADMIN_EMAILS = ' Owner@Example.com , ops@example.com ';
    expect(isSettingsAdmin('owner@example.com')).toBe(true);
    expect(isSettingsAdmin('OPS@EXAMPLE.COM')).toBe(true);
  });
});
