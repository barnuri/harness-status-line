import { ConfigManager } from './configManager.ts';

export class ConfigCli {
  run(args: string[]): void {
    const [subCmd, ...rest] = args;

    switch (subCmd) {
      case 'show':
        this.show();
        break;
      case 'set':
        this.set(rest);
        break;
      case 'reset':
        this.reset();
        break;
      default:
        this.printHelp();
    }
  }

  private show(): void {
    const manager = new ConfigManager();
    const config = manager.load();
    process.stdout.write(`\nCurrent configuration (${ConfigManager.CONFIG_FILE}):\n\n`);
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
    process.stdout.write("\nRun 'bunx barnuri/claude-status-line config reset' to restore defaults.\n\n");
  }

  private set(args: string[]): void {
    const [key, value] = args;
    if (!key || value === undefined) {
      process.stderr.write('Usage: config set <key> <value>\n');
      process.exit(1);
    }
    const manager = new ConfigManager();
    manager.set(key, value);
    process.stdout.write(`✅ Set ${key} = ${value}\n`);
  }

  private reset(): void {
    const manager = new ConfigManager();
    manager.reset();
    process.stdout.write('✅ Configuration reset to defaults.\n');
  }

  private printHelp(): void {
    process.stdout.write(`
Usage: bunx barnuri/claude-status-line config <command>

Commands:
  show                        Show current configuration
  set <key> <value>           Set a configuration value
  reset                       Reset to defaults

Keys:
  separatorStyle              powerline | spaces
  segments.folder             true | false
  segments.slug               true | false
  segments.model              true | false
  segments.context            true | false
  segments.rateLimits         true | false
  segments.effort             true | false
  segments.workflow           true | false
  refreshInterval             <milliseconds>
  colors.<segment>.<bg|fg>    <R,G,B>  (e.g. 30,41,59)

Segments: folder, slug, model, ctxHealthy, ctxWarning, ctxCritical,
          rateHealthy, rateWarning, rateCritical, effort, workflow

Examples:
  config set separatorStyle spaces
  config set segments.folder false
  config set refreshInterval 3000
  config set colors.folder.bg 30,41,59

`);
  }
}
