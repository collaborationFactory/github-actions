import { DistTagResolver } from './dist-tag-resolver';

describe('DistTagResolver', () => {
  describe('getDistTag', () => {
    it('should return "snapshot" for main branch', () => {
      expect(DistTagResolver.getDistTag('main')).toBe('snapshot');
    });

    it('should return "snapshot" for master branch', () => {
      expect(DistTagResolver.getDistTag('master')).toBe('snapshot');
    });

    it('should return "release-X.Y" for release/X.Y branches', () => {
      expect(DistTagResolver.getDistTag('release/25.4')).toBe('release-25.4');
      expect(DistTagResolver.getDistTag('release/26.1')).toBe('release-26.1');
    });

    it('should throw error for unsupported branch patterns', () => {
      expect(() => DistTagResolver.getDistTag('feature/abc')).toThrow(
        'Unsupported branch pattern: feature/abc'
      );
      expect(() => DistTagResolver.getDistTag('develop')).toThrow(
        'Unsupported branch pattern: develop'
      );
    });
  });
});
