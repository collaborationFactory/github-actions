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

    it('should return "snapshot" for other branch patterns', () => {
      expect(DistTagResolver.getDistTag('feature/abc')).toBe('snapshot');
      expect(DistTagResolver.getDistTag('develop')).toBe('snapshot');
      expect(DistTagResolver.getDistTag('bugfix/test')).toBe('snapshot');
    });
  });
});
