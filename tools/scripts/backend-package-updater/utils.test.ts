import { BackendPackageUtils } from './utils';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs for scope detection tests
jest.mock('fs');

describe('BackendPackageUtils', () => {
  describe('detectScopes', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should detect scopes from dependencies', () => {
      const mockPackageJson = {
        dependencies: {
          '@cplace-next/core': '1.0.0',
          '@cplace-paw/utils': '2.0.0',
          lodash: '4.17.21',
        },
        devDependencies: {
          '@cplace-next/dev-tools': '1.5.0',
        },
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify(mockPackageJson)
      );

      const scopes = BackendPackageUtils.detectScopes(['test/package.json']);

      expect(scopes.size).toBe(2);
      expect(scopes.has('@cplace-next')).toBe(true);
      expect(scopes.has('@cplace-paw')).toBe(true);
      expect(scopes.has('lodash')).toBe(false); // Non-scoped package
    });

    it('should handle missing package.json files', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const scopes = BackendPackageUtils.detectScopes(['missing/package.json']);

      expect(scopes.size).toBe(0);
    });

    it('should handle package.json without dependencies', () => {
      const mockPackageJson = {
        name: 'test-package',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify(mockPackageJson)
      );

      const scopes = BackendPackageUtils.detectScopes(['test/package.json']);

      expect(scopes.size).toBe(0);
    });

    it('should merge scopes from multiple package.json files', () => {
      const mockPackageJson1 = {
        dependencies: {
          '@cplace-next/core': '1.0.0',
        },
      };

      const mockPackageJson2 = {
        dependencies: {
          '@cplace-paw/utils': '2.0.0',
        },
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce(JSON.stringify(mockPackageJson1))
        .mockReturnValueOnce(JSON.stringify(mockPackageJson2));

      const scopes = BackendPackageUtils.detectScopes([
        'plugin1/assets/package.json',
        'plugin2/assets/package.json',
      ]);

      expect(scopes.size).toBe(2);
      expect(scopes.has('@cplace-next')).toBe(true);
      expect(scopes.has('@cplace-paw')).toBe(true);
    });
  });
});
