export function capitalize(string: string, locale?: string) {
  return string.charAt(0).toLocaleUpperCase(locale) + string.slice(1);
}
