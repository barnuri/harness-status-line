export class TextFormat {
  public static readonly FENCED_BLOCK = /```[\s\S]*?```/g

  private static readonly ELLIPSIS = '…'

  public static truncate(text: string, maxLength: number): string {
    const flat = text.replace(/\s+/g, ' ').trim()

    return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength - 1)}${TextFormat.ELLIPSIS}`
  }
}
