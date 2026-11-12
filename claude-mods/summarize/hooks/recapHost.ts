export interface RecapHost {
  run(argv: readonly string[], options: { readonly cwd?: string; readonly timeoutMs: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  home(): Promise<string | undefined>
  osType(): Promise<string | undefined>
  isInsideHerdr(): Promise<boolean>
  now(): Promise<number>
  sessionId(): Promise<string>
  cwd(): Promise<string>
}
