import { describe, expect, it } from 'bun:test';
import { RepoLink } from '../../claude-mods/summarize/hooks/repoLink.ts';

describe('RepoLink.fromRoot', () => {
  it('turns scp, ssh and https remotes into web links named after the folder', () => {
    expect(RepoLink.fromRoot('/w/keystone', 'git@github.com:chkp-genai/keystone.git\n')).toEqual({ label: 'keystone', url: 'https://github.com/chkp-genai/keystone' });
    expect(RepoLink.fromRoot('/w/k', 'ssh://git@gitlab.example.com:2222/team/k.git')).toEqual({ label: 'k', url: 'https://gitlab.example.com/team/k' });
    expect(RepoLink.fromRoot('/w/k', 'https://user@github.com/o/k.git')).toEqual({ label: 'k', url: 'https://github.com/o/k' });
  });

  it('falls back to a file link when there is no usable remote', () => {
    expect(RepoLink.fromRoot('/w/local', '')).toEqual({ label: 'local', url: 'file:///w/local' });
  });
});

describe('RepoLink.unique', () => {
  it('dedupes by label, upgrades to a web link, and accepts legacy names', () => {
    expect(RepoLink.unique(['web', { label: 'web', url: 'file:///w/web' }, { label: 'web', url: 'https://github.com/o/web' }, { label: 'web', url: 'file:///x' }])).toEqual([
      { label: 'web', url: 'https://github.com/o/web' },
    ]);
  });

  it('builds a GitHub link from an owner/repo slug', () => {
    expect(RepoLink.fromSlug('acme/api')).toEqual({ label: 'acme/api', url: 'https://github.com/acme/api' });
  });
});
