const GROK_46_PATTERN = /(?:^|[/\s:_-])grok[\s._-]*4[\s._-]*6(?:$|[/\s:_-])/i;

/** Whether a catalog model is the preferred Grok 4.6 text default. */
export function isGrok46Model(id: string, name?: string): boolean {
  if (GROK_46_PATTERN.test(id)) return true;
  return typeof name === "string" && GROK_46_PATTERN.test(name);
}
