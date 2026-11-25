import { expect } from '@jest/globals';
import { JfrogAuthMode, JfrogCredentials } from './jfrog-credentials';

const JFROG_ENV = [
  'JFROG_URL',
  'JFROG_USER',
  'JFROG_TOKEN',
  'JFROG_BASE64_TOKEN',
];

afterEach(() => {
  JFROG_ENV.forEach((name) => delete process.env[name]);
  jest.restoreAllMocks();
});

test('JfrogCredentials uses the token when JFROG_TOKEN and JFROG_BASE64_TOKEN are both set', () => {
  process.env.JFROG_TOKEN = 'jfrog_token';
  process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';

  expect(new JfrogCredentials().authMode).toBe(JfrogAuthMode.TOKEN);
});

test('JfrogCredentials falls back to the legacy mode when only JFROG_BASE64_TOKEN is set', () => {
  process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';

  expect(new JfrogCredentials().authMode).toBe(JfrogAuthMode.LEGACY);
});

test('JfrogCredentials has no auth mode when neither secret is set', () => {
  expect(new JfrogCredentials().authMode).toBe(JfrogAuthMode.NONE);
});

test('JfrogCredentials treats empty secrets as absent, the way workflows pass unset optional secrets', () => {
  process.env.JFROG_TOKEN = '';
  process.env.JFROG_BASE64_TOKEN = '';

  expect(new JfrogCredentials().authMode).toBe(JfrogAuthMode.NONE);
});

test('JfrogCredentials does not serialize its secrets', () => {
  process.env.JFROG_URL =
    'https://cplace.jfrog.io/artifactory/cplace-npm-test/';
  process.env.JFROG_USER = 'jfrog_user';
  process.env.JFROG_TOKEN = 'secret_token_value';
  process.env.JFROG_BASE64_TOKEN = 'secret_base64_value';

  const json = JSON.stringify({ jfrogCredentials: new JfrogCredentials() });

  expect(json).not.toContain('secret_token_value');
  expect(json).not.toContain('secret_base64_value');
  expect(json).toContain('"authMode":"TOKEN"');
  expect(json).toContain('"user":"jfrog_user"');
});

test('JfrogCredentials requires nothing more in token mode', () => {
  process.env.JFROG_TOKEN = 'jfrog_token';
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  new JfrogCredentials().requireForPublishing();

  expect(log).not.toHaveBeenCalled();
});

test('JfrogCredentials warns once that JFROG_BASE64_TOKEN is deprecated in legacy mode', () => {
  process.env.JFROG_BASE64_TOKEN = 'jfrog_base64_token';
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  new JfrogCredentials().requireForPublishing();

  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    `::warning::${JfrogCredentials.LEGACY_WARNING}`
  );
});

test('JfrogCredentials fails with an error annotation when neither secret is set', () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  expect(() => new JfrogCredentials().requireForPublishing()).toThrow(
    JfrogCredentials.MISSING_ERROR
  );
  expect(log).toHaveBeenCalledWith(
    `::error::${JfrogCredentials.MISSING_ERROR}`
  );
});
