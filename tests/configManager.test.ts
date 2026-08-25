import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../src/configManager.ts';
import type { Config } from '../src/types.ts';

const CONFIG_FILE = ConfigManager.CONFIG_FILE;
const CONFIG_DIR = ConfigManager.CONFIG_DIR;

function removeConfigFile(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

function writeConfigFile(content: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
}

function readConfigFile(): Config {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Config;
}

describe('ConfigManager — DEFAULT_CONFIG', () => {
  it('DEFAULT_CONFIG has powerline separatorStyle', () => {
    expect(ConfigManager.DEFAULT_CONFIG.separatorStyle).toBe('spaces');
  });

  it('DEFAULT_CONFIG enables all segments', () => {
    const { segments } = ConfigManager.DEFAULT_CONFIG;
    expect(segments.folder).toBe(true);
    expect(segments.model).toBe(true);
    expect(segments.context).toBe(true);
    expect(segments.rateLimits).toBe(true);
  });

  it('DEFAULT_CONFIG has refreshInterval of 2000', () => {
    expect(ConfigManager.DEFAULT_CONFIG.refreshInterval).toBe(2000);
  });

  it('DEFAULT_CONFIG has all required color keys', () => {
    const { colors } = ConfigManager.DEFAULT_CONFIG;
    for (const key of ['folder', 'model', 'ctxHealthy', 'ctxWarning', 'ctxCritical', 'rateHealthy', 'rateWarning', 'rateCritical']) {
      const c = colors[key as keyof typeof colors];
      expect(c.bg).toHaveLength(3);
      expect(c.fg).toHaveLength(3);
    }
  });
});

describe('ConfigManager — load()', () => {
  afterEach(() => removeConfigFile());

  it('returns DEFAULT_CONFIG when file does not exist', () => {
    removeConfigFile();
    const manager = new ConfigManager();
    const config = manager.load();
    expect(config.separatorStyle).toBe('spaces');
    expect(config.segments.folder).toBe(true);
    expect(config.refreshInterval).toBe(2000);
  });

  it('merges partial file with defaults (only separatorStyle set)', () => {
    writeConfigFile(JSON.stringify({ separatorStyle: 'spaces' }));
    const manager = new ConfigManager();
    const config = manager.load();
    expect(config.separatorStyle).toBe('spaces');
    expect(config.segments.folder).toBe(true);
    expect(config.refreshInterval).toBe(2000);
    expect(config.colors.folder.bg).toEqual([30, 41, 59]);
  });

  it('merges partial segments with defaults (only folder disabled)', () => {
    writeConfigFile(JSON.stringify({ segments: { folder: false } }));
    const manager = new ConfigManager();
    const config = manager.load();
    expect(config.segments.folder).toBe(false);
    expect(config.segments.model).toBe(true);
    expect(config.segments.context).toBe(true);
    expect(config.segments.rateLimits).toBe(true);
  });

  it('merges partial colors with defaults (only folder.bg changed)', () => {
    writeConfigFile(JSON.stringify({ colors: { folder: { bg: [1, 2, 3], fg: [248, 250, 252] } } }));
    const manager = new ConfigManager();
    const config = manager.load();
    expect(config.colors.folder.bg).toEqual([1, 2, 3]);
    expect(config.colors.model.bg).toEqual([51, 65, 85]);
    expect(config.colors.ctxHealthy.bg).toEqual([21, 128, 61]);
  });

  it('returns DEFAULT_CONFIG when file has corrupted JSON', () => {
    writeConfigFile('{not valid json}');
    const manager = new ConfigManager();
    const config = manager.load();
    expect(config.separatorStyle).toBe('spaces');
    expect(config.refreshInterval).toBe(2000);
  });
});

describe('ConfigManager — save()', () => {
  afterEach(() => removeConfigFile());

  it('writes valid JSON to config file', () => {
    const manager = new ConfigManager();
    manager.save(ConfigManager.DEFAULT_CONFIG);
    const saved = readConfigFile();
    expect(saved.separatorStyle).toBe('spaces');
    expect(saved.refreshInterval).toBe(2000);
  });

  it('creates config directory if it does not exist', () => {
    removeConfigFile();
    const manager = new ConfigManager();
    manager.save(ConfigManager.DEFAULT_CONFIG);
    expect(fs.existsSync(CONFIG_FILE)).toBe(true);
  });
});

describe('ConfigManager — reset()', () => {
  afterEach(() => removeConfigFile());

  it('writes DEFAULT_CONFIG to file', () => {
    writeConfigFile(JSON.stringify({ separatorStyle: 'spaces', refreshInterval: 5000 }));
    const manager = new ConfigManager();
    manager.reset();
    const saved = readConfigFile();
    expect(saved.separatorStyle).toBe('spaces');
    expect(saved.refreshInterval).toBe(2000);
  });

  it('returns DEFAULT_CONFIG', () => {
    const manager = new ConfigManager();
    const result = manager.reset();
    expect(result.separatorStyle).toBe('spaces');
    expect(result.segments.folder).toBe(true);
  });
});

describe('ConfigManager — set() — simple keys', () => {
  afterEach(() => removeConfigFile());

  it('sets separatorStyle to spaces', () => {
    const manager = new ConfigManager();
    const config = manager.set('separatorStyle', 'spaces');
    expect(config.separatorStyle).toBe('spaces');
    expect(readConfigFile().separatorStyle).toBe('spaces');
  });

  it('sets refreshInterval as number', () => {
    const manager = new ConfigManager();
    const config = manager.set('refreshInterval', '3000');
    expect(config.refreshInterval).toBe(3000);
    expect(typeof readConfigFile().refreshInterval).toBe('number');
  });
});

describe('ConfigManager — set() — nested keys', () => {
  afterEach(() => removeConfigFile());

  it('sets segments.folder to false', () => {
    const manager = new ConfigManager();
    const config = manager.set('segments.folder', 'false');
    expect(config.segments.folder).toBe(false);
    expect(config.segments.model).toBe(true);
  });

  it('sets segments.rateLimits to false', () => {
    const manager = new ConfigManager();
    const config = manager.set('segments.rateLimits', 'false');
    expect(config.segments.rateLimits).toBe(false);
  });

  it('persists nested set to file', () => {
    const manager = new ConfigManager();
    manager.set('segments.model', 'false');
    const saved = readConfigFile();
    expect(saved.segments.model).toBe(false);
    expect(saved.segments.folder).toBe(true);
  });
});

describe('ConfigManager — set() — RGB color keys', () => {
  afterEach(() => removeConfigFile());

  it('sets colors.folder.bg as RGB tuple', () => {
    const manager = new ConfigManager();
    const config = manager.set('colors.folder.bg', '1,2,3');
    expect(config.colors.folder.bg).toEqual([1, 2, 3]);
  });

  it('keeps other colors intact when only folder.bg is changed', () => {
    const manager = new ConfigManager();
    const config = manager.set('colors.folder.bg', '10,20,30');
    expect(config.colors.model.bg).toEqual([51, 65, 85]);
    expect(config.colors.ctxHealthy.bg).toEqual([21, 128, 61]);
  });

  it('persists color change to file', () => {
    const manager = new ConfigManager();
    manager.set('colors.effort.fg', '0,0,0');
    const saved = readConfigFile();
    expect(saved.colors.effort.fg).toEqual([0, 0, 0]);
  });
});

describe('ConfigManager — set() — value coercion', () => {
  afterEach(() => removeConfigFile());

  it('coerces "true" to boolean true', () => {
    const manager = new ConfigManager();
    manager.set('segments.folder', 'false');
    const config = manager.set('segments.folder', 'true');
    expect(config.segments.folder).toBe(true);
  });

  it('coerces "false" to boolean false', () => {
    const manager = new ConfigManager();
    const config = manager.set('segments.context', 'false');
    expect(config.segments.context).toBe(false);
  });

  it('coerces numeric string to number', () => {
    const manager = new ConfigManager();
    const config = manager.set('refreshInterval', '5000');
    expect(config.refreshInterval).toBe(5000);
    expect(typeof config.refreshInterval).toBe('number');
  });

  it('coerces "R,G,B" string to array', () => {
    const manager = new ConfigManager();
    const config = manager.set('colors.folder.bg', '255,128,0');
    expect(config.colors.folder.bg).toEqual([255, 128, 0]);
  });

  it('keeps plain string value for non-numeric input', () => {
    const manager = new ConfigManager();
    const config = manager.set('separatorStyle', 'spaces');
    expect(config.separatorStyle).toBe('spaces');
  });
});

describe('ConfigManager — deep merge invariants', () => {
  afterEach(() => removeConfigFile());

  it('multiple set() calls accumulate without overwriting siblings', () => {
    const manager = new ConfigManager();
    manager.set('segments.folder', 'false');
    manager.set('segments.model', 'false');
    const config = manager.load();
    expect(config.segments.folder).toBe(false);
    expect(config.segments.model).toBe(false);
    expect(config.segments.context).toBe(true);
    expect(config.segments.rateLimits).toBe(true);
  });

  it('setting separatorStyle does not affect colors', () => {
    const manager = new ConfigManager();
    manager.set('separatorStyle', 'spaces');
    const config = manager.load();
    expect(config.colors.folder.bg).toEqual(ConfigManager.DEFAULT_CONFIG.colors.folder.bg);
  });
});
